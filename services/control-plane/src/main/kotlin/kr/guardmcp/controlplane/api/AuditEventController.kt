package kr.guardmcp.controlplane.api

import com.fasterxml.jackson.annotation.JsonInclude
import kr.guardmcp.controlplane.domain.AuditStructuredLogger
import kr.guardmcp.controlplane.domain.GuardAction
import kr.guardmcp.controlplane.domain.GuardEventRecord
import kr.guardmcp.controlplane.domain.GuardEventRepository
import org.springframework.beans.factory.annotation.Value
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.math.BigDecimal
import java.time.Instant
import java.time.format.DateTimeParseException
import java.util.UUID

/**
 * Wire contract matches the gateway's `GuardEvent` (packages/gateway/src/pipeline/types.ts) plus
 * an optional `rawPayload` the gateway only ever sends when its own opt-in flag
 * (`AUDIT_STORE_RAW_PAYLOAD`) is set — see [AuditEventController.ingest] for the second gate
 * on this side.
 */
data class GuardEventIngestRequest(
    val eventId: UUID,
    val sessionId: String,
    val ts: Instant,
    val direction: String,
    val toolName: String,
    val argsDigest: String,
    val verdict: String,
    val riskScore: BigDecimal,
    val matchedPolicyIds: List<String>? = null,
    val detections: List<Map<String, Any?>>? = null,
    val maskDiffRef: String? = null,
    val rawPayload: String? = null,
)

data class GuardEventIngestResponse(val eventId: UUID, val stored: Boolean)

/**
 * `apps/console/lib/api/types.ts`'s `SecurityEvent` — the SCR-101 "최근 보안 이벤트" widget's lean
 * shape, not the full `GuardEvent` (policies/detections stay in the Replay timeline detail,
 * `GET /events/{id}`, which already serves them). `target` has no reliable source yet (only an
 * `argsDigest` is stored, never raw arguments) so it is always omitted rather than sent null.
 */
data class SecurityEvent(
    val id: UUID,
    val sessionId: String,
    val verdict: String,
    val tool: String,
    @get:JsonInclude(JsonInclude.Include.NON_NULL) val target: String? = null,
    val at: Instant,
)

data class RecentEventsResponse(val events: List<SecurityEvent>)

/** Pipeline stage ⑧ (Audit Logger) ingest endpoint. Fed by the gateway's Event Emitter (§5). */
@RestController
@RequestMapping("/api/v1")
class AuditEventController(
    private val repository: GuardEventRepository,
    private val auditLog: AuditStructuredLogger,
    @param:Value("\${audit.store-raw-payload:false}") private val storeRawPayload: Boolean,
) {
    @PostMapping("/events")
    @ResponseStatus(HttpStatus.CREATED)
    fun ingest(@RequestBody request: GuardEventIngestRequest): GuardEventIngestResponse {
        if (request.sessionId.isBlank()) {
            throw ApiException(HttpStatus.BAD_REQUEST, "invalid_session_id", "sessionId must not be blank")
        }
        if (request.toolName.isBlank()) {
            throw ApiException(HttpStatus.BAD_REQUEST, "invalid_tool_name", "toolName must not be blank")
        }
        if (request.argsDigest.isBlank()) {
            throw ApiException(HttpStatus.BAD_REQUEST, "invalid_args_digest", "argsDigest must not be blank")
        }
        if (request.direction !in VALID_DIRECTIONS) {
            throw ApiException(HttpStatus.BAD_REQUEST, "invalid_direction", "direction must be one of $VALID_DIRECTIONS")
        }
        val verdict = GuardAction.fromWire(request.verdict)
            ?: throw ApiException(HttpStatus.BAD_REQUEST, "invalid_verdict", "unknown verdict '${request.verdict}'")

        val record = GuardEventRecord(
            eventId = request.eventId,
            sessionId = request.sessionId,
            ts = request.ts,
            direction = request.direction,
            toolName = request.toolName,
            argsDigest = request.argsDigest,
            verdict = verdict.wire,
            riskScore = request.riskScore,
            matchedPolicyIds = request.matchedPolicyIds ?: emptyList(),
            detections = request.detections ?: emptyList(),
            maskDiffRef = request.maskDiffRef,
            // NFR-04: persisted only when THIS service has opted in, regardless of what the
            // gateway sent — defense in depth against a misconfigured or compromised emitter.
            rawPayload = request.rawPayload?.takeIf { storeRawPayload },
        )
        val stored = repository.insert(record)
        auditLog.logIngested(record)
        return GuardEventIngestResponse(record.eventId, stored)
    }

    /**
     * GMCP-80 §3.3: the SCR-101 "최근 보안 이벤트" widget, and the gap-fill an SSE client polls
     * once it reconnects (4.2: "복구 시 끊긴 구간은 폴링으로 보충"). `since` accepts either an
     * eventId (resume strictly after that event) or an ISO-8601 instant (resume from that
     * moment onward) — see [GuardEventRepository.findRecent] for why the boundary comparison
     * needs both `ts` and `eventId`.
     */
    @GetMapping("/events/recent")
    fun recent(
        @RequestParam(required = false, defaultValue = "20") limit: Int,
        @RequestParam(required = false) sessionId: String?,
        @RequestParam(required = false) since: String?,
    ): RecentEventsResponse {
        val clampedLimit = limit.coerceIn(1, MAX_RECENT_LIMIT)
        val (sinceTs, sinceEventId) = resolveSince(since)
        val records = repository.findRecent(clampedLimit, sessionId?.takeIf(String::isNotBlank), sinceTs, sinceEventId)
        return RecentEventsResponse(records.map(::toSecurityEvent))
    }

    private fun resolveSince(raw: String?): Pair<Instant?, UUID?> {
        if (raw == null) return null to null
        val asEventId = runCatching { UUID.fromString(raw) }.getOrNull()
        if (asEventId != null) {
            val anchor = repository.findById(asEventId)
                ?: throw ApiException(HttpStatus.BAD_REQUEST, "since_event_not_found", "since event $raw not found")
            return anchor.ts to anchor.eventId
        }
        val asInstant = try {
            Instant.parse(raw)
        } catch (e: DateTimeParseException) {
            throw ApiException(HttpStatus.BAD_REQUEST, "invalid_since", "since must be an eventId or an ISO-8601 instant")
        }
        // No specific event to exclude at this instant, so anchor the tie-break at the lowest
        // possible UUID: every real event at exactly `asInstant` still sorts after it and is included.
        return asInstant to MIN_UUID
    }

    private fun toSecurityEvent(record: GuardEventRecord): SecurityEvent =
        SecurityEvent(
            id = record.eventId,
            sessionId = record.sessionId,
            // The console's Verdict is 4-valued; mask_then_allow collapses into warn, matching
            // ReplayModels.Verdict's existing GuardAction -> Verdict convention.
            verdict = if (record.verdict == "mask_then_allow") "warn" else record.verdict,
            tool = record.toolName,
            at = record.ts,
        )

    companion object {
        private val VALID_DIRECTIONS = setOf("request", "response")
        private const val MAX_RECENT_LIMIT = 100
        private val MIN_UUID = UUID(0L, 0L)
    }
}
