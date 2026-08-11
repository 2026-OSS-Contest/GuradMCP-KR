package kr.guardmcp.controlplane.domain

import org.springframework.stereotype.Component
import java.util.UUID

/**
 * The Replay screen's single data source (GMCP-114): seeded demo sessions plus the
 * sessions projected from ingested audit events.
 *
 * Seeded sessions are kept rather than replaced. Two of them cannot be produced by
 * running anything — the broken-chain session exists so a tamper can be shown being
 * caught, and the 1200-node session exists so pagination has something to page — and
 * removing them would make the screen empty on a fresh start, before anyone has run a
 * demo. Whether they stay long-term is a separate call once the walkthrough script is
 * settled.
 *
 * Seeded ids win on lookup. They are fixed constants, and a projected session's id is
 * derived from the gateway's opaque session id, so the two spaces do not collide in
 * practice; checking seed first just makes that ordering explicit rather than
 * incidental.
 */
@Component
class ReplayTimelines(
    private val seeded: ReplayStore,
    private val live: LiveReplaySource,
) {
    /** Seeded first, then projected; each group already sorted newest-first. */
    fun sessions(q: String?, isLive: Boolean?): List<ReplaySession> =
        (seeded.sessions(q, isLive) + live.sessions(q, isLive))
            .sortedByDescending { it.startedAt }

    fun session(id: UUID): ReplaySession? = seeded.session(id) ?: live.session(id)

    fun timeline(sessionId: UUID): List<TimelineNode>? =
        seeded.timeline(sessionId) ?: live.timeline(sessionId)

    fun node(eventId: UUID): Pair<UUID, TimelineNode>? = seeded.node(eventId) ?: live.node(eventId)

    /**
     * A session that exists must report a chain status; reaching here for an unknown id
     * would mean the caller skipped its own existence check, so fail loudly instead of
     * reporting VALID for something that is not there.
     */
    fun chainResult(sessionId: UUID): ChainResult =
        seeded.chainResult(sessionId)
            ?: live.chainResult(sessionId)
            ?: error("chain status requested for unknown session $sessionId")

    fun eventCount(sessionId: UUID): Int =
        if (seeded.session(sessionId) != null) seeded.eventCount(sessionId) else live.eventCount(sessionId)

    fun verdictSummary(sessionId: UUID): Map<String, Int> =
        if (seeded.session(sessionId) != null) seeded.verdictSummary(sessionId) else live.verdictSummary(sessionId)
}
