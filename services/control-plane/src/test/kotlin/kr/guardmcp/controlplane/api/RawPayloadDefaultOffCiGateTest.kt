package kr.guardmcp.controlplane.api

import kr.guardmcp.controlplane.domain.GuardEventRepository
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import java.time.Instant
import java.util.UUID

/**
 * GMCP-84 §10.1 (Definition of Done's own CI gate): with `rawPayloadStorageEnabled` at its
 * default (`false`), ingesting a GuardEvent whose payload carries real-looking PII/secret text
 * must leave **no** raw copy of that text anywhere in the database — not in a dedicated
 * `raw_payload` row, and not smuggled into `guard_event`'s own columns. §10.1 calls for this to
 * be "CI 필수 게이트로 등록" — this class is that gate: a normal `./gradlew test` run already
 * exercises it on every PR, the same way the Benchmark Runner gates policy-pack changes.
 *
 * The regex set below (부록 B) mirrors the shapes this codebase's own detectors recognize
 * (`packages/gateway/src/detect.ts`'s Korean RRN/phone validators, and the `sk-`/`AKIA`/`ghp_`
 * secret prefixes named directly in the spec) without needing that TypeScript checksum logic
 * here — a plain shape match is stricter than necessary for "did the raw string leak," which is
 * exactly what this test needs to prove didn't happen.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class RawPayloadDefaultOffCiGateTest : ApiTestSupport() {
    @Autowired
    private lateinit var repository: GuardEventRepository

    @Autowired
    private lateinit var jdbcTemplate: JdbcTemplate

    @Test
    fun `fixture sanity - every pattern this gate checks for actually matches the raw text`() {
        // Pins the fixture to the pattern set: if a future edit trims rawText down to where a
        // pattern no longer matches it, this fails loudly instead of the gate below silently
        // stopping being a gate for that pattern.
        RAW_TEXT_PATTERNS.forEach { (name, pattern) ->
            assertTrue(pattern.containsMatchIn(RAW_TEXT), "fixture sanity: $name pattern must match the raw text used in this test")
        }
    }

    @Test
    fun `default settings leave no raw PII or secret text anywhere in the database`() {
        val eventId = UUID.randomUUID()

        val response = send(
            "POST", "/api/v1/events",
            mapOf(
                "eventId" to eventId.toString(),
                "sessionId" to UUID.randomUUID().toString(),
                "ts" to Instant.now().toString(),
                "direction" to "response",
                "toolName" to "lookup_customer",
                "argsDigest" to "sha256:" + "0".repeat(64),
                "verdict" to "mask_then_allow",
                "riskScore" to 91,
                "matchedPolicyIds" to listOf("mask_korean_pii"),
                "detections" to listOf(
                    mapOf(
                        "type" to "PII",
                        "subtype" to "RRN_LIKE",
                        "span" to mapOf("start" to 0, "end" to 13),
                        "confidence" to 0.98,
                        "maskedAs" to "[RRN_LIKE]",
                    ),
                ),
                "maskDiffRef" to null,
                // Same double-gate every real emitter goes through (AuditEventController.ingest):
                // this is only ever persisted if rawPayloadStorageEnabled is true, which it is not here.
                "rawPayload" to RAW_TEXT,
            ),
        )
        assertEquals(201, response.statusCode())

        // 1. guard_event.raw_payload_ref must be null.
        val stored = repository.findById(eventId)
        assertNull(stored?.rawPayloadRef, "raw_payload_ref must stay null under default settings")

        // 2. raw_payload must have zero rows for this event.
        val rawPayloadRowCount = jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM raw_payload WHERE event_id = ?",
            Int::class.java,
            eventId,
        )
        assertEquals(0, rawPayloadRowCount, "raw_payload must have no row for an event stored under default settings")

        // 3. Every text-bearing guard_event column for this row, scanned with the PII/secret
        //    pattern set, must match zero times -- only mask tags like [RRN_LIKE] may appear.
        val row = jdbcTemplate.queryForMap(
            "SELECT args_digest, detections::text AS detections_text FROM guard_event WHERE event_id = ?",
            eventId,
        )
        val scannedText = "${row["args_digest"]}\n${row["detections_text"]}"
        RAW_TEXT_PATTERNS.forEach { (name, pattern) ->
            assertTrue(
                pattern.find(scannedText) == null,
                "found a $name-shaped match in guard_event's own columns: $scannedText",
            )
        }

        // 4. Whole-table scan of raw_payload's ciphertext column, decoded as text. A row this test
        //    (or any earlier test in the shared container -- see ApiTestSupport) stored must decode
        //    to AES-GCM noise, never to a pattern match: if encryption were ever silently skipped
        //    and plaintext landed in payload_encrypted instead, this is what would catch it, for any
        //    event, not just this test's own. §10.2's "평문이 아닌 것" check.
        val cipherRows = jdbcTemplate.queryForList("SELECT payload_encrypted FROM raw_payload", ByteArray::class.java)
        cipherRows.filterNotNull().forEach { bytes ->
            val decoded = String(bytes, Charsets.UTF_8)
            RAW_TEXT_PATTERNS.forEach { (name, pattern) ->
                assertTrue(
                    pattern.find(decoded) == null,
                    "found a $name-shaped match decoded from raw_payload.payload_encrypted -- encryption may have been bypassed",
                )
            }
        }
    }

    companion object {
        private const val RAW_TEXT = """
            고객 주민등록번호는 901231-2345671 이고 연락처는 010-9876-5432 입니다.
            발급된 임시 API 키: sk-live-AbCdEfGhIjKlMnOpQrStUvWxYz012345, AWS 액세스 키 AKIAABCDEFGHIJKLMNOP,
            GitHub 토큰 ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789.
        """

        /** 부록 B: representative raw-text shapes, not the full checksum-validated detectors
         *  (`packages/gateway/src/detect.ts`) -- a looser shape match is the stricter leak check. */
        private val RAW_TEXT_PATTERNS: List<Pair<String, Regex>> = listOf(
            "Korean RRN" to Regex("""\d{6}-\d{7}"""),
            "Korean phone" to Regex("""01[0-9]-\d{3,4}-\d{4}"""),
            "sk- secret prefix" to Regex("""sk-[A-Za-z0-9_-]{10,}"""),
            "AWS access key" to Regex("""AKIA[A-Z0-9]{16}"""),
            "GitHub token" to Regex("""ghp_[A-Za-z0-9]{20,}"""),
        )
    }
}
