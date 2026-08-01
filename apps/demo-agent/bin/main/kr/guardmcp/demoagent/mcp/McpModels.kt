package kr.guardmcp.demoagent.mcp

/** Which side of the SCR-201 before/after split a run represents. */
enum class DemoMode { GUARDED, VULNERABLE }

/**
 * Normalized outcome of a single tool call, whether it went through the guarded
 * gateway (real policy verdict) or the vulnerable sandbox (deterministic replay).
 * Never carries raw secret text pulled from a gateway response — the gateway masks
 * before we ever see it, and the sandbox payload is synthetic.
 */
data class McpCallResult(
    val tool: String,
    val mode: DemoMode,
    val source: String,
    val verdict: String,
    val blocked: Boolean,
    val riskScore: Int,
    val policyIds: List<String>,
    val detections: List<String>,
    val resultJson: String?,
    val message: String?,
    val rpcCode: Int?,
)
