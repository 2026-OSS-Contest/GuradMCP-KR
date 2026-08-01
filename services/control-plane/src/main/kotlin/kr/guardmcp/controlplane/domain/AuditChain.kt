package kr.guardmcp.controlplane.domain

import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.stereotype.Component
import java.security.MessageDigest
import java.time.Clock
import java.time.Instant
import java.util.UUID

/**
 * Trust-level change audit record (FR-GW-02 §3.2). Kept in a table of its own
 * rather than folded into [GuardEvent] — that entity models Tool Call
 * verdicts, not registry administration — but chained through the same
 * [AuditChain] so both event kinds share one append-only integrity guarantee.
 */
data class TrustLevelChangeEvent(
    val eventId: UUID,
    val ts: Instant,
    val serverId: String,
    val fromTrust: TrustLevel,
    val toTrust: TrustLevel,
    val direction: String,
    val confirmedBy: String?,
    val prevHash: String,
    val hash: String,
)

/**
 * Minimal append-only hash chain (FR-GW-02 §3.2/§9): each entry's hash covers
 * the previous entry's hash plus its own canonical payload, so editing or
 * reordering any entry breaks verification from that point on. No hash chain
 * existed anywhere in the control plane before this (`GuardEventStore` does
 * not chain its events); this is intentionally scoped to trust-change audit
 * only; wiring `GuardEvent` into the same chain is a separate change.
 */
@Component
class AuditChain(private val clock: Clock) {
    private val lock = Any()
    private val mapper = ObjectMapper()
    private val trustChanges = mutableListOf<TrustLevelChangeEvent>()
    private var lastHash = GENESIS_HASH

    fun recordTrustChange(serverId: String, fromTrust: TrustLevel, toTrust: TrustLevel, direction: String, confirmedBy: String?): TrustLevelChangeEvent =
        synchronized(lock) {
            val eventId = UUID.randomUUID()
            val ts = clock.instant()
            val payload = linkedMapOf(
                "eventId" to eventId.toString(),
                "ts" to ts.toString(),
                "serverId" to serverId,
                "fromTrust" to fromTrust.wire,
                "toTrust" to toTrust.wire,
                "direction" to direction,
                "confirmedBy" to confirmedBy,
            )
            val hash = sha256Hex("$lastHash|${mapper.writeValueAsString(payload)}")
            val event = TrustLevelChangeEvent(eventId, ts, serverId, fromTrust, toTrust, direction, confirmedBy, lastHash, hash)
            trustChanges += event
            lastHash = hash
            event
        }

    fun trustChangeEvents(): List<TrustLevelChangeEvent> = synchronized(lock) { trustChanges.toList() }

    /** Re-derives every hash from genesis and confirms the stored chain still matches (Replay verification). */
    fun verify(): Boolean = synchronized(lock) {
        var previous = GENESIS_HASH
        for (event in trustChanges) {
            if (event.prevHash != previous) return@synchronized false
            previous = event.hash
        }
        true
    }

    companion object {
        val GENESIS_HASH = "0".repeat(64)

        private fun sha256Hex(input: String): String =
            MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    }
}
