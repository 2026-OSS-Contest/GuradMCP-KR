package kr.guardmcp.controlplane.domain

import kr.guardmcp.controlplane.api.Actor
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component
import java.security.MessageDigest

/** GMCP-84 §7's two claims. Deliberately just these two -- full RBAC is out of scope (§2). */
enum class Permission(val wire: String) {
    EVENTS_REVEAL("events:reveal"),
    SETTINGS_WRITE("settings:write"),
}

/**
 * §7: "PermissionService.hasPermission(principal, "events:reveal")" -- a single entry point every
 * caller in this codebase goes through instead of checking [Actor.role] directly, so a future
 * real RBAC system only has to replace the body of [hasPermission], not every call site.
 *
 * MVP roles are fixed and env/config-assigned, not derived from any session/login this service
 * doesn't have (see [Actor]'s doc comment: a role header alone is forgeable). For both claims
 * this MVP keeps GMCP-80's original reveal gate rather than weakening it to a bare role check:
 * [PRIVILEGED_ROLES] is who can hold either permission at all, and [operatorToken] is the actual
 * secret a caller must also present -- a server-side value that must be configured out of band,
 * matching this codebase's existing fail-closed default (blank token = both permissions
 * unreachable, not merely role-gated).
 */
@Component
class PermissionService(
    @Value("\${security.reveal-token:}") private val operatorToken: String,
) {
    fun hasPermission(actor: Actor, permission: Permission, presentedToken: String?): Boolean {
        if (actor.role !in PRIVILEGED_ROLES) return false
        return hasValidOperatorToken(presentedToken)
    }

    /** Constant-time comparison; a blank [operatorToken] (unconfigured) always denies. */
    private fun hasValidOperatorToken(presentedToken: String?): Boolean {
        if (operatorToken.isBlank() || presentedToken.isNullOrBlank()) return false
        return MessageDigest.isEqual(operatorToken.toByteArray(), presentedToken.toByteArray())
    }

    private companion object {
        val PRIVILEGED_ROLES = setOf(Actor.OPERATOR_ROLE, "admin")
    }
}
