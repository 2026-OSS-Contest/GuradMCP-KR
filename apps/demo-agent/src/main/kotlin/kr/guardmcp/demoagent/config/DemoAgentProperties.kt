package kr.guardmcp.demoagent.config

import org.springframework.boot.context.properties.ConfigurationProperties

/**
 * The guarded and vulnerable demo paths differ only in which MCP endpoint the agent
 * talks to — the whole point of the "swap the endpoint URL, change no agent code"
 * onboarding story (proposal 4.3). Everything else in the request path is identical.
 */
@ConfigurationProperties(prefix = "guardmcp")
data class DemoAgentProperties(
    val serviceName: String = "demo-agent",
    val gatewayUrl: String = "http://localhost:3001",
    val demoMcpToolsUrl: String = "http://localhost:3003",
    /** Comma-separated health URLs; falls back to the gateway and tools when empty. */
    val dependencyUrls: String = "",
) {
    fun dependencyHealthUrls(): List<String> {
        val configured = dependencyUrls.split(",").map(String::trim).filter(String::isNotEmpty)
        return configured.ifEmpty {
            listOf("$gatewayUrl/health", "$demoMcpToolsUrl/health")
        }
    }
}
