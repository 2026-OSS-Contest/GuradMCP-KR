package kr.guardmcp.controlplane.domain

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import java.math.BigDecimal
import java.time.Instant
import java.util.UUID

/**
 * Projection behaviour, exercised without a database: the projection depends on the
 * narrow [AuditEventQueries] interface, so these stay fast and independent of Postgres. The wiring itself — ingest through
 * `POST /events`, read back through `GET /sessions` — is covered by
 * [kr.guardmcp.controlplane.api.ReplayLiveEventsApiTest], which needs the real table.
 */
private class FakeRepository(private val records: List<GuardEventRecord>) : AuditEventQueries {
    override fun findSessionIds(): List<String> =
        records.sortedByDescending { it.ts }.map { it.sessionId }.distinct()

    override fun findBySessionId(sessionId: String): List<GuardEventRecord> =
        records.filter { it.sessionId == sessionId }.sortedWith(compareBy({ it.ts }, { it.eventId.toString() }))

    override fun findBySessionIdOrderBySeq(sessionId: String): List<GuardEventRecord> =
        records.filter { it.sessionId == sessionId }
            .sortedWith(compareBy({ it.seq ?: Long.MAX_VALUE }, { it.ts }, { it.eventId.toString() }))

    override fun findById(eventId: UUID): GuardEventRecord? = records.firstOrNull { it.eventId == eventId }
}

private val baseTs: Instant = Instant.parse("2026-08-11T00:00:00Z")

private fun record(
    sessionId: String = "s-demo",
    eventId: UUID = UUID.randomUUID(),
    offsetMillis: Long = 0,
    verdict: String = "block",
    toolName: String = "read_file",
    direction: String = "request",
    riskScore: String = "38",
    policyIds: List<String> = listOf("block_env_file_read"),
    detections: List<Map<String, Any?>> = emptyList(),
    seq: Long? = null,
    prevHash: String? = null,
    hash: String? = null,
    rawPayloadRef: UUID? = null,
) = GuardEventRecord(
    eventId = eventId,
    sessionId = sessionId,
    ts = baseTs.plusMillis(offsetMillis),
    direction = direction,
    toolName = toolName,
    argsDigest = "324de04ab4c80caf",
    verdict = verdict,
    riskScore = BigDecimal(riskScore),
    matchedPolicyIds = policyIds,
    detections = detections,
    maskDiffRef = null,
    rawPayloadRef = rawPayloadRef,
    seq = seq,
    prevHash = prevHash,
    hash = hash,
)

/** Chains [drafts] with real hashes, the way `GuardEventRepository.insert` would (GMCP-83). */
private fun chain(sessionId: String, vararg drafts: GuardEventRecord): List<GuardEventRecord> {
    var prevHash = GuardEventHasher.genesisHash(sessionId)
    return drafts.mapIndexed { index, draft ->
        val withSeq = draft.copy(seq = (index + 1).toLong())
        val hash = GuardEventHasher.computeHash(prevHash, GuardEventHasher.payload(withSeq))
        withSeq.copy(prevHash = prevHash, hash = hash).also { prevHash = hash }
    }
}

