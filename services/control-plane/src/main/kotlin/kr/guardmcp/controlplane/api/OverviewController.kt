package kr.guardmcp.controlplane.api

import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

data class Overview(
    val protected: Boolean,
    val gatewayCount: Int,
    val activePolicyPacks: List<String>,
    val blockedToday: Int,
)

@RestController
@RequestMapping("/api/v1")
class OverviewController {
    @GetMapping("/overview")
    fun overview() = Overview(
        protected = true,
        gatewayCount = 1,
        activePolicyPacks = listOf("default", "korean-pii"),
        blockedToday = 0,
    )

    @GetMapping("/policies")
    fun policies() = mapOf(
        "packs" to listOf("default", "korean-pii"),
        "documentation" to "/docs/policy-guide/README.md",
    )
}
