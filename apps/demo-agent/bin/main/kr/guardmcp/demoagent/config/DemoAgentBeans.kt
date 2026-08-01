package kr.guardmcp.demoagent.config

import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import tools.jackson.databind.ObjectMapper
import tools.jackson.module.kotlin.jacksonObjectMapper
import java.net.http.HttpClient
import java.time.Duration

@Configuration
class DemoAgentBeans {
    /** Spring Boot 4 defaults to Jackson 3; a Kotlin-aware mapper serves both MVC and our components. */
    @Bean
    fun objectMapper(): ObjectMapper = jacksonObjectMapper()

    @Bean
    fun httpClient(): HttpClient =
        HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build()
}
