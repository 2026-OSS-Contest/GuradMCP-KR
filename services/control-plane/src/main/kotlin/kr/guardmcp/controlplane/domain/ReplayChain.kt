package kr.guardmcp.controlplane.domain

import java.security.MessageDigest
import java.time.Instant
import java.util.UUID

/**
 * The Replay hash chain (GMCP-28 §3.3), shared by every source that produces
 * timeline nodes.
 *
 * It lives here rather than inside one store because two sources now build
 * chains — the seeded demo sessions and the sessions projected from ingested
 * audit events (GMCP-114) — and [validate] recomputes hashes independently of
 * however the nodes were built. A second copy of this algorithm would let the
 * two drift, and the first symptom would be Replay reporting BROKEN on a chain
 * that is fine.
 */
object ReplayChain {
    /** An empty previous hash marks the first verdict in a session. */
    const val GENESIS_HASH = ""

    fun payload(
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

    fun sha256(input: String): String {
        val bytes = MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
        return bytes.joinToString("") { "%02x".format(it) }
    }

    /** Conventional location of a verdict's mask diff; part of the hashed payload. */
    fun maskDiffRef(eventId: UUID): String = "/api/v1/events/$eventId/mask-diff"

    /**
     * Recomputes and checks the chain over [nodes] in the order given. Non-verdict
     * nodes are skipped: only verdicts are chained.
     *
     * Continues past a mismatch rather than stopping at the first one (GMCP-83 §4.1), advancing
     * on each node's *stored* hash so one corrupted node does not cascade every later,
     * still-self-consistent node into a false mismatch too — the same localization
     * [GuardEventHasher.verify] does for the real chain.
     */
    fun validate(nodes: List<TimelineNode>): ChainResult {
        val verdictNodes = nodes.filter { it.type == TimelineNodeType.VERDICT }
        var expectedPrevHash = GENESIS_HASH
        val mismatches = mutableListOf<UUID>()
        var lastGoodHash: String? = null
        for (node in verdictNodes) {
            val detail = requireNotNull(node.detail) { "VERDICT node ${node.eventId} is missing its detail" }
            val recomputed = sha256(
                payload(
                    node.eventId,
                    requireNotNull(node.verdict),
                    requireNotNull(node.riskScore),
                    detail.matchedPolicyIds,
                    detail.detections,
                    detail.maskDiffRef,
                    expectedPrevHash,
                ),
            )
            val ok = detail.prevHash == expectedPrevHash && recomputed == detail.hash
            if (ok) lastGoodHash = detail.hash else mismatches += node.eventId
            expectedPrevHash = detail.hash
        }
        val status = if (mismatches.isEmpty()) ChainStatus.VALID else ChainStatus.BROKEN
        return ChainResult(
            status, mismatches.firstOrNull(),
            verdictNodes.size - mismatches.size, verdictNodes.size,
            mismatches, lastGoodHash, Instant.now(),
        )
    }
}

/**
 * Builds VERDICT nodes for one session, chaining each `hash` to the previous
 * verdict's. Not thread-safe and not reusable across sessions: a chain is
 * per-session state by definition.
 */
class ChainBuilder {
    private var prevHash = ReplayChain.GENESIS_HASH

    fun verdictNode(
        eventId: UUID,
        ts: java.time.Instant,
        summary: String,
        verdict: Verdict,
        riskScore: Int,
        matchedPolicyIds: List<String>,
        detections: List<Detection>,
        toolName: String? = null,
        direction: ToolCallDirection? = null,
        argsDigest: String? = null,
        /** Stores a deliberately wrong hash so [ReplayChain.validate] reports BROKEN. Seed data only. */
        corrupt: Boolean = false,
        /** GMCP-84 §8.3 -- see [TimelineNode.hasRawPayload]. */
        hasRawPayload: Boolean = false,
    ): TimelineNode {
        val maskDiffRef = ReplayChain.maskDiffRef(eventId)
        val correctHash = ReplayChain.sha256(
            ReplayChain.payload(eventId, verdict, riskScore, matchedPolicyIds, detections, maskDiffRef, prevHash),
        )
        val storedHash = if (corrupt) "0" + correctHash.drop(1) else correctHash
        val detail = VerdictDetail(matchedPolicyIds, detections, maskDiffRef, storedHash, prevHash)
        prevHash = correctHash
        return TimelineNode(
            eventId = eventId,
            type = TimelineNodeType.VERDICT,
            ts = ts,
            summary = summary,
            toolName = toolName,
            direction = direction,
            argsDigest = argsDigest,
            verdict = verdict,
            riskScore = riskScore,
            detail = detail,
            hasRawPayload = hasRawPayload,
        )
    }
}
