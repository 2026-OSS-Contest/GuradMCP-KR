package kr.guardmcp.controlplane.domain

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import java.math.BigDecimal
import java.time.Instant
import java.util.UUID

private fun draftRecord(
    seq: Long,
    riskScore: BigDecimal = BigDecimal("38"),
    verdict: String = "block",
    matchedPolicyIds: List<String> = listOf("block_env_file_read"),
    detections: List<Map<String, Any?>> = emptyList(),
    ts: Instant = Instant.parse("2026-08-09T10:32:00.120Z"),
    eventId: UUID = UUID.randomUUID(),
    sessionId: String = "s-hash-demo",
) = GuardEventRecord(
    eventId = eventId,
    sessionId = sessionId,
    ts = ts,
    direction = "request",
    toolName = "read_file",
    argsDigest = "sha256:abc123",
    verdict = verdict,
    riskScore = riskScore,
    matchedPolicyIds = matchedPolicyIds,
    detections = detections,
    maskDiffRef = null,
    rawPayload = null,
    seq = seq,
)

class GuardEventHasherKotest : StringSpec({

    "genesis hashes differ across sessions" {
        GuardEventHasher.genesisHash("s-a") shouldNotBe GuardEventHasher.genesisHash("s-b")
    }

    "genesis hash is deterministic for the same session" {
        GuardEventHasher.genesisHash("s-a") shouldBe GuardEventHasher.genesisHash("s-a")
    }

    "the same record and prevHash always hash the same way" {
        val record = draftRecord(seq = 1)
        val prev = GuardEventHasher.genesisHash(record.sessionId)
        GuardEventHasher.computeHash(prev, GuardEventHasher.payload(record)) shouldBe
            GuardEventHasher.computeHash(prev, GuardEventHasher.payload(record))
    }

    "changing riskScore changes the hash" {
        val prev = GuardEventHasher.genesisHash("s-hash-demo")
        val a = GuardEventHasher.computeHash(prev, GuardEventHasher.payload(draftRecord(seq = 1, riskScore = BigDecimal("38"))))
        val b = GuardEventHasher.computeHash(prev, GuardEventHasher.payload(draftRecord(seq = 1, riskScore = BigDecimal("39"))))
        a shouldNotBe b
    }

    "matchedPolicyIds order does not change the hash — it is sorted before hashing" {
        val prev = GuardEventHasher.genesisHash("s-hash-demo")
        val id = UUID.randomUUID()
        val a = GuardEventHasher.payload(draftRecord(seq = 1, eventId = id, matchedPolicyIds = listOf("z", "a")))
        val b = GuardEventHasher.payload(draftRecord(seq = 1, eventId = id, matchedPolicyIds = listOf("a", "z")))
        a shouldBe b
        GuardEventHasher.computeHash(prev, a) shouldBe GuardEventHasher.computeHash(prev, b)
    }

    "a fractional risk score is rounded the same way the Replay timeline rounds it" {
        GuardEventHasher.roundRiskScore(BigDecimal("37.6")) shouldBe 38
        GuardEventHasher.roundRiskScore(BigDecimal("37.4")) shouldBe 37
    }

    "detections outside {type, subtype, confidence} (span, maskedAs) never enter the hash" {
        val prev = GuardEventHasher.genesisHash("s-hash-demo")
        val id = UUID.randomUUID()
        val withMaskInfo = draftRecord(
            seq = 1, eventId = id,
            detections = listOf(mapOf("type" to "PII", "subtype" to "PHONE_KR", "confidence" to 0.9, "span" to mapOf("start" to 0, "end" to 5), "maskedAs" to "010-****-5678")),
        )
        val withoutMaskInfo = draftRecord(
            seq = 1, eventId = id,
            detections = listOf(mapOf("type" to "PII", "subtype" to "PHONE_KR", "confidence" to 0.9)),
        )
        GuardEventHasher.computeHash(prev, GuardEventHasher.payload(withMaskInfo)) shouldBe
            GuardEventHasher.computeHash(prev, GuardEventHasher.payload(withoutMaskInfo))
    }

    "verify walks a real chain and reports valid when nothing changed" {
        val sessionId = "s-hash-demo"
        var prev = GuardEventHasher.genesisHash(sessionId)
        val records = (1..3L).map { seq ->
            val r = draftRecord(seq = seq, sessionId = sessionId)
            val hash = GuardEventHasher.computeHash(prev, GuardEventHasher.payload(r))
            r.copy(prevHash = prev, hash = hash).also { prev = hash }
        }

        val result = GuardEventHasher.verify(sessionId, records)
        result.status shouldBe ChainStatus.VALID
        result.verifiedCount shouldBe 3
        result.totalCount shouldBe 3
        result.mismatchEventIds shouldBe emptyList()
        result.lastVerifiedHash shouldBe records.last().hash
    }

    "verify reports unknown, not broken, when a row predates the chain" {
        val sessionId = "s-hash-demo"
        val legacy = draftRecord(seq = 1, sessionId = sessionId).copy(seq = null, prevHash = null, hash = null)
        GuardEventHasher.verify(sessionId, listOf(legacy)).status shouldBe ChainStatus.UNKNOWN
    }
})
