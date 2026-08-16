package kr.guardmcp.controlplane.domain

import org.springframework.stereotype.Component
import java.math.RoundingMode
import java.util.UUID

/**
 * Projects ingested audit events into Replay sessions and timeline nodes (GMCP-114).
 *
 * Before this, `POST /api/v1/events` wrote to `guard_event` and Replay read a seeded
 * in-memory store, so the two never met: a real demo run reached the control plane
 * with its policy id and risk score, and then appeared nowhere on the screen meant
 * to show exactly that.
 *
 * Nothing is invented here. One ingested event becomes one VERDICT node carrying the
 * tool name, direction and args digest the gateway sent — not a TOOL_CALL/VERDICT
 * pair, because the gateway emits one event per routing outcome and synthesising a
 * second node would put an event on the timeline that was never emitted. Keeping the
 * node's `eventId` equal to the gateway's means `GET /events/{id}` resolves with the
 * same id the audit row carries.
 */
@Component
class LiveReplaySource(private val repository: AuditEventQueries) {

    /** Sessions projected from the log, newest first. */
    fun sessions(q: String?, isLive: Boolean?): List<ReplaySession> {
        // A completed audit trail is not a live session: every event in it already
        // happened. Filtering for `live` therefore matches none of these, which is
        // accurate rather than convenient.
        if (isLive == true) return emptyList()
        return repository.findSessionIds()
            .mapNotNull { load(it) }
            .filter { projection -> q == null || projection.matches(q) }
            .map { it.session }
    }

    fun session(id: UUID): ReplaySession? = loadByUuid(id)?.session

    fun timeline(sessionId: UUID): List<TimelineNode>? = loadByUuid(sessionId)?.nodes

    fun chainResult(sessionId: UUID): ChainResult? = loadByUuid(sessionId)?.chain

    fun eventCount(sessionId: UUID): Int = loadByUuid(sessionId)?.nodes?.size ?: 0

    fun verdictSummary(sessionId: UUID): Map<String, Int> = verdictCounts(loadByUuid(sessionId)?.nodes.orEmpty())

    fun node(eventId: UUID): Pair<UUID, TimelineNode>? {
        // The audit row knows its own session, so this is one lookup plus one
        // projection rather than a scan over every session.
        val record = repository.findById(eventId) ?: return null
        val projection = load(record.sessionId) ?: return null
        val node = projection.nodes.firstOrNull { it.eventId == eventId } ?: return null
        return projection.session.id to node
    }

    private fun loadByUuid(id: UUID): Projection? =
        repository.findSessionIds().firstOrNull { sessionUuid(it) == id }?.let(::load)

    private fun load(sessionId: String): Projection? {
        val records = repository.findBySessionId(sessionId)
        if (records.isEmpty()) return null
        val chainBuilder = ChainBuilder()
        val nodes = records.map { record -> toVerdictNode(record, chainBuilder) }
        val session = ReplaySession(
            id = sessionUuid(sessionId),
            agentLabel = sessionId,
            startedAt = records.first().ts,
            endedAt = records.last().ts,
            isLive = false,
        )
        // Deliberately not ReplayChain.validate(nodes) — the hashes on `nodes` were just
        // derived from `records` a few lines above (ChainBuilder, for display only), so
        // validating them would compare a value against itself and answer VALID every time,
        // including for a tampered `guard_event` row. GuardEventHasher.verify checks the
        // `hash`/`prev_hash` GuardEventRepository.insert actually stored (GMCP-83) against a
        // fresh recomputation, in `seq` order — the chain's integrity order, not `records`'
        // `ts` display order above.
        val chain = GuardEventHasher.verify(sessionId, repository.findBySessionIdOrderBySeq(sessionId))
        return Projection(session, nodes, chain, sessionId)
    }

    private fun toVerdictNode(record: GuardEventRecord, chain: ChainBuilder): TimelineNode {
        val verdict = toVerdict(record.verdict)
        return chain.verdictNode(
            eventId = record.eventId,
            ts = record.ts,
            summary = summaryOf(verdict, record.toolName),
            verdict = verdict,
            // The column is numeric to leave room for a fractional score; the Replay
            // node is an integer, so this rounds rather than truncating toward zero.
            riskScore = record.riskScore.setScale(0, RoundingMode.HALF_UP).toInt(),
            matchedPolicyIds = record.matchedPolicyIds,
            detections = record.detections.mapNotNull(::toDetection),
            toolName = record.toolName,
            direction = if (record.direction == "response") ToolCallDirection.RES else ToolCallDirection.REQ,
            argsDigest = record.argsDigest,
        )
    }

