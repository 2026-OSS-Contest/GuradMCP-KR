package kr.guardmcp.controlplane.api

import jakarta.servlet.http.HttpServletRequest
import kr.guardmcp.controlplane.domain.FailurePolicy
import kr.guardmcp.controlplane.domain.GuardSettingsStore
import kr.guardmcp.controlplane.domain.SettingsResponse
import kr.guardmcp.controlplane.domain.toResponse
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter

/**
 * `failMode`/`riskAcknowledged` are GMCP-68's own fields (§2.1/REQ-08); `storeRawOptIn`/
 * `locale`/`approvalTimeoutSeconds` ride along on the same request/response shape because the
 * console's `SettingsUpdate` (`Partial<GatewaySettings>`) already sends them from the same
 * screen (SCR-501, GMCP-80 §3.8.2) — see `SettingsResponse`'s doc comment.
 */
data class SettingsUpdateRequest(
    val failMode: String? = null,
    val riskAcknowledged: Boolean? = null,
    val storeRawOptIn: Boolean? = null,
    val locale: String? = null,
    val approvalTimeoutSeconds: Int? = null,
)

/**
 * `GET`/`PUT`/`stream /api/v1/settings` (GMCP-68 §5.1, GMCP-80 §3.8.2). `PUT` requires the
 * operator role, per §2's common rules — GMCP-68 didn't have a console session to check against
 * yet, so this keeps GMCP-80's `X-Actor-*` header check on top of GMCP-68's Postgres-backed
 * store and `riskAcknowledged` gate rather than dropping it.
 */
@RestController
@RequestMapping("/api/v1")
class SettingsController(private val store: GuardSettingsStore) {
    @GetMapping("/settings")
    fun getSettings(): SettingsResponse = store.current().toResponse()

    @PutMapping("/settings")
    fun updateSettings(
        @RequestBody request: SettingsUpdateRequest,
        @RequestHeader(value = Actor.ID_HEADER, required = false) actorId: String?,
        @RequestHeader(value = Actor.ROLE_HEADER, required = false) actorRole: String?,
        servletRequest: HttpServletRequest,
    ): SettingsResponse {
        val actor = Actor.from(actorId, actorRole)
        if (!actor.isOperator) {
            throw ApiException(HttpStatus.FORBIDDEN, "settings_update_forbidden", "updating settings requires the operator role")
        }
        val failMode = request.failMode?.let {
            FailurePolicy.fromWire(it)
                ?: throw ApiException(HttpStatus.BAD_REQUEST, "invalid_fail_mode", "unknown failMode '$it'")
        }
        // REQ-08: the console's own checkbox already gates this client-side, but the server is
        // the trust boundary — a direct API call must be rejected too, regardless of what the UI did.
        // REQ-09: reverting to fail_closed (or any other field) never requires this.
        if (failMode == FailurePolicy.FAIL_OPEN && request.riskAcknowledged != true) {
            throw ApiException(
                HttpStatus.BAD_REQUEST,
                "risk_not_acknowledged",
                "fail_open requires riskAcknowledged=true",
            )
        }
        if (request.locale != null && request.locale !in VALID_LOCALES) {
            throw ApiException(HttpStatus.BAD_REQUEST, "invalid_locale", "locale must be one of $VALID_LOCALES")
        }
        if (request.approvalTimeoutSeconds != null && request.approvalTimeoutSeconds !in MIN_APPROVAL_TIMEOUT_SECONDS..MAX_APPROVAL_TIMEOUT_SECONDS) {
            throw ApiException(
                HttpStatus.BAD_REQUEST,
                "invalid_approval_timeout",
                "approvalTimeoutSeconds must be between $MIN_APPROVAL_TIMEOUT_SECONDS and $MAX_APPROVAL_TIMEOUT_SECONDS",
            )
        }

        return store.update(
            failurePolicy = failMode,
            riskAcknowledged = request.riskAcknowledged,
            storeRawOptIn = request.storeRawOptIn,
            locale = request.locale,
            approvalTimeoutSeconds = request.approvalTimeoutSeconds,
            actor = actor.id,
            requestIp = servletRequest.remoteAddr,
        ).toResponse()
    }

    /** Hot-reload push channel for the gateway's failure-policy cache (§4.3, mirrors /servers/stream). */
    @GetMapping("/settings/stream", produces = [MediaType.TEXT_EVENT_STREAM_VALUE])
    fun stream(): SseEmitter {
        // Bounded rather than infinite, same reasoning as ServerController.stream: an abandoned
        // connection should eventually free its server thread, and the gateway's SSE client
        // reconnects on its own.
        val emitter = SseEmitter(STREAM_TIMEOUT_MS)
        store.subscribe(emitter)
        return emitter
    }

    private companion object {
        val VALID_LOCALES = setOf("ko", "en")
        const val MIN_APPROVAL_TIMEOUT_SECONDS = 1
        const val MAX_APPROVAL_TIMEOUT_SECONDS = 3600
        const val STREAM_TIMEOUT_MS = 30 * 60 * 1000L
    }
}
