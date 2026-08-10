package kr.guardmcp.demoagent.api

import kr.guardmcp.demoagent.agent.ConsultationLogResponse
import kr.guardmcp.demoagent.agent.DemoAgentService
import kr.guardmcp.demoagent.agent.DemoRunResponse
import kr.guardmcp.demoagent.mcp.DemoMode
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import tools.jackson.databind.JsonNode
import tools.jackson.databind.node.JsonNodeFactory

/** Comparison of both demo modes for the SCR-201 before/after split. */
data class DemoComparison(val guarded: DemoRunResponse, val vulnerable: DemoRunResponse)

@RestController
class DemoController(private val demoAgentService: DemoAgentService) {

    /**
     * Original PII scenario: proxy `customer_lookup` through the gateway and return the
     * merged verdict. Returns 503 only when the gateway itself is unreachable.
     */
    @PostMapping("/demo/pii")
    fun pii(): ResponseEntity<JsonNode> = runCatching {
        ResponseEntity.ok(demoAgentService.runPiiLookup())
    }.getOrElse {
        ResponseEntity.status(503).body(errorNode("GATEWAY_UNAVAILABLE"))
    }

    /**
     * T-02/T-08 consultation-log run (GMCP-20): looks up the seeded ticket through the
     * gateway so the response-direction masking is visible end to end.
     *
     * `?compare=false` runs only the guarded path. The default also runs the unguarded
     * path, which is what supplies the "before" side of the Mask Diff comparison — the
     * gateway itself keeps only a digest of the pre-mask text (NFR-04), so the unmasked
     * body exists nowhere else.
     */
    @PostMapping("/demo/consultation-log")
    fun consultationLog(@RequestParam(defaultValue = "true") compare: Boolean): ResponseEntity<ConsultationLogResponse> =
        ResponseEntity.ok(demoAgentService.runConsultationLog(withVulnerable = compare))

    /** T-01 malicious-README run. `?mode=guarded` (default) or `?mode=vulnerable`. */
    @PostMapping("/demo/readme-summary")
    fun readmeSummary(@RequestParam(defaultValue = "guarded") mode: String): ResponseEntity<DemoRunResponse> {
        val parsed = parseMode(mode) ?: return ResponseEntity.badRequest().build()
        return ResponseEntity.ok(demoAgentService.runReadmeSummary(parsed))
    }

    /** Runs both modes so the console can show the vulnerable/guarded contrast side by side. */
    @PostMapping("/demo/readme-summary/compare")
    fun readmeSummaryCompare(): ResponseEntity<DemoComparison> = ResponseEntity.ok(
        DemoComparison(
            guarded = demoAgentService.runReadmeSummary(DemoMode.GUARDED),
            vulnerable = demoAgentService.runReadmeSummary(DemoMode.VULNERABLE),
        ),
    )

    private fun parseMode(mode: String): DemoMode? =
        when (mode.lowercase()) {
            "guarded" -> DemoMode.GUARDED
            "vulnerable" -> DemoMode.VULNERABLE
            else -> null
        }

    private fun errorNode(code: String): JsonNode =
        JsonNodeFactory.instance.objectNode().put("code", code)
}
