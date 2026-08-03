package kr.guardmcp.controlplane.api

import kr.guardmcp.controlplane.domain.AuditStructuredLogger
import kr.guardmcp.controlplane.domain.GuardAction
import kr.guardmcp.controlplane.domain.GuardEventRecord
import kr.guardmcp.controlplane.domain.GuardEventRepository
import org.springframework.beans.factory.annotation.Value
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.math.BigDecimal
import java.time.Instant
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

    companion object {
        private val VALID_DIRECTIONS = setOf("request", "response")
    }
}
