package kr.guardmcp.controlplane.health

import org.springframework.boot.health.contributor.Health
import org.springframework.boot.health.contributor.HealthIndicator
import org.springframework.stereotype.Component
import java.net.InetSocketAddress
import java.net.Socket

@Component
class TcpDependenciesHealthIndicator : HealthIndicator {
    override fun health(): Health {
        val targets = System.getenv("DEPENDENCY_TCP")
            ?.split(",")
            ?.map(String::trim)
            ?.filter(String::isNotEmpty)
            .orEmpty()
        val statuses = targets.associateWith(::reachable)
        val builder = if (statuses.values.all { it }) Health.up() else Health.down()
        return builder.withDetail("dependencies", statuses).build()
    }

    private fun reachable(target: String): Boolean {
        val separator = target.lastIndexOf(':')
        if (separator <= 0) return false
        val port = target.substring(separator + 1).toIntOrNull() ?: return false
        return runCatching {
            Socket().use { socket -> socket.connect(InetSocketAddress(target.substring(0, separator), port), 750) }
        }.isSuccess
    }
}
