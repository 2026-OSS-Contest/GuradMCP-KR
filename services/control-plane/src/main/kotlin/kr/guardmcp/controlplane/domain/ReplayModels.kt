package kr.guardmcp.controlplane.domain

import com.fasterxml.jackson.annotation.JsonInclude
import com.fasterxml.jackson.annotation.JsonValue
import java.time.Instant
import java.util.UUID

/**
 * Console display vocabulary for Replay verdict nodes (PROJECT.md 8.4/5.3, SCREEN-SPACE.md 4.3;
 * apps/console/lib/api/types.ts `Verdict`). Deliberately distinct from [GuardAction]: that enum
 * is the policy engine's internal action vocabulary (mask_then_allow instead of warn) and backs
 * the /policies and /detect/preview endpoints, which this feature does not touch.
 */
enum class Verdict(@get:JsonValue val wire: String) {
    ALLOW("allow"),
    WARN("warn"),
    REQUIRE_APPROVAL("require_approval"),
    BLOCK("block");

    companion object {
        fun fromWire(value: String): Verdict? = entries.firstOrNull { it.wire == value }
    }
}

/** Replay Timeline Rail node kinds (GMCP-28 spec 3.2). Exactly 5, fixed. */
enum class TimelineNodeType(@get:JsonValue val wire: String) {
    USER_INPUT("USER_INPUT"),
    AGENT_STEP("AGENT_STEP"),
    TOOL_CALL("TOOL_CALL"),
    VERDICT("VERDICT"),
    RESULT("RESULT"),
}

enum class ToolCallDirection(@get:JsonValue val wire: String) {
    REQ("req"),
    RES("res"),
}

enum class ChainStatus(@get:JsonValue val wire: String) {
    VALID("valid"),
    BROKEN("broken"),
}

data class Span(val start: Int, val end: Int)

/** A single PII/SECRET/INJ finding. `maskedAs` only ever carries the masked form, never raw text. */
data class Detection(
    val type: String,
    val subtype: String,
    val span: Span,
    val confidence: Double,
    val maskedAs: String,
)

/** Verdict judgement evidence. Only attached to VERDICT nodes. */
data class VerdictDetail(
    val matchedPolicyIds: List<String>,
    val detections: List<Detection>,
    val maskDiffRef: String,
    val hash: String,
    val prevHash: String,
)

/** One node on the Replay Timeline Rail. Only VERDICT nodes carry [detail] and [verdict]/[riskScore]. */
data class TimelineNode(
    val eventId: UUID,
    val type: TimelineNodeType,
    val ts: Instant,
    val summary: String,
    @get:JsonInclude(JsonInclude.Include.NON_NULL) val toolName: String? = null,
    @get:JsonInclude(JsonInclude.Include.NON_NULL) val direction: ToolCallDirection? = null,
    @get:JsonInclude(JsonInclude.Include.NON_NULL) val argsDigest: String? = null,
    @get:JsonInclude(JsonInclude.Include.NON_NULL) val verdict: Verdict? = null,
    @get:JsonInclude(JsonInclude.Include.NON_NULL) val riskScore: Int? = null,
    val detail: VerdictDetail? = null,
)

data class ReplaySession(
    val id: UUID,
    val agentLabel: String,
    val startedAt: Instant,
    val endedAt: Instant?,
    val isLive: Boolean,
)

data class ChainResult(val status: ChainStatus, val brokenAt: UUID?)
