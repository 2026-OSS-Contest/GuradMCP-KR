package kr.guardmcp.controlplane.api

import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.core.env.Environment
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.testcontainers.postgresql.PostgreSQLContainer
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse

/**
 * Shared HTTP scaffolding for the RANDOM_PORT API tests. Spring Boot 4 exposes neither
 * TestRestTemplate nor a com.fasterxml ObjectMapper bean, so the tests drive the server
 * with the JDK HTTP client and parse JSON with their own mapper.
 *
 * Every `@SpringBootTest` now needs a real datasource (GMCP-24 wires Flyway + JDBC), so this
 * base class starts one Postgres container and shares it across all subclasses/test JVM
 * forks (the "singleton container" pattern) instead of each test class paying its own
 * startup cost.
 */
abstract class ApiTestSupport {
    @Autowired
    private lateinit var environment: Environment

    protected val objectMapper = ObjectMapper()
    protected val client: HttpClient = HttpClient.newHttpClient()

    protected fun uri(path: String): URI =
        URI.create("http://localhost:${environment.getProperty("local.server.port")}$path")

    protected fun get(path: String): HttpResponse<String> =
        client.send(HttpRequest.newBuilder(uri(path)).GET().build(), HttpResponse.BodyHandlers.ofString())

    protected fun send(method: String, path: String, body: Any?): HttpResponse<String> {
        val publisher = body?.let { HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(it)) }
            ?: HttpRequest.BodyPublishers.noBody()
        val request = HttpRequest.newBuilder(uri(path))
            .header("Content-Type", "application/json")
            .method(method, publisher)
            .build()
        return client.send(request, HttpResponse.BodyHandlers.ofString())
    }

    protected fun parseMap(body: String): Map<String, Any?> =
        objectMapper.readValue(body, object : TypeReference<Map<String, Any?>>() {})

    protected fun parseList(body: String): List<Map<String, Any?>> =
        objectMapper.readValue(body, object : TypeReference<List<Map<String, Any?>>>() {})

    companion object {
        private val postgres = PostgreSQLContainer("postgres:16-alpine").apply { start() }

        @JvmStatic
        @DynamicPropertySource
        fun registerDataSource(registry: DynamicPropertyRegistry) {
            registry.add("spring.datasource.url", postgres::getJdbcUrl)
            registry.add("spring.datasource.username", postgres::getUsername)
            registry.add("spring.datasource.password", postgres::getPassword)
        }
    }
}
