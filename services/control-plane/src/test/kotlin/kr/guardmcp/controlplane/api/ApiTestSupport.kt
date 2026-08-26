package kr.guardmcp.controlplane.api

import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.core.env.Environment
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.testcontainers.postgresql.PostgreSQLContainer
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets

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

    protected fun send(method: String, path: String, body: Any?, headers: Map<String, String> = emptyMap()): HttpResponse<String> {
        val publisher = body?.let { HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(it)) }
            ?: HttpRequest.BodyPublishers.noBody()
        val requestBuilder = HttpRequest.newBuilder(uri(path))
            .header("Content-Type", "application/json")
        headers.forEach { (name, value) -> requestBuilder.header(name, value) }
        val request = requestBuilder.method(method, publisher).build()
        return client.send(request, HttpResponse.BodyHandlers.ofString())
    }

    /** A line reader plus the connection it came from, so [close] can disconnect. */
    protected class SseStream(val reader: BufferedReader, private val connection: HttpURLConnection) : AutoCloseable {
        override fun close() {
            reader.close()
            connection.disconnect()
        }
    }

    /**
     * Opens an SSE connection. Disconnecting the connection (not just closing the input stream)
     * matters here: otherwise the JDK client keeps the socket in its keep-alive pool and the
     * server's graceful shutdown waits out its full timeout for the "still open" request when
     * the test JVM exits.
     */
    protected fun openStream(path: String): SseStream {
        val connection = uri(path).toURL().openConnection() as HttpURLConnection
        connection.setRequestProperty("Accept", "text/event-stream")
        connection.connectTimeout = 5_000
        connection.readTimeout = 5_000
        return SseStream(BufferedReader(InputStreamReader(connection.inputStream, StandardCharsets.UTF_8)), connection)
    }

    /** Reads one SSE frame's `data:` payload, skipping blank lines and the `event:` line. */
    protected fun nextEventData(reader: BufferedReader): String {
        var line = reader.readLine()
        while (line != null && !line.startsWith("data:")) line = reader.readLine()
        return line?.removePrefix("data:")?.trim() ?: error("stream closed before a data frame arrived")
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