    /**
     * Maps the policy engine's five actions onto Replay's four-verdict display
     * vocabulary. `mask_then_allow` shows as `warn` — the same collapse the console
     * already documents (see [Verdict]) — because the reader needs to know the call
     * was altered, and Replay has no fifth badge to say so.
     */
    private fun toVerdict(wire: String): Verdict = when (wire) {
        "mask_then_allow" -> Verdict.WARN
        // No catch-all. The ingest endpoint rejects an unknown verdict with 400, so a value
        // that reaches here is a stored row this build cannot interpret — and on an audit
        // screen the cost of guessing is asymmetric: falling back to ALLOW would render an
        // uninterpretable decision as the most reassuring one on offer.
        else -> Verdict.fromWire(wire)
            ?: error("guard_event $wire is not a verdict this build recognizes")
    }

    private fun summaryOf(verdict: Verdict, toolName: String): String = when (verdict) {
        Verdict.BLOCK -> "차단 · $toolName"
        Verdict.REQUIRE_APPROVAL -> "승인 대기 · $toolName"
        Verdict.WARN -> "경고 · $toolName"
        Verdict.ALLOW -> "허용 · $toolName"
    }

    /**
     * Reads one detection out of the ingested jsonb. A malformed entry is dropped
     * rather than failing the request: a timeline that renders without one detection
     * is more useful than a Replay screen that 500s on a single bad row.
     */
    private fun toDetection(raw: Map<String, Any?>): Detection? {
        val type = raw["type"] as? String ?: return null
        val subtype = raw["subtype"] as? String ?: return null
        val span = raw["span"] as? Map<*, *>
        val start = (span?.get("start") as? Number)?.toInt() ?: 0
        val end = (span?.get("end") as? Number)?.toInt() ?: 0
        return Detection(
            type = type,
            subtype = subtype,
            span = Span(start, end),
            confidence = (raw["confidence"] as? Number)?.toDouble() ?: 0.0,
            // NFR-04. The gateway is supposed to send only a mask tag here, but the ingest
            // endpoint stores `detections` as raw jsonb without inspecting it, so that is an
            // assumption about the emitter rather than a boundary — and this field is the one
            // part of a detection that renders as text on the Replay screen. Anything that is
            // not a mask tag is dropped instead of forwarded: a misconfigured or compromised
            // emitter should not be able to paint raw sensitive text onto the audit view.
            maskedAs = (raw["maskedAs"] as? String)?.takeIf(MASK_TAG::matches) ?: "",
        )
    }

    private data class Projection(
        val session: ReplaySession,
        val nodes: List<TimelineNode>,
        val chain: ChainResult,
        val rawSessionId: String,
    ) {
        fun matches(q: String): Boolean =
            rawSessionId.contains(q, ignoreCase = true) ||
                session.id.toString().contains(q, ignoreCase = true) ||
                nodes.any { it.toolName?.contains(q, ignoreCase = true) == true }
    }

    companion object {
        /**
         * The gateway's session id is opaque text (`req-s-envdemo`, `attacklab-1a2b`),
         * but Replay addresses sessions by UUID all the way out to the console's URLs.
         * A name-based UUID keeps that contract without a mapping table and stays
         * stable across restarts, so a deep link into a session keeps working.
         */
        fun sessionUuid(sessionId: String): UUID =
            UUID.nameUUIDFromBytes("guardmcp-session:$sessionId".toByteArray(Charsets.UTF_8))

        /**
         * The mask tag shape the detectors emit (`[RRN]`, `[GITHUB_TOKEN]`). Used to tell a
         * tag apart from whatever else a `maskedAs` field might arrive carrying.
         */
        private val MASK_TAG = Regex("""\[[A-Z][A-Z0-9_]*]""")

        fun verdictCounts(nodes: List<TimelineNode>): Map<String, Int> {
            val counts = nodes.mapNotNull { it.verdict }.groupingBy { it.wire }.eachCount()
            return linkedMapOf(
                "allow" to (counts["allow"] ?: 0),
                "warn" to (counts["warn"] ?: 0),
                "require_approval" to (counts["require_approval"] ?: 0),
                "block" to (counts["block"] ?: 0),
            )
        }
    }
}
