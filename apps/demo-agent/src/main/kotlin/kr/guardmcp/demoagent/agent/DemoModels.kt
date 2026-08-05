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

/**
 * One masked personal-data type and how many spans of it the gateway replaced, e.g.
 * `[RRN_LIKE] x 1`. Counting tags is deliberate: a count and a tag say what happened
 * without echoing the value that was masked (NFR-04).
 */
data class MaskedTypeCount(val tag: String, val count: Int)

/**
 * One consultation-log run. `text` is whatever that mode actually produced — the
 * gateway's masked body in guarded mode, the sandbox's raw body in vulnerable mode.
 * The guarded side never carries an unmasked value: the gateway masks before the demo
 * agent sees anything.
 */
data class ConsultationLookup(
    val mode: String,
    val verdict: String,
    val riskScore: Int,
    val policyIds: List<String>,
    val detections: List<String>,
    val text: String,
    val maskedTypes: List<MaskedTypeCount>,
    val message: String?,
)

/**
 * The before/after pair the Mask Diff view compares (FR-PII-03). "Before" is the
 * vulnerable run's own output, not a copy the gateway kept — the gateway stores only a
 * digest reference (see packages/gateway/src/pipeline/maskDiff.ts), so reproducing the
 * unmasked side requires actually running without the gateway. That is the point the
 * demo makes.
 */
data class ConsultationLogResponse(
    val sessionId: String,
    val task: String,
    val ticketId: String,
    val guarded: ConsultationLookup,
    val vulnerable: ConsultationLookup?,
    val maskedSpanCount: Int,
    val summary: String,
)
