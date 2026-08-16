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
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter

/**
 * `failMode`/`riskAcknowledged` are this ticket's own fields (GMCP-68 §2.1/REQ-08); the other
 * three ride along on the same request/response shape because the console's `SettingsUpdate`
 * (`Partial<GatewaySettings>`) already sends them from the same screen (SCR-501) — see
 * `SettingsResponse`'s doc comment.
 */
data class SettingsUpdateRequest(
    val failMode: String? = null,
    val riskAcknowledged: Boolean? = null,
    val storeRawOptIn: Boolean? = null,
    val locale: String? = null,
    val approvalTimeoutSeconds: Int? = null,
)

/** GMCP-68 §5.1, concretizing the `PUT /api/v1/settings` the plan already named. */
@RestController
@RequestMapping("/api/v1")
class SettingsController(private val store: GuardSettingsStore) {
    @GetMapping("/settings")
    fun getSettings(): SettingsResponse = store.current().toResponse()

    @PutMapping("/settings")
    fun updateSettings(@RequestBody request: SettingsUpdateRequest, servletRequest: HttpServletRequest): SettingsResponse {
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
        return store.update(
            failurePolicy = failMode,
            riskAcknowledged = request.riskAcknowledged,
            storeRawOptIn = request.storeRawOptIn,
            locale = request.locale,
            approvalTimeoutSeconds = request.approvalTimeoutSeconds,
            // No console auth exists yet — same placeholder ServerRegistryStore.changeTrust uses
            // for a confirmed trust upgrade's `trustLevelUpdatedBy`.
            actor = "console",
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
        const val STREAM_TIMEOUT_MS = 30 * 60 * 1000L
    }
}
