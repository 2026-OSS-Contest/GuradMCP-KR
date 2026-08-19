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
import java.util.concurrent.ConcurrentHashMap

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
    /** NFR-04 opt-in only; null unless [kr.guardmcp.controlplane.domain.GuardSettingsStore]'s
     *  `storeRawOptIn` was true (`PUT /api/v1/settings`) at ingest time. */
    val rawPayload: String?,
    /**
     * GMCP-83 hash chain fields (docs/task-docs/GMCP-83/audit-hash-chain-spec.md §2). Nullable,
     * not because a freshly-ingested row can have one unset ([GuardEventRepository.insert]
     * always fills all three) but because a row written before this ticket has none — see
     * [ChainStatus.UNKNOWN]. Defaulted to null so every existing test/production fixture that
     * builds a [GuardEventRecord] without these (e.g. `LiveReplaySourceKotest`'s `record()`)
     * keeps compiling and keeps meaning "no chain to verify."
     */
    val seq: Long? = null,
    val prevHash: String? = null,
    val hash: String? = null,
)

/**
 * What the ingest endpoint has before a row exists: everything [GuardEventRecord] carries
 * except the chain fields, which only [GuardEventRepository.insert] can assign — it alone knows
 * the session's last `seq`/`hash` under the per-session lock that makes assigning them safe.
 */
data class GuardEventDraft(
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
    val rawPayload: String?,
)

/**
 * The slice of the audit log Replay reads (GMCP-114). Declared as an interface so the
 * projection can be exercised without Postgres; [GuardEventRepository] is the only
 * production implementation.
 */
interface AuditEventQueries {
    fun findSessionIds(): List<String>
    fun findBySessionId(sessionId: String): List<GuardEventRecord>

    /** `seq` ascending — the chain's integrity order (GMCP-83 §4.1), not [findBySessionId]'s
     *  `ts` display order. A row from before the chain existed sorts last (`seq IS NULL`). */
    fun findBySessionIdOrderBySeq(sessionId: String): List<GuardEventRecord>
    fun findById(eventId: UUID): GuardEventRecord?
}

/** `GET /policies/{id}/stats` (GMCP-80 §3.5): a policy's trigger count and most recent hit within a window. */
data class PolicyTriggerStats(val triggeredCount: Int, val lastTriggeredAt: Instant?)

@Component
class GuardEventRepository(private val jdbcTemplate: JdbcTemplate) : AuditEventQueries {
    // Spring Boot doesn't publish a `com.fasterxml.jackson.databind.ObjectMapper` bean here
    // (see ApiTestSupport's note), so this reads/writes the jsonb column with its own instance.
    private val objectMapper = ObjectMapper()

    // One lock object per session id, not one global lock: sessions are independent chains
    // (spec §1), so serializing unrelated sessions' inserts against each other would only add
    // contention with no correctness benefit. This is a single-instance (in-JVM) guarantee —
    // matching this codebase's existing concurrency pattern (`AuditChain`, `GuardSettingsStore`:
    // `synchronized(lock)`, no distributed lock infra anywhere in control-plane) — not a
    // cross-instance one; horizontal scaling of this service would need a real distributed lock
    // (spec §3.3's Redis suggestion), which is out of scope here.
    private val sessionLocks = ConcurrentHashMap<String, Any>()

