package kr.guardmcp.controlplane.api

import kr.guardmcp.controlplane.domain.ApprovalStore
import kr.guardmcp.controlplane.domain.GuardAction
import kr.guardmcp.controlplane.domain.GuardEventStore
import kr.guardmcp.controlplane.domain.PolicyStore
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.time.Clock
import java.time.Instant
import java.time.temporal.ChronoUnit

data class Overview(
    val protected: Boolean,
    val gatewayCount: Int,
    val activePolicyPacks: List<String>,
    val blockedToday: Int,
    val maskedToday: Int,
    val pendingApprovals: Int,
    val generatedAt: Instant,
)

@RestController
@RequestMapping("/api/v1")
class OverviewController(
    private val policyStore: PolicyStore,
    private val eventStore: GuardEventStore,
    private val approvalStore: ApprovalStore,
    private val clock: Clock,
) {
    @GetMapping("/overview")
    fun overview(): Overview {
        val startOfToday = clock.instant().truncatedTo(ChronoUnit.DAYS)
        val activePacks = policyStore.enabledPackIds()
        return Overview(
            protected = activePacks.isNotEmpty(),
            gatewayCount = 1,
            activePolicyPacks = activePacks,
            blockedToday = eventStore.countByVerdictSince(GuardAction.BLOCK, startOfToday),
            maskedToday = eventStore.countByVerdictSince(GuardAction.MASK_THEN_ALLOW, startOfToday),
            pendingApprovals = approvalStore.countPending(),
            generatedAt = clock.instant(),
        )
    }
}
