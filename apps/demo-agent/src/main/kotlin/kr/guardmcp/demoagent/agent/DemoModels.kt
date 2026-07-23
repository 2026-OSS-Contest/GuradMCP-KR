package kr.guardmcp.demoagent.agent

/** One row of the tool-call chain, shaped for the SCR-201 stream and Replay timeline. */
data class ToolCallStep(
    val step: Int,
    val tool: String,
    val target: String?,
    val verdict: String,
    val blocked: Boolean,
    val riskScore: Int,
    val policyIds: List<String>,
    val detections: List<String>,
    val message: String?,
)

/** What the whole run amounted to: did the gateway stop it, and did anything leak. */
data class DemoOutcome(
    val blocked: Boolean,
    val leaked: Boolean,
    val stoppedAtStep: Int?,
    val summary: String,
)

data class DemoRunResponse(
    val sessionId: String,
    val mode: String,
    val task: String,
    val readme: String,
    val chain: List<ToolCallStep>,
    val outcome: DemoOutcome,
)
