package kr.guardmcp.demoagent.api

import kr.guardmcp.demoagent.config.DemoAgentProperties
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

data class DependencyHealth(val url: String, val up: Boolean)
data class HealthResponse(val status: String, val service: String, val dependencies: List<DependencyHealth>)

/**
 * Same `/health` contract the TypeScript stub exposed and that GMCP-30 readiness plus
 * the Docker healthcheck poll: `{status, service, dependencies}`, HTTP 200 when every
 * dependency is reachable and 503 otherwise.
 */
@RestController
class HealthController(
    private val properties: DemoAgentProperties,
    private val httpClient: HttpClient,
) {
    @GetMapping("/health")
    fun health(): ResponseEntity<HealthResponse> {
        val dependencies = properties.dependencyHealthUrls().map { url ->
            DependencyHealth(url, reachable(url))
        }
        val up = dependencies.all(DependencyHealth::up)
        val response = HealthResponse(
            status = if (up) "UP" else "DOWN",
            service = properties.serviceName,
            dependencies = dependencies,
        )
        return ResponseEntity.status(if (up) 200 else 503).body(response)
    }

    private fun reachable(url: String): Boolean = runCatching {
        val response = httpClient.send(
            HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofMillis(1_500))
                .GET()
                .build(),
            HttpResponse.BodyHandlers.discarding(),
        )
        response.statusCode() in 200..299
    }.getOrDefault(false)
}
