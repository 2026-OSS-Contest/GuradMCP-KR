package kr.guardmcp.controlplane.domain

import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component

/**
 * §5.1 Control Plane: "120초 경과 후 미결정 상태면 서버 측에서 자동 decision: block을 Gateway로
 * push (fail-closed)." There is no outbound push channel to the gateway — the gateway instead
 * polls `GET /api/v1/approvals` (§10) while it waits, so flipping the record here is what the
 * gateway's poll picks up as the fail-closed block. `ApprovalStore.get()`/`list()` also sweep
 * opportunistically, so this tick only bounds the worst-case staleness between polls.
 */
@Component
class ApprovalTimeoutScheduler(private val approvalStore: ApprovalStore) {
    @Scheduled(fixedDelay = 1_000)
    fun sweep() {
        approvalStore.sweepExpired()
    }
}
