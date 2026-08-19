package kr.guardmcp.controlplane.api

import com.fasterxml.jackson.annotation.JsonInclude
import jakarta.servlet.http.HttpServletRequest
import kr.guardmcp.controlplane.domain.AuditStructuredLogger
import kr.guardmcp.controlplane.domain.GuardAction
import kr.guardmcp.controlplane.domain.GuardEventDraft
import kr.guardmcp.controlplane.domain.GuardEventRecord
import kr.guardmcp.controlplane.domain.GuardEventRepository
import kr.guardmcp.controlplane.domain.GuardSettingsStore
import kr.guardmcp.controlplane.domain.Permission
import kr.guardmcp.controlplane.domain.PermissionService
import kr.guardmcp.controlplane.domain.RawPayloadStore
import kr.guardmcp.controlplane.domain.RevealAuditLog
import kr.guardmcp.controlplane.domain.RevealResult
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
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

data class RevealRequest(val reason: String? = null)

/**
 * GMCP-84 §6.3. Deliberately does **not** match `apps/console/lib/api/types.ts`'s
 * `RevealContent{source,caseId,raw,masked:ContentLine[]}` — that shape needs structured
 * masked-line reconstruction that exists nowhere in this codebase yet (the same gap
 * `ApiVerdictDetail.maskDiffRef`'s comment calls "out of scope: GET /events/{id}/mask-diff").
 * This is the spec's own response shape, implementable today straight from
 * [RawPayloadStore.decrypt]; wiring the console's richer reveal modal to it is follow-up
 * work once mask-line reconstruction exists.
 */
data class RevealResponse(
    val eventId: UUID,
    val rawPayload: String,
    val revealedBy: String,
    val revealedAt: Instant,
)

/** Pipeline stage ⑧ (Audit Logger) ingest endpoint. Fed by the gateway's Event Emitter (§5). */
@RestController
@RequestMapping("/api/v1")
class AuditEventController(
    private val repository: GuardEventRepository,
    private val auditLog: AuditStructuredLogger,
    private val revealAuditLog: RevealAuditLog,
    private val settingsStore: GuardSettingsStore,
    private val permissionService: PermissionService,
    private val rawPayloadStore: RawPayloadStore,
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

        val draft = GuardEventDraft(
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
            rawPayload = request.rawPayload?.takeIf { settingsStore.current().rawPayloadStorageEnabled },
        )
        // GuardEventRepository.insert assigns seq/prevHash/hash under the session lock (GMCP-83).
        val stored = repository.insert(draft)
        auditLog.logIngested(draft)
        return GuardEventIngestResponse(draft.eventId, stored)
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

    /**
     * GMCP-84 §6.3 (NFR-04): unmasked original payload for an event, `events:reveal`-only. Every
     * call — granted or denied — writes to [RevealAuditLog]; a denied attempt is itself a
     * security-relevant observation of someone trying to see unmasked content, not a case to
     * leave unlogged.
     *
     * Step order follows the spec (permission check, then existence, then storage) with one
     * deliberate exception: a syntactically invalid `eventId` 404s immediately, before the
     * permission check, because [RevealAuditLog] has nowhere to put a UUID-typed `event_id` for
     * something that was never a UUID at all — there is no meaningful "who tried to reveal
     * `not-a-uuid`" record to keep. A well-formed but unknown `eventId` *does* reach the
     * permission check first, matching §6.3 exactly.
     */
    @PostMapping("/events/{eventId}/reveal")
    fun reveal(
        @PathVariable eventId: String,
        @RequestBody(required = false) request: RevealRequest?,
        @RequestHeader(value = Actor.ID_HEADER, required = false) actorId: String?,
        @RequestHeader(value = Actor.ROLE_HEADER, required = false) actorRole: String?,
        @RequestHeader(value = Actor.OPERATOR_TOKEN_HEADER, required = false) operatorToken: String?,
        servletRequest: HttpServletRequest,
    ): RevealResponse {
        val id = runCatching { UUID.fromString(eventId) }.getOrNull()
            ?: throw ApiException(HttpStatus.NOT_FOUND, "event_not_found", "event $eventId not found")
        val actor = Actor.from(actorId, actorRole)
        val reason = request?.reason
        val sourceIp = servletRequest.remoteAddr

        if (!permissionService.hasPermission(actor, Permission.EVENTS_REVEAL, operatorToken)) {
            revealAuditLog.record(id, actor.id, reason, sourceIp, RevealResult.DENIED_NO_PERMISSION)
            throw ApiException(HttpStatus.FORBIDDEN, "reveal_forbidden", "reveal requires the events:reveal permission")
        }

        val record = repository.findById(id)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "event_not_found", "event $eventId not found")

        val rawPayload = record.rawPayloadRef?.let(rawPayloadStore::decrypt)
        if (rawPayload == null) {
            revealAuditLog.record(id, actor.id, reason, sourceIp, RevealResult.DENIED_NOT_STORED)
            throw ApiException(HttpStatus.CONFLICT, "raw_payload_not_stored", "original payload was not stored for event $eventId")
        }

        val entry = revealAuditLog.record(id, actor.id, reason, sourceIp, RevealResult.SUCCESS)
        return RevealResponse(
            eventId = id,
            rawPayload = rawPayload,
            revealedBy = actor.id,
            revealedAt = entry.revealedAt,
        )
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