    /**
     * Assigns `seq`/`prev_hash`/`hash` and persists the row (spec §3.3, pipeline stage ⑧).
     *
     * The per-session lock is the outermost scope around both the "read the last event" and
     * the "write this one" steps — not wrapped in `@Transactional`, deliberately: a declarative
     * transaction only commits *after* this method returns (see `GuardSettingsStore`'s doc
     * comment for the same reasoning), so a lock released *inside* the transactional method
     * would let a second thread read a stale "last event" and mint a duplicate `seq` before the
     * first thread's insert is even durable. `synchronized` here, wrapping a plain autocommit
     * insert, is what actually makes the read-then-write atomic.
     *
     * Idempotent: a re-delivered event (gateway's bounded publish queue never retries, but a
     * future retry policy might) is detected under the same lock — before a `seq` is minted for
     * it — rather than only at the `ON CONFLICT DO NOTHING` (kept as a defense-in-depth backstop,
     * not the primary de-dup path: relying on it alone here would burn a `seq` number on every
     * redelivery). Returns whether this call actually stored a new row.
     */
    fun insert(draft: GuardEventDraft): Boolean =
        synchronized(sessionLocks.computeIfAbsent(draft.sessionId) { Any() }) {
            if (findById(draft.eventId) != null) return@synchronized false

            val last = lastBySessionId(draft.sessionId)
            val seq = (last?.seq ?: 0L) + 1
            val prevHash = last?.hash ?: GuardEventHasher.genesisHash(draft.sessionId)
            val record = GuardEventRecord(
                eventId = draft.eventId,
                sessionId = draft.sessionId,
                ts = draft.ts,
                direction = draft.direction,
                toolName = draft.toolName,
                argsDigest = draft.argsDigest,
                verdict = draft.verdict,
                riskScore = draft.riskScore,
                matchedPolicyIds = draft.matchedPolicyIds,
                detections = draft.detections,
                maskDiffRef = draft.maskDiffRef,
                rawPayload = draft.rawPayload,
                seq = seq,
                prevHash = prevHash,
                hash = null,
            )
            val hash = GuardEventHasher.computeHash(prevHash, GuardEventHasher.payload(record))

            val rowsAffected = jdbcTemplate.update({ connection ->
                val statement: PreparedStatement = connection.prepareStatement(INSERT_SQL)
                statement.setObject(1, record.eventId)
                statement.setString(2, record.sessionId)
                statement.setTimestamp(3, Timestamp.from(record.ts))
                statement.setString(4, record.direction)
                statement.setString(5, record.toolName)
                statement.setString(6, record.argsDigest)
                statement.setString(7, record.verdict)
                statement.setBigDecimal(8, record.riskScore)
                statement.setArray(9, connection.createArrayOf("text", record.matchedPolicyIds.toTypedArray()))
                statement.setObject(10, jsonb(objectMapper.writeValueAsString(record.detections)))
                statement.setString(11, record.maskDiffRef)
                statement.setString(12, record.rawPayload)
                statement.setLong(13, seq)
                statement.setString(14, prevHash)
                statement.setString(15, hash)
                statement
            })
            rowsAffected > 0
        }

    /** The chain's tip for a session, or `null` for its first event (spec §3.1 genesis case). */
    private fun lastBySessionId(sessionId: String): GuardEventRecord? =
        jdbcTemplate.query(SELECT_LAST_BY_SESSION_SQL, rowMapper, sessionId).firstOrNull()

    override fun findById(eventId: UUID): GuardEventRecord? =
        jdbcTemplate.query(SELECT_SQL, rowMapper, eventId).firstOrNull()

    /**
     * Session ids present in the log (GMCP-114). Replay lists sessions before it knows
     * which one a reader wants, so this stays a projection over ids rather than loading
     * every event.
     *
     * Ordered by most recent activity, but that is only a deterministic base: sessions
     * are re-sorted by `startedAt` once seeded and projected sessions are merged, so
     * callers must not treat this order as the one the API answers with.
     */
    override fun findSessionIds(): List<String> =
        // session_id is NOT NULL in the schema, but queryForList types the column as
        // nullable; filtering keeps the signature honest without a cast.
        jdbcTemplate.queryForList(SELECT_SESSION_IDS_SQL, String::class.java).filterNotNull()

    /**
     * Every event of one session, ordered the way the Replay timeline orders nodes:
     * `ts` ascending with `event_id` as the tie-break, so two events written in the
     * same millisecond still come back in a stable order.
     */
    override fun findBySessionId(sessionId: String): List<GuardEventRecord> =
        jdbcTemplate.query(SELECT_BY_SESSION_SQL, rowMapper, sessionId)

    /** Chain integrity order (GMCP-83 §4.1) — see [AuditEventQueries.findBySessionIdOrderBySeq]. */
    override fun findBySessionIdOrderBySeq(sessionId: String): List<GuardEventRecord> =
        jdbcTemplate.query(SELECT_BY_SESSION_ORDER_SEQ_SQL, rowMapper, sessionId)

