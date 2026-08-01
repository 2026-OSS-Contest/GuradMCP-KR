package kr.guardmcp.demoagent

import kr.guardmcp.demoagent.config.DemoAgentProperties
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.boot.runApplication

@SpringBootApplication
@EnableConfigurationProperties(DemoAgentProperties::class)
class DemoAgentApplication

fun main(args: Array<String>) {
    runApplication<DemoAgentApplication>(*args)
}
