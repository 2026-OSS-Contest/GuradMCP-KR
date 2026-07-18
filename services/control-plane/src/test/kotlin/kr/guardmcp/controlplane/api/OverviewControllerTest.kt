package kr.guardmcp.controlplane.api

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class OverviewControllerTest {
    @Test
    fun `overview exposes deterministic protected state`() {
        val overview = OverviewController().overview()

        assertTrue(overview.protected)
        assertEquals(listOf("default", "korean-pii"), overview.activePolicyPacks)
        assertEquals(1, overview.gatewayCount)
    }
}
