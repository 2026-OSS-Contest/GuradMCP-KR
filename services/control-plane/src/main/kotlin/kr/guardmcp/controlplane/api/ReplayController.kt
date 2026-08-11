package kr.guardmcp.controlplane.api

import com.fasterxml.jackson.annotation.JsonInclude
import com.fasterxml.jackson.annotation.JsonProperty
import com.fasterxml.jackson.annotation.JsonUnwrapped
import kr.guardmcp.controlplane.domain.ChainStatus
import kr.guardmcp.controlplane.domain.ReplayTimelines
import kr.guardmcp.controlplane.domain.TimelineNode
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.time.Instant
import java.time.format.DateTimeParseException
import java.util.UUID

data class SessionSummaryResponse(
    val sessionId: UUID,
    val agentLabel: String,
    val startedAt: Instant,
    val endedAt: Instant?,
    @get:JsonProperty("isLive") val isLive: Boolean,
    val eventCount: Int,
    val verdictSummary: Map<String, Int>,
)

data class SessionsResponse(val items: List<SessionSummaryResponse>, val nextCursor: String?)

data class SessionTimelineResponse(
    val sessionId: UUID,
    val agentLabel: String,
    val startedAt: Instant,
    @get:JsonProperty("isLive") val isLive: Boolean,
    val chainStatus: ChainStatus,
    @get:JsonInclude(JsonInclude.Include.NON_NULL) val brokenAt: UUID?,
    val nodes: List<TimelineNode>,
    val nextCursor: String?,
)

data class EventLookupResponse(
    val sessionId: UUID,
    @get:JsonUnwrapped val node: TimelineNode,
)

/**
 * `GET /sessions`, `GET /sessions/{id}/timeline`, `GET /events/{id}` — the Replay screen's data
 * source (GMCP-28). Reads through [ReplayTimelines], which serves seeded demo sessions and the
 * sessions projected from ingested audit events alike (GMCP-114).
 */
@RestController
@RequestMapping("/api/v1")
class ReplayController(private val replayStore: ReplayTimelines) {

    @GetMapping("/sessions")
    fun sessions(
        @RequestParam(required = false) q: String?,
        @RequestParam(required = false) status: String?,
        @RequestParam(required = false) cursor: String?,
        @RequestParam(required = false, defaultValue = "20") limit: Int,
    ): SessionsResponse {
        val isLive = parseStatus(status)
        val offset = cursor?.let(CursorCodec::decodeOffset) ?: 0
        val clampedLimit = limit.coerceIn(1, MAX_SESSION_LIMIT)
        val matched = replayStore.sessions(q?.takeIf(String::isNotBlank), isLive)
        val page = Paging.slice(matched, offset, clampedLimit)
        return SessionsResponse(
            items = page.items.map { session ->
                SessionSummaryResponse(
                    sessionId = session.id,
                    agentLabel = session.agentLabel,
                    startedAt = session.startedAt,
                    endedAt = session.endedAt,
                    isLive = session.isLive,
                    eventCount = replayStore.eventCount(session.id),
                    verdictSummary = replayStore.verdictSummary(session.id),
                )
            },
            nextCursor = page.nextCursor,
        )
    }