class LiveReplaySourceKotest : StringSpec({

    "a blocked event becomes a verdict node carrying its policy id and risk score" {
        val eventId = UUID.randomUUID()
        val source = LiveReplaySource(FakeRepository(listOf(record(eventId = eventId))))
        val sessionId = LiveReplaySource.sessionUuid("s-demo")

        val nodes = source.timeline(sessionId).shouldNotBeNull()
        nodes.size shouldBe 1
        nodes[0].eventId shouldBe eventId
        nodes[0].type shouldBe TimelineNodeType.VERDICT
        nodes[0].verdict shouldBe Verdict.BLOCK
        nodes[0].riskScore shouldBe 38
        nodes[0].detail.shouldNotBeNull().matchedPolicyIds shouldContainExactly listOf("block_env_file_read")
        // The node carries the call it judged rather than a separate fabricated TOOL_CALL node.
        nodes[0].toolName shouldBe "read_file"
        nodes[0].argsDigest shouldBe "324de04ab4c80caf"
    }

    "a projected chain is reported as unknown, never as verified" {
        val source = LiveReplaySource(
            FakeRepository(
                listOf(
                    record(eventId = UUID.randomUUID(), offsetMillis = 0, verdict = "warn"),
                    record(eventId = UUID.randomUUID(), offsetMillis = 10, verdict = "block"),
                ),
            ),
        )
        val sessionId = LiveReplaySource.sessionUuid("s-demo")
        // Nothing stored a hash for these records, so there is nothing to verify against.
        // Recomputing the hashes this projection just derived would compare them to
        // themselves and answer VALID for any content at all.
        source.chainResult(sessionId).shouldNotBeNull().status shouldBe ChainStatus.UNKNOWN
        source.eventCount(sessionId) shouldBe 2
    }

    "mask_then_allow shows as warn, because Replay has no fifth badge" {
        val source = LiveReplaySource(FakeRepository(listOf(record(verdict = "mask_then_allow"))))
        val nodes = source.timeline(LiveReplaySource.sessionUuid("s-demo")).shouldNotBeNull()
        nodes[0].verdict shouldBe Verdict.WARN
    }

    "a response-direction event is marked res" {
        val source = LiveReplaySource(FakeRepository(listOf(record(direction = "response"))))
        val nodes = source.timeline(LiveReplaySource.sessionUuid("s-demo")).shouldNotBeNull()
        nodes[0].direction shouldBe ToolCallDirection.RES
    }

    "detections survive the jsonb round trip, and a malformed one is dropped" {
        val source = LiveReplaySource(
            FakeRepository(
                listOf(
                    record(
                        detections = listOf(
                            mapOf(
                                "type" to "SECRET", "subtype" to "GITHUB_TOKEN",
                                "span" to mapOf("start" to 4, "end" to 44),
                                "confidence" to 0.95, "maskedAs" to "[GITHUB_TOKEN]",
                            ),
                            // No subtype: dropped rather than 500ing the whole timeline.
                            mapOf("type" to "SECRET"),
                        ),
                    ),
                ),
            ),
        )
        val detections = source.timeline(LiveReplaySource.sessionUuid("s-demo"))
            .shouldNotBeNull()[0].detail.shouldNotBeNull().detections
        detections.size shouldBe 1
        detections[0].subtype shouldBe "GITHUB_TOKEN"
        detections[0].span shouldBe Span(4, 44)
        detections[0].maskedAs shouldBe "[GITHUB_TOKEN]"
    }

    "a maskedAs that is not a mask tag is dropped rather than rendered" {
        // NFR-04. The ingest endpoint stores `detections` as raw jsonb, so the only thing
        // standing between a misconfigured emitter and raw text on the audit screen is this.
        val source = LiveReplaySource(
            FakeRepository(
                listOf(
                    record(
                        detections = listOf(
                            mapOf(
                                "type" to "PII", "subtype" to "RRN_LIKE",
                                "span" to mapOf("start" to 0, "end" to 14),
                                "confidence" to 0.9, "maskedAs" to "881124-2300149",
                            ),
                            mapOf(
                                "type" to "PII", "subtype" to "PHONE",
                                "span" to mapOf("start" to 20, "end" to 33),
                                "confidence" to 0.9, "maskedAs" to "[PHONE]",
                            ),
                        ),
                    ),
                ),
            ),
        )
        val detections = source.timeline(LiveReplaySource.sessionUuid("s-demo"))
            .shouldNotBeNull()[0].detail.shouldNotBeNull().detections
        detections.map { it.maskedAs } shouldContainExactly listOf("", "[PHONE]")
    }

    "an unrecognized stored verdict fails loudly instead of reading as allow" {
        val source = LiveReplaySource(FakeRepository(listOf(record(verdict = "quarantine"))))
        shouldThrow<IllegalStateException> { source.timeline(LiveReplaySource.sessionUuid("s-demo")) }
    }

    "the session id is derived deterministically from the gateway's opaque id" {
        LiveReplaySource.sessionUuid("s-demo") shouldBe LiveReplaySource.sessionUuid("s-demo")
        (LiveReplaySource.sessionUuid("s-demo") == LiveReplaySource.sessionUuid("s-other")) shouldBe false
    }

    "an audit trail is never reported as live" {
        val source = LiveReplaySource(FakeRepository(listOf(record())))
        source.sessions(q = null, isLive = true).shouldBeEmpty()
        source.sessions(q = null, isLive = false).size shouldBe 1
        source.sessions(q = null, isLive = null).size shouldBe 1
        source.session(LiveReplaySource.sessionUuid("s-demo")).shouldNotBeNull().isLive shouldBe false
    }

    "sessions can be searched by their gateway id or by a tool name" {
        val source = LiveReplaySource(FakeRepository(listOf(record(sessionId = "attacklab-1a2b", toolName = "send_email"))))
        source.sessions(q = "attacklab", isLive = null).size shouldBe 1
        source.sessions(q = "send_email", isLive = null).size shouldBe 1
        source.sessions(q = "nothing-matches", isLive = null).shouldBeEmpty()
    }

    "an event resolves to the session that recorded it" {
        val eventId = UUID.randomUUID()
        val source = LiveReplaySource(FakeRepository(listOf(record(sessionId = "s-x", eventId = eventId))))
        val (sessionId, node) = source.node(eventId).shouldNotBeNull()
        sessionId shouldBe LiveReplaySource.sessionUuid("s-x")
        node.eventId shouldBe eventId
    }

    "an unknown session or event is absent rather than empty" {
        val source = LiveReplaySource(FakeRepository(emptyList()))
        source.session(UUID.randomUUID()).shouldBeNull()
        source.timeline(UUID.randomUUID()).shouldBeNull()
        source.chainResult(UUID.randomUUID()).shouldBeNull()
        source.node(UUID.randomUUID()).shouldBeNull()
    }

    "a fractional risk score rounds rather than truncating" {
        val source = LiveReplaySource(FakeRepository(listOf(record(riskScore = "37.6"))))
        source.timeline(LiveReplaySource.sessionUuid("s-demo")).shouldNotBeNull()[0].riskScore shouldBe 38
    }

    "a session whose rows carry a real, untampered hash chain verifies as valid" {
        val records = chain(
            "s-demo",
            record(eventId = UUID.randomUUID(), offsetMillis = 0, verdict = "warn"),
            record(eventId = UUID.randomUUID(), offsetMillis = 10, verdict = "block"),
        )
        val source = LiveReplaySource(FakeRepository(records))
        val result = source.chainResult(LiveReplaySource.sessionUuid("s-demo")).shouldNotBeNull()

        result.status shouldBe ChainStatus.VALID
        result.brokenAt.shouldBeNull()
        result.verifiedCount shouldBe 2
        result.totalCount shouldBe 2
        result.mismatchEventIds.shouldBeEmpty()
        result.lastVerifiedHash shouldBe records.last().hash
    }

    "a row whose stored hash no longer matches its payload is reported broken, localized to that row" {
        val eventA = UUID.randomUUID()
        val eventB = UUID.randomUUID()
        val chained = chain(
            "s-demo",
            record(eventId = eventA, offsetMillis = 0, verdict = "warn"),
            record(eventId = eventB, offsetMillis = 10, verdict = "block"),
        )
        // Simulate a direct DB tamper: risk score changed after the hash was computed and
        // stored, so the row's own hash and its successor's prevHash are both now stale.
        val tampered = chained.map { if (it.eventId == eventA) it.copy(riskScore = BigDecimal("10")) else it }
        val source = LiveReplaySource(FakeRepository(tampered))
        val result = source.chainResult(LiveReplaySource.sessionUuid("s-demo")).shouldNotBeNull()

        result.status shouldBe ChainStatus.BROKEN
        result.brokenAt shouldBe eventA
        result.mismatchEventIds shouldContainExactly listOf(eventA)
        result.verifiedCount shouldBe 1
        result.totalCount shouldBe 2
    }
})
