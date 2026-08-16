package kr.guardmcp.controlplane.domain

import com.fasterxml.jackson.databind.ObjectMapper
import java.math.BigDecimal
import java.math.RoundingMode
import java.security.MessageDigest
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.TreeMap
import java.util.UUID

/**
 * The `guard_event` SHA-256 hash chain (docs/task-docs/GMCP-83/audit-hash-chain-spec.md §3/§4).
 *
 * Distinct from [ReplayChain]: that one hashes the seeded/demo `TimelineNode` shape and is not
 * touched here — running this hasher over seeded fixtures would report them BROKEN, since they
 * were never chained with this payload format. This hasher only ever runs over real
 * [GuardEventRecord] rows, at ingest ([kr.guardmcp.controlplane.domain.GuardEventRepository.insert])
 * and at verification ([verify]) — both funnel every payload through [payload], so the two can
 * never independently drift out of sync with each other.
 */
object GuardEventHasher {
    private val mapper = ObjectMapper()

    // Instant.toString() omits the fractional part entirely when it is exactly zero
    // ("2026-08-09T10:32:00Z" vs "...10:32:00.120Z"), which would make the hash input's shape
    // depend on whether a timestamp happens to land on a whole second. Spec §3.2 requires
    // millisecond precision always, so this formats explicitly rather than using toString().
    private val TS_FORMAT: DateTimeFormatter =
        DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)

    /** §3.1: seeded with the session id so two sessions' first events never share a genesis hash. */
    fun genesisHash(sessionId: String): String = sha256("GENESIS::$sessionId")

    fun computeHash(prevHash: String, canonicalPayload: String): String = sha256(prevHash + canonicalPayload)

    /**
     * §3.2's canonical payload, straight off a [GuardEventRecord]: sorted keys (a [TreeMap]
     * sorts `String` keys alphabetically), no whitespace, UTF-8 — [ObjectMapper] emits compact
     * JSON by default, so no extra configuration is needed for that part.
     *
     * Deliberately takes the same [GuardEventRecord] shape whether the record is about to be
     * inserted (built from the ingest request, `seq` just assigned) or was just read back from
     * Postgres ([verify]): one function, one set of normalization rules (detection field
     * projection, risk-score rounding, timestamp formatting), so insert-time and verify-time
     * payloads can only differ if the stored row actually differs from what was written.
     */
    fun payload(record: GuardEventRecord): String {
        val seq = requireNotNull(record.seq) { "payload() requires seq to be assigned" }
        val sorted = TreeMap<String, Any?>().apply {
            put("argsDigest", record.argsDigest)
            put("detections", record.detections.map(::hashDetection))
            put("direction", record.direction)
            put("eventId", record.eventId.toString())
            put("matchedPolicyIds", record.matchedPolicyIds.sorted())
            put("riskScore", roundRiskScore(record.riskScore))
            put("seq", seq)
            put("sessionId", record.sessionId)
            put("toolName", record.toolName)
            put("ts", TS_FORMAT.format(record.ts))
            put("verdict", record.verdict)
        }
        return mapper.writeValueAsString(sorted)
    }

    /** The Replay timeline node rounds the same way (see `LiveReplaySource.toVerdictNode`); the
     *  hash payload must round identically or a fractional risk score with no other change
     *  would still flip the hash for a reason nobody tampered with. */
    fun roundRiskScore(riskScore: BigDecimal): Int = riskScore.setScale(0, RoundingMode.HALF_UP).toInt()

    /** §3.2: only `{type, subtype, confidence}` enters the hash — never `span`/`maskedAs`, so a
     *  reveal or a masking-format change never breaks the chain (§3.2's closing paragraph). */
    private fun hashDetection(raw: Map<String, Any?>): Map<String, Any?> = TreeMap<String, Any?>().apply {
        put("confidence", (raw["confidence"] as? Number)?.toDouble() ?: 0.0)
        put("subtype", raw["subtype"] as? String ?: "")
        put("type", raw["type"] as? String ?: "")
    }

    /**
     * §4.1's verification algorithm. [records] must already be ordered by `seq` ascending
     * ([GuardEventRepository.findBySessionIdOrderBySeq]).
     *
     * Reports [ChainStatus.UNKNOWN] — not BROKEN — when any record has no stored `seq`/hash:
     * verification needs a hash that was written when the event was recorded, and a session
     * containing rows from before this chain existed has nothing to check those rows against
     * (see [ChainStatus.UNKNOWN]'s doc comment). Reporting BROKEN there would be a false
     * tamper alarm, not a detected one.
     */
    fun verify(sessionId: String, records: List<GuardEventRecord>): ChainResult {
        val now = Instant.now()
        if (records.isEmpty()) {
            return ChainResult(ChainStatus.UNKNOWN, null, 0, 0, emptyList(), null, now)
        }
        if (records.any { it.seq == null || it.prevHash == null || it.hash == null }) {
            return ChainResult(ChainStatus.UNKNOWN, null, 0, records.size, emptyList(), null, now)
        }

        var expectedPrev = genesisHash(sessionId)
        val mismatches = mutableListOf<UUID>()
        var lastGoodHash: String? = null
        for (record in records) {
            val recomputed = computeHash(expectedPrev, payload(record))
            val ok = record.prevHash == expectedPrev && record.hash == recomputed
            if (ok) lastGoodHash = record.hash else mismatches += record.eventId
            // Advances on the *stored* hash, not the recomputed one: this is what keeps a
            // tamper localized to the row(s) actually changed instead of cascading every
            // later "still self-consistent with what's stored" row into a false mismatch too
            // (spec §4.1's "구간 단위 하이라이트" rationale).
            expectedPrev = record.hash!!
        }
        val status = if (mismatches.isEmpty()) ChainStatus.VALID else ChainStatus.BROKEN
        return ChainResult(status, mismatches.firstOrNull(), records.size - mismatches.size, records.size, mismatches, lastGoodHash, now)
    }

    private fun sha256(input: String): String =
        MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
}