    @GetMapping("/sessions/{sessionId}/timeline")
    fun timeline(
        @PathVariable sessionId: String,
        @RequestParam(required = false, name = "event") eventId: String?,
        @RequestParam(required = false) since: String?,
        @RequestParam(required = false) cursor: String?,
        @RequestParam(required = false, defaultValue = "200") limit: Int,
    ): SessionTimelineResponse {
        val id = parseUuidOrNull(sessionId) ?: notFoundSession(sessionId)
        val session = replayStore.session(id) ?: notFoundSession(sessionId)
        val allNodes = replayStore.timeline(id) ?: notFoundSession(sessionId)

        val anchor = eventId?.let { raw ->
            parseUuidOrNull(raw)?.let { candidate -> allNodes.firstOrNull { it.eventId == candidate } }
                ?: throw ApiException(
                    HttpStatus.BAD_REQUEST,
                    "event_not_in_session",
                    "event $raw is not part of session $sessionId",
                )
        }

        val sinceInstant = since?.let(::parseInstantOrBadRequest)
        val filtered = sinceInstant?.let { s -> allNodes.filter { it.ts.isAfter(s) } } ?: allNodes
        val offset = cursor?.let(CursorCodec::decodeOffset) ?: 0
        val clampedLimit = limit.coerceIn(1, MAX_TIMELINE_LIMIT)

        // `cursor` means the client is already paging through a prior response, anchor or not:
        // once paging has started, offset/limit must win or `nextCursor` would loop forever.
        val page = when {
            cursor != null -> Paging.slice(filtered, offset, clampedLimit)
            anchor != null && filtered.size > ANCHOR_WINDOW_THRESHOLD -> anchoredWindow(filtered, anchor)
            // Small session with an anchor: spec 4.3 says returning everything is fine, so ignore `limit`.
            anchor != null -> Paging.Result(filtered, null)
            else -> Paging.slice(filtered, offset, clampedLimit)
        }

        val chain = replayStore.chainResult(id)
        return SessionTimelineResponse(
            sessionId = id,
            agentLabel = session.agentLabel,
            startedAt = session.startedAt,
            isLive = session.isLive,
            chainStatus = chain.status,
            brokenAt = chain.brokenAt,
            nodes = page.items,
            nextCursor = page.nextCursor,
        )
    }

    @GetMapping("/events/{eventId}")
    fun event(@PathVariable eventId: String): EventLookupResponse {
        val id = parseUuidOrNull(eventId) ?: notFoundEvent(eventId)
        val (sessionId, node) = replayStore.node(id) ?: notFoundEvent(eventId)
        return EventLookupResponse(sessionId, node)
    }

    /** Anchors the response on `anchor`, returning up to [ANCHOR_WINDOW_RADIUS] nodes on either side (spec 4.3). */
    private fun anchoredWindow(nodes: List<TimelineNode>, anchor: TimelineNode): Paging.Result<TimelineNode> {
        val anchorIndex = nodes.indexOf(anchor)
        if (anchorIndex < 0) return Paging.slice(nodes, 0, ANCHOR_WINDOW_THRESHOLD)
        val start = (anchorIndex - ANCHOR_WINDOW_RADIUS).coerceAtLeast(0)
        val end = (anchorIndex + ANCHOR_WINDOW_RADIUS + 1).coerceAtMost(nodes.size)
        val next = if (end < nodes.size) CursorCodec.encode(end) else null
        return Paging.Result(nodes.subList(start, end), next)
    }

    private fun parseStatus(status: String?): Boolean? = when (status) {
        null -> null
        "live" -> true
        "closed" -> false
        else -> throw ApiException(HttpStatus.BAD_REQUEST, "invalid_session_status", "status must be 'live' or 'closed'")
    }

    private fun parseUuidOrNull(raw: String): UUID? = runCatching { UUID.fromString(raw) }.getOrNull()

    private fun parseInstantOrBadRequest(raw: String): Instant = try {
        Instant.parse(raw)
    } catch (e: DateTimeParseException) {
        throw ApiException(HttpStatus.BAD_REQUEST, "invalid_since", "since must be an ISO-8601 instant")
    }

    private fun notFoundSession(raw: String): Nothing =
        throw ApiException(HttpStatus.NOT_FOUND, "session_not_found", "session $raw not found")

    private fun notFoundEvent(raw: String): Nothing =
        throw ApiException(HttpStatus.NOT_FOUND, "event_not_found", "event $raw not found")

    companion object {
        private const val MAX_SESSION_LIMIT = 100
        private const val MAX_TIMELINE_LIMIT = 1000
        private const val ANCHOR_WINDOW_RADIUS = 50
        private const val ANCHOR_WINDOW_THRESHOLD = 200
    }
}
