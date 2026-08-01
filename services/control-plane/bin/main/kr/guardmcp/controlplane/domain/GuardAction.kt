package kr.guardmcp.controlplane.domain

import com.fasterxml.jackson.annotation.JsonValue

/**
 * Shared verdict/action vocabulary. The gateway reports its inspection verdict with the
 * same values a policy declares as its action, so both sides reuse this enum.
 */
enum class GuardAction(@get:JsonValue val wire: String) {
    ALLOW("allow"),
    WARN("warn"),
    MASK_THEN_ALLOW("mask_then_allow"),
    REQUIRE_APPROVAL("require_approval"),
    BLOCK("block");

    companion object {
        fun fromWire(value: String): GuardAction? = entries.firstOrNull { it.wire == value }
    }
}

enum class Severity(@get:JsonValue val wire: String) {
    LOW("low"),
    MEDIUM("medium"),
    HIGH("high"),
    CRITICAL("critical");

    companion object {
        fun fromWire(value: String): Severity? = entries.firstOrNull { it.wire == value }
    }
}
