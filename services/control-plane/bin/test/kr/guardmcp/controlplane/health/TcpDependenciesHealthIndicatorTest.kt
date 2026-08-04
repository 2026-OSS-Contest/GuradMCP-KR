package kr.guardmcp.controlplane.health

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.springframework.boot.health.contributor.Status

class TcpDependenciesHealthIndicatorTest {
    @Test
    fun `health is up when no external dependency list is configured`() {
        assertEquals(Status.UP, TcpDependenciesHealthIndicator().health().status)
    }
}
