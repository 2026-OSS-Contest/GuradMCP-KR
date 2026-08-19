package kr.guardmcp.controlplane.api

import jakarta.servlet.http.HttpServletRequest
import kr.guardmcp.controlplane.domain.FailurePolicy
import kr.guardmcp.controlplane.domain.GuardSettingsStore
import kr.guardmcp.controlplane.domain.Permission
import kr.guardmcp.controlplane.domain.PermissionService
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
 * `failMode`/`riskAcknowledged` are GMCP-68's own fields (§2.1/REQ-08); `rawPayloadStorageEnabled`/
 * `locale`/`approvalTimeoutSeconds` ride along on the same request/response shape because the
 * console's `SettingsUpdate` (`Partial<GatewaySettings>`) already sends them from the same
 * screen (SCR-501). `acknowledgedNotice` (GMCP-84 §6.2) only matters on the specific
 * false→true `rawPayloadStorageEnabled` transition — see [updateSettings].
 */
data class SettingsUpdateRequest(
    val failMode: String? = null,
    val riskAcknowledged: Boolean? = null,
    val rawPayloadStorageEnabled: Boolean? = null,
    val acknowledgedNotice: Boolean? = null,
    val locale: String? = null,
    val approvalTimeoutSeconds: Int? = null,
)

/**
 * `GET`/`PUT`/`stream /api/v1/settings` (GMCP-68 §5.1, GMCP-84 §6.1/§6.2). No console session/auth
 * exists anywhere in this service yet (see [Actor]'s doc comment), and GMCP-68 originally wired
 * this endpoint end to end — console -> `PUT` -> Postgres -> SSE -> gateway cache — with no role
 * check at all. That absence of a gate stands for `failMode`/`locale`/`approvalTimeoutSeconds`
 * still (a real gate there would 403 every request the console sends today, since it sends no
 * `X-Actor-*`/[Actor.OPERATOR_TOKEN_HEADER] headers). `rawPayloadStorageEnabled` is different:
 * GMCP-84 §7 explicitly requires `settings:write` for "the opt-in toggle", so only a request that
 * actually touches this field goes through [PermissionService] — the console must start sending
 * the operator headers, but only for this one control (see SCR-501 §8.1).
 */
@RestController
@RequestMapping("/api/v1")
class SettingsController(private val store: GuardSettingsStore, private val permissionService: PermissionService) {
    @GetMapping("/settings")
    fun getSettings(): SettingsResponse = store.current().toResponse()

    @PutMapping("/settings")
    fun updateSettings(
        @RequestBody request: SettingsUpdateRequest,
        @RequestHeader(value = Actor.ID_HEADER, required = false) actorId: String?,
        @RequestHeader(value = Actor.ROLE_HEADER, required = false) actorRole: String?,
        @RequestHeader(value = Actor.OPERATOR_TOKEN_HEADER, required = false) operatorToken: String?,
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

        val before = store.current()
        if (request.rawPayloadStorageEnabled != null) {
            // §7: "PUT /settings의 opt-in 토글도 같은 권한(settings:write)으로 보호한다" — scoped to
            // this field so the console's existing failMode/locale-only calls, which send none
            // of these headers, keep working unchanged.
            if (!permissionService.hasPermission(actor, Permission.SETTINGS_WRITE, operatorToken)) {
                throw ApiException(HttpStatus.FORBIDDEN, "settings_forbidden", "settings:write permission required")
            }
            // §6.2: off→on requires the console's notice-modal acknowledgement, enforced here so
            // it cannot be bypassed by calling the API directly.
            if (!before.rawPayloadStorageEnabled && request.rawPayloadStorageEnabled && request.acknowledgedNotice != true) {
                throw ApiException(
                    HttpStatus.UNPROCESSABLE_ENTITY,
                    "acknowledgment_required",
                    "rawPayloadStorageEnabled requires acknowledgedNotice=true",
                )
            }
        }

        val updated = store.update(
            failurePolicy = failMode,
            riskAcknowledged = request.riskAcknowledged,
            rawPayloadStorageEnabled = request.rawPayloadStorageEnabled,
            locale = request.locale,
            approvalTimeoutSeconds = request.approvalTimeoutSeconds,
            actor = actor.id,
            requestIp = servletRequest.remoteAddr,
        )
        // §6.2: opt-in withdrawal never deletes what's already stored — say so once, on the
        // response to the request that just did it, rather than on every subsequent GET.
        val note = if (before.rawPayloadStorageEnabled && !updated.rawPayloadStorageEnabled) {
            "기존에 저장된 원문은 유지됩니다. 삭제하려면 별도 요청이 필요합니다."
        } else {
            null
        }
        return updated.toResponse(note)
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
