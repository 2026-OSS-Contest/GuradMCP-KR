package kr.guardmcp.controlplane.domain

import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.databind.ObjectMapper
import org.postgresql.util.PGobject
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.RowMapper
import org.springframework.stereotype.Component
import java.sql.PreparedStatement
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

/**
 * Generic, queryable audit trail (GMCP-68 §3.3/§5.2), distinct from [GuardEventRepository]'s
 * per-Tool-Call `guard_event` table and from [AuditChain]'s in-memory trust-change hash chain.
 * `severity` is deliberately narrower than [Severity] — "high" is reserved for changes that make
 * the system less safe (e.g. `SETTINGS_FAILURE_POLICY_CHANGED` to `fail_open`), everything else
 * is "info", so a reader scanning by severity sees exactly the events worth a second look.
 */
data class AuditLogRecord(
    val id: UUID,
    val action: String,
    val actor: String,
    val before: Map<String, Any?>,
    val after: Map<String, Any?>,
    val severity: String,
    val requestIp: String?,
    val ts: Instant,
)

@Component
class AuditLogStore(private val jdbcTemplate: JdbcTemplate) {
    // Spring Boot doesn't publish a com.fasterxml ObjectMapper bean here (see GuardEventRepository's
    // own note), so this reads/writes the jsonb columns with its own instance.
    private val objectMapper = ObjectMapper()

    fun record(
        action: String,
        actor: String,
        before: Map<String, Any?>,
        after: Map<String, Any?>,
        severity: String,
        requestIp: String? = null,
    ): AuditLogRecord {
        val record = AuditLogRecord(
            id = UUID.randomUUID(),
            action = action,
            actor = actor,
            before = before,
            after = after,
            severity = severity,
            requestIp = requestIp,
            ts = Instant.now(),
        )
        jdbcTemplate.update({ connection ->
            val statement: PreparedStatement = connection.prepareStatement(INSERT_SQL)
            statement.setObject(1, record.id)
            statement.setString(2, record.action)
            statement.setString(3, record.actor)
            statement.setObject(4, jsonb(objectMapper.writeValueAsString(record.before)))
            statement.setObject(5, jsonb(objectMapper.writeValueAsString(record.after)))
            statement.setString(6, record.severity)
            statement.setString(7, record.requestIp)
            statement.setTimestamp(8, Timestamp.from(record.ts))
            statement
        })
        return record
    }

    /** Audit query surface named in §5.2 ("GET /api/v1/audit-log?action=..."). */
    fun findByAction(action: String): List<AuditLogRecord> =
        jdbcTemplate.query(SELECT_BY_ACTION_SQL, rowMapper, action)

    private val rowMapper = RowMapper { rs, _ ->
        AuditLogRecord(
            id = rs.getObject("id", UUID::class.java),
            action = rs.getString("action"),
            actor = rs.getString("actor"),
            before = readMap(rs.getString("before")),
            after = readMap(rs.getString("after")),
            severity = rs.getString("severity"),
            requestIp = rs.getString("request_ip"),
            ts = rs.getTimestamp("ts").toInstant(),
        )
    }

    private fun readMap(json: String): Map<String, Any?> =
        objectMapper.readValue(json, object : TypeReference<Map<String, Any?>>() {})

    private fun jsonb(json: String): PGobject = PGobject().apply {
        type = "jsonb"
        value = json
    }

    companion object {
        private const val INSERT_SQL = """
            INSERT INTO audit_log (id, action, actor, before, after, severity, request_ip, ts)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """

        private const val SELECT_BY_ACTION_SQL = """
            SELECT id, action, actor, before, after, severity, request_ip, ts
            FROM audit_log
            WHERE action = ?
            ORDER BY ts DESC
        """
    }
}
