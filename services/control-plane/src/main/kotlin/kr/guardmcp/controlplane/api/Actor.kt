package kr.guardmcp.controlplane.api

/**
 * Narrow actor seam (GMCP-80 §2 "운영자 role", §3.6 reveal, §3.8 settings). No console
 * session/auth exists anywhere in this service yet — [kr.guardmcp.controlplane.domain
 * .ServerRegistryStore]'s trust-change handler already notes this ("No console auth exists
 * yet") and records `"console"` as a stand-in confirmer. Reveal and settings need an actual
 * operator-vs-not distinction, so this reads two request headers instead of a real principal.
 * A request that sends neither is never treated as an operator — the least-privileged default.
 */
data class Actor(val id: String, val role: String) {
    val isOperator: Boolean get() = role == OPERATOR_ROLE

    companion object {
        const val ID_HEADER = "X-Actor-Id"
        const val ROLE_HEADER = "X-Actor-Role"
        const val OPERATOR_ROLE = "operator"

        /** GMCP-84 §7: the shared secret [kr.guardmcp.controlplane.domain.PermissionService]
         *  requires alongside a privileged role, for both `events:reveal` and `settings:write`. */
        const val OPERATOR_TOKEN_HEADER = "X-Operator-Token"

        fun from(actorId: String?, actorRole: String?): Actor =
            Actor(id = actorId?.takeIf(String::isNotBlank) ?: "anonymous", role = actorRole?.takeIf(String::isNotBlank) ?: "viewer")
    }
}
