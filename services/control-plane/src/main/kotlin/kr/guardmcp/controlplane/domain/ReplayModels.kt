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

    /**
     * No stored hash to check against, so tamper-evidence cannot be claimed either way.
     *
     * This is not a degraded VALID. A verification needs a hash that was written when the
     * event was recorded; `guard_event.hash`/`prev_hash` are schema-only until GMCP-83
     * fills them in. Recomputing a hash at read time and comparing it to a hash derived
     * from the same in-memory node proves only that the function is deterministic — it
     * would report VALID over a tampered row just as readily.
     */
    UNKNOWN("unknown"),
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
    /** GMCP-84 §8.3: whether this event has a stored, revealable raw payload. Only ever true for
     *  a VERDICT node backed by a real ingested [GuardEventRecord] with a non-null
     *  `rawPayloadRef`; seeded/demo nodes have no raw payload to reveal, so this defaults false. */
    val hasRawPayload: Boolean = false,
)

data class ReplaySession(
    val id: UUID,
    val agentLabel: String,
    val startedAt: Instant,
    val endedAt: Instant?,
    val isLive: Boolean,
)

/**
 * The result of walking one session's hash chain (GMCP-83 §4). [brokenAt] is kept — it is
 * `mismatchEventIds.firstOrNull()` — because it is already the console's GMCP-28 wire contract
 * (`apps/console/lib/api/types.ts`'s `ApiSessionTimelineResponse.brokenAt`); the richer fields
 * are additive, for the dedicated `GET /sessions/{id}/chain-verify` endpoint.
 *
 * `status` keeps this codebase's existing three-valued [ChainStatus] (`valid`/`broken`/`unknown`)
 * rather than the audit-hash-chain-spec's `VALID`/`INVALID`/`EMPTY`: that vocabulary already
 * ships in the console and is asserted in tests, and `unknown` — no stored hash to check yet —
 * has no equivalent in the spec's two-valued failure case. `EMPTY` is not reachable through this
 * type: an empty session has no [kr.guardmcp.controlplane.domain.ReplaySession] to attach a
 * result to in the first place (`LiveReplaySource.load` returns `null`, and the controller 404s).
 */
data class ChainResult(
    val status: ChainStatus,
    val brokenAt: UUID?,
    val verifiedCount: Int,
    val totalCount: Int,
    val mismatchEventIds: List<UUID>,
    val lastVerifiedHash: String?,
    val verifiedAt: Instant,
)
