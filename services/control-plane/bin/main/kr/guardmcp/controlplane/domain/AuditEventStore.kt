package kr.guardmcp.controlplane.domain

import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.databind.ObjectMapper
import org.postgresql.util.PGobject
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.RowMapper
import org.springframework.stereotype.Component
import java.math.BigDecimal
import java.sql.PreparedStatement
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

/**
 * Wire/storage shape for pipeline stage ⑧ (docs/task-docs/GMCP-24/audit-logging-implementation.md
 * §4). Distinct from the demo-only [GuardEvent]/[GuardEventStore] pair used by
 * [kr.guardmcp.controlplane.api.SessionTimelineController] and [kr.guardmcp.controlplane.api.OverviewController] —
 * those stay in-memory and out of scope here; this is the real `guard_event` Postgres table
 * the gateway's Event Emitter publishes into.
 */
data class GuardEventRecord(
    val eventId: UUID,
    val sessionId: String,
    val ts: Instant,
    val direction: String,
    val toolName: String,
    val argsDigest: String,
    val verdict: String,
    val riskScore: BigDecimal,
    val matchedPolicyIds: List<String>,
    val detections: List<Map<String, Any?>>,
    val maskDiffRef: String?,
    /** NFR-04 opt-in only; null unless `audit.store-raw-payload=true` on this service. */
    val rawPayload: String?,
)

@Component
class GuardEventRepository(private val jdbcTemplate: JdbcTemplate) {
    // Spring Boot doesn't publish a `com.fasterxml.jackson.databind.ObjectMapper` bean here
    // (see ApiTestSupport's note), so this reads/writes the jsonb column with its own instance.
    private val objectMapper = ObjectMapper()

    /** Idempotent: a re-delivered event (gateway's bounded publish queue never retries, but a
     *  future retry policy might) lands the same row instead of failing the request. */
    fun insert(event: GuardEventRecord) {
        jdbcTemplate.update({ connection ->
            val statement: PreparedStatement = connection.prepareStatement(INSERT_SQL)
            statement.setObject(1, event.eventId)
            statement.setString(2, event.sessionId)
            statement.setTimestamp(3, Timestamp.from(event.ts))
            statement.setString(4, event.direction)
            statement.setString(5, event.toolName)
            statement.setString(6, event.argsDigest)
            statement.setString(7, event.verdict)
            statement.setBigDecimal(8, event.riskScore)
            statement.setArray(9, connection.createArrayOf("text", event.matchedPolicyIds.toTypedArray()))
            statement.setObject(10, jsonb(objectMapper.writeValueAsString(event.detections)))
            statement.setString(11, event.maskDiffRef)
            statement.setString(12, event.rawPayload)
            statement
        })
    }

    fun findById(eventId: UUID): GuardEventRecord? =
        jdbcTemplate.query(SELECT_SQL, rowMapper, eventId).firstOrNull()

    private val rowMapper = RowMapper { rs, _ ->
        @Suppress("UNCHECKED_CAST")
        val policyIds = (rs.getArray("matched_policy_ids").array as Array<Any?>).map { it as String }
        val detections: List<Map<String, Any?>> = objectMapper.readValue(
            rs.getString("detections"),
            object : TypeReference<List<Map<String, Any?>>>() {},
        )
        GuardEventRecord(
            eventId = rs.getObject("event_id", UUID::class.java),
            sessionId = rs.getString("session_id"),
            ts = rs.getTimestamp("ts").toInstant(),
            direction = rs.getString("direction"),
            toolName = rs.getString("tool_name"),
            argsDigest = rs.getString("args_digest"),
            verdict = rs.getString("verdict"),
            riskScore = rs.getBigDecimal("risk_score"),
            matchedPolicyIds = policyIds,
            detections = detections,
            maskDiffRef = rs.getString("mask_diff_ref"),
            rawPayload = rs.getString("raw_payload"),
        )
    }

    private fun jsonb(json: String): PGobject = PGobject().apply {
        type = "jsonb"
        value = json
    }

    companion object {
        private const val INSERT_SQL = """
            INSERT INTO guard_event
                (event_id, session_id, ts, direction, tool_name, args_digest, verdict, risk_score,
                 matched_policy_ids, detections, mask_diff_ref, raw_payload)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (event_id) DO NOTHING
        """

        private const val SELECT_SQL = """
            SELECT event_id, session_id, ts, direction, tool_name, args_digest, verdict, risk_score,
                   matched_policy_ids, detections, mask_diff_ref, raw_payload
            FROM guard_event
            WHERE event_id = ?
        """
    }
}

/**
 * NFR-06: one JSON line per ingested event with the minimum required fields (timestamp, level,
 * eventId, sessionId, verdict, message), independent of and in addition to the DB row —
 * "구조화 로그... DB 저장과 이중화".
 */
@Component
class AuditStructuredLogger {
    private val objectMapper = ObjectMapper()
    private val logger = org.slf4j.LoggerFactory.getLogger("guardmcp.audit")

    fun logIngested(event: GuardEventRecord) {
        val line = objectMapper.writeValueAsString(
            linkedMapOf(
                "timestamp" to Instant.now().toString(),
                "level" to "info",
                "eventId" to event.eventId.toString(),
                "sessionId" to event.sessionId,
                "verdict" to event.verdict,
                "message" to "guard_event ingested: tool=${event.toolName} direction=${event.direction}",
            ),
        )
        logger.info(line)
    }
}