    /**
     * Newest-first, optionally scoped to a session and to strictly-after an anchor point
     * (GMCP-80 §3.3 gap-fill: SSE reconnect resumes from the last event it saw).
     *
     * The anchor is `(ts, eventId)`, not just `ts`: eventIds are random UUIDs, not monotonic,
     * so two events sharing a `ts` (same millisecond) need a second, stable tie-break or a
     * naive `ts > ?` filter drops/duplicates rows at the boundary — the exact "중복/누락 없이
     * 병합" requirement the spec calls out. `ORDER BY ... event_id DESC` mirrors the same
     * tie-break so the comparison and the ordering never disagree at the boundary row.
     */
    fun findRecent(limit: Int, sessionId: String?, sinceTs: Instant?, sinceEventId: UUID?): List<GuardEventRecord> {
        val sql = buildString {
            append(SELECT_COLUMNS_FROM)
            append(" WHERE 1 = 1")
            if (sessionId != null) append(" AND session_id = ?")
            if (sinceTs != null) append(" AND (ts, event_id) > (?, ?)")
            append(" ORDER BY ts DESC, event_id DESC LIMIT ?")
        }
        val args = buildList<Any?> {
            if (sessionId != null) add(sessionId)
            if (sinceTs != null) {
                add(Timestamp.from(sinceTs))
                add(sinceEventId)
            }
            add(limit)
        }
        return jdbcTemplate.query(sql, rowMapper, *args.toTypedArray())
    }

    /** `matched_policy_ids` is a `text[]`; `= ANY(...)` is the array-membership test for it. */
    fun policyStats(policyId: String, since: Instant): PolicyTriggerStats =
        jdbcTemplate.query(
            "SELECT COUNT(*) AS triggered_count, MAX(ts) AS last_ts FROM guard_event WHERE ? = ANY(matched_policy_ids) AND ts >= ?",
            { rs, _ -> PolicyTriggerStats(rs.getInt("triggered_count"), rs.getTimestamp("last_ts")?.toInstant()) },
            policyId,
            Timestamp.from(since),
        ).first()

    private val rowMapper = RowMapper { rs, _ ->
        @Suppress("UNCHECKED_CAST")
        val policyIds = (rs.getArray("matched_policy_ids").array as Array<Any?>).map { it as String }
        val detections: List<Map<String, Any?>> = objectMapper.readValue(
            rs.getString("detections"),
            object : TypeReference<List<Map<String, Any?>>>() {},
        )
        // rs.getLong returns 0 for SQL NULL; wasNull() is the only way to tell "no seq yet"
        // (a pre-chain row) apart from an actual seq of 0 (which never occurs — seq starts at 1).
        val seq = rs.getLong("seq").takeUnless { rs.wasNull() }
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
            seq = seq,
            prevHash = rs.getString("prev_hash"),
            hash = rs.getString("hash"),
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
                 matched_policy_ids, detections, mask_diff_ref, raw_payload, seq, prev_hash, hash)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (event_id) DO NOTHING
        """

        private const val SELECT_COLUMNS_FROM = """
            SELECT event_id, session_id, ts, direction, tool_name, args_digest, verdict, risk_score,
                   matched_policy_ids, detections, mask_diff_ref, raw_payload, seq, prev_hash, hash
            FROM guard_event
        """

        private const val SELECT_SESSION_IDS_SQL = """
            SELECT session_id
            FROM guard_event
            GROUP BY session_id
            ORDER BY MAX(ts) DESC, session_id
        """

        private const val SELECT_BY_SESSION_SQL = """
            $SELECT_COLUMNS_FROM
            WHERE session_id = ?
            ORDER BY ts, event_id
        """

        private const val SELECT_BY_SESSION_ORDER_SEQ_SQL = """
            $SELECT_COLUMNS_FROM
            WHERE session_id = ?
            ORDER BY seq ASC NULLS LAST, ts, event_id
        """

        private const val SELECT_LAST_BY_SESSION_SQL = """
            $SELECT_COLUMNS_FROM
            WHERE session_id = ?
            ORDER BY seq DESC NULLS LAST, ts DESC
            LIMIT 1
        """

        private const val SELECT_SQL = "$SELECT_COLUMNS_FROM WHERE event_id = ?"
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

    fun logIngested(event: GuardEventDraft) {
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
