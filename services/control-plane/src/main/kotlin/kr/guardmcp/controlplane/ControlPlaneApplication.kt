package kr.guardmcp.controlplane

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication
import org.springframework.scheduling.annotation.EnableScheduling

// @EnableScheduling activates ApprovalTimeoutScheduler's 1s sweep tick (§5.1 GMCP-26 fail-closed
// timeout).
@SpringBootApplication
@EnableScheduling
class ControlPlaneApplication

fun main(args: Array<String>) {
    runApplication<ControlPlaneApplication>(*args)
}
