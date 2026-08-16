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
 * `GET`/`PUT`/`stream /api/v1/settings` (GMCP-68 §5.1, GMCP-80 §3.8.2). No console session/auth
 * exists anywhere in this service yet (see [Actor]'s doc comment), and GMCP-68 already wired
 * this endpoint end to end — console -> `PUT` -> Postgres -> SSE -> gateway cache — with no
 * role check. `X-Actor-Id` is read only for the audit trail's `updatedBy` (same "record who, but
 * don't gate on it" placeholder [kr.guardmcp.controlplane.domain.ServerRegistryStore.changeTrust]
 * uses), not as an access-control gate: a real gate here would 403 every request the console
 * actually sends today (it sends neither header — `apps/console/lib/api/client.ts` has no
 * `X-Actor-*` anywhere) while doing nothing against a direct API call, which can set the header
 * to whatever it wants. The real trust boundary this endpoint has is `riskAcknowledged` below.
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
