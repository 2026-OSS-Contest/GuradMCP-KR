package kr.guardmcp.controlplane.api

import kr.guardmcp.controlplane.domain.ApprovalStore
import kr.guardmcp.controlplane.domain.EventBroadcaster
import kr.guardmcp.controlplane.domain.GuardEventStore
import kr.guardmcp.controlplane.domain.PolicyFixtures
import kr.guardmcp.controlplane.domain.PolicyStore
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

class OverviewControllerTest {
    private val clock = Clock.fixed(Instant.parse("2026-01-01T12:00:00Z"), ZoneOffset.UTC)
    private val policyStore = PolicyStore(clock).also(PolicyFixtures::syncInto)
    private val controller = OverviewController(policyStore, GuardEventStore(), ApprovalStore(clock, EventBroadcaster()), clock)

    @Test
    fun `overview exposes deterministic protected state`() {
        val overview = controller.overview()

        assertTrue(overview.protected)
        assertEquals(listOf("default", "korean-pii"), overview.activePolicyPacks)
        assertEquals(1, overview.gatewayCount)
    }

    @Test
    fun `overview counts the seeded verdicts for the seed day`() {
        val overview = controller.overview()

        assertEquals(1, overview.blockedToday)
        assertEquals(1, overview.maskedToday)
        assertEquals(1, overview.pendingApprovals)
    }
}
