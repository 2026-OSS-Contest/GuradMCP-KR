package kr.guardmcp.controlplane.domain

import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.databind.ObjectMapper
import org.postgresql.util.PGobject
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.RowMapper
import org.springframework.stereotype.Component
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
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
    /**
     * GMCP-84 §5.1: nullable reference into `raw_payload`. Null unless
     * [kr.guardmcp.controlplane.domain.GuardSettingsStore]'s `rawPayloadStorageEnabled` was true
     * (`PUT /api/v1/settings`) *and* [RawPayloadStore] had an encryption key configured at
     * ingest time -- the only writer of this column is [GuardEventRepository.insert].
     */
    val rawPayloadRef: UUID?,
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
    /**
     * SPEC-POL-04 §4.1 (GMCP-77): the shadow (dry_run) policy group's own verdict for this
     * event, or null when no dry-run policy matched — never a synthesized 'allow'. Defaulted
     * to null/empty/false so every pre-GMCP-77 fixture/test that builds a [GuardEventRecord]
     * without these (the same reasoning as `seq`/`prevHash`/`hash` above) keeps compiling.
     */
    val dryRunVerdict: String? = null,
    val dryRunMatchedPolicyIds: List<String> = emptyList(),
    val wouldEscalate: Boolean = false,
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
    /** Plaintext, gated by the caller ([kr.guardmcp.controlplane.api.AuditEventController.ingest])
     *  on `rawPayloadStorageEnabled`. [GuardEventRepository.insert] is the only place this is
     *  ever encrypted and written -- see [GuardEventRecord.rawPayloadRef]. */
    val rawPayload: String?,
    /** SPEC-POL-04 §4.1 (GMCP-77): see [GuardEventRecord]'s doc comment for the same fields. */
    val dryRunVerdict: String? = null,
    val dryRunMatchedPolicyIds: List<String> = emptyList(),
    val wouldEscalate: Boolean = false,
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

/** SPEC-POL-04 §4.3/§6.1 `production.dailySeries` one point, bucketed by KST calendar date. */
data class PolicyDryRunDailyPoint(val date: java.time.LocalDate, val matchCount: Int, val wouldBlockCount: Int)

/** SPEC-POL-04 §6.1 `production` block. */
data class PolicyDryRunProductionStats(
    val matchCount: Int,
    /** Keyed by the wire verdict string (`block`, `require_approval`, `warn`, `mask_then_allow`). */
    val verdictBreakdown: Map<String, Int>,
    val wouldEscalateCount: Int,
    val dailySeries: List<PolicyDryRunDailyPoint>,
    /** Not part of the `production` JSON block (§6.1's example has no such field there) — read
     *  by [kr.guardmcp.controlplane.api.PolicyController] only for the back-compat top-level
     *  `lastTriggeredAt` (GMCP-80 §3.5) when the policy itself is dry-run. */
    val lastMatchedAt: Instant?,
)

@Component
class GuardEventRepository(
    private val jdbcTemplate: JdbcTemplate,
    private val rawPayloadStore: RawPayloadStore,
    transactionManager: PlatformTransactionManager,
) : AuditEventQueries {
    // Spring Boot doesn't publish a `com.fasterxml.jackson.databind.ObjectMapper` bean here
    // (see ApiTestSupport's note), so this reads/writes the jsonb column with its own instance.
    private val objectMapper = ObjectMapper()

    // Programmatic, same reasoning as GuardSettingsStore's own TransactionTemplate: this wraps
    // the guard_event insert and the follow-up raw_payload insert + raw_payload_ref update in one
    // commit, without the declarative-@Transactional-commits-after-return trap that would let a
    // second thread see a torn write.
    private val transactionTemplate = TransactionTemplate(transactionManager)

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
     * the "write this one" steps, with the `transactionTemplate.execute` block (guard_event
     * insert + raw_payload insert + raw_payload_ref update, see the field above) nested inside
     * it — not the other way around. Not wrapped in a method-level `@Transactional`, deliberately:
     * a declarative transaction only commits *after* the method returns (see `GuardSettingsStore`'s
     * doc comment for the same reasoning), so a lock released *inside* the transactional method
     * would let a second thread read a stale "last event" and mint a duplicate `seq` before the
     * first thread's insert is even durable. `findById`/`lastBySessionId` below run under the lock
     * but outside any transaction (each is its own autocommit read); the lock alone is what makes
     * the read-then-write atomic, and the inner `TransactionTemplate` only makes the two-table
     * write itself commit-or-rollback together.
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
                rawPayloadRef = null,
                seq = seq,
                prevHash = prevHash,
                hash = null,
                dryRunVerdict = draft.dryRunVerdict,
                dryRunMatchedPolicyIds = draft.dryRunMatchedPolicyIds,
                wouldEscalate = draft.wouldEscalate,
            )
            // NFR-04's own hash never covers the raw payload (GuardEventHasher.payload doesn't
            // read rawPayload{,Ref}), so moving it off this row into raw_payload can never change
            // a hash computed here or previously stored.
            val hash = GuardEventHasher.computeHash(prevHash, GuardEventHasher.payload(record))

            transactionTemplate.execute {
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
                    statement.setLong(12, seq)
                    statement.setString(13, prevHash)
                    statement.setString(14, hash)
                    statement.setString(15, record.dryRunVerdict)
                    statement.setArray(16, connection.createArrayOf("text", record.dryRunMatchedPolicyIds.toTypedArray()))
                    statement.setBoolean(17, record.wouldEscalate)
                    statement
                })
                // raw_payload.event_id FKs to guard_event, so it can only be inserted after the
                // row above exists -- and only for a call that actually stored a new row: a
                // redelivery (ON CONFLICT DO NOTHING no-op) must not mint a second raw_payload row.
                if (rowsAffected > 0 && draft.rawPayload != null) {
                    val rawPayloadId = rawPayloadStore.insert(record.eventId, draft.rawPayload)
                    if (rawPayloadId != null) {
                        jdbcTemplate.update(UPDATE_RAW_PAYLOAD_REF_SQL, rawPayloadId, record.eventId)
                    }
                }
                rowsAffected > 0
            } ?: false
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

    /**
     * SPEC-POL-04 §6.1 `production` block: how often a policy matched as part of the shadow
     * group on real traffic, and what the shadow verdict would have been. Queried directly
     * against `guard_event` rather than a `PolicyDryRunStat` rollup table (§4.3/§6.2) — this
     * scope skips the Redis-counter/nightly-batch optimization the spec allows for and answers
     * straight from the source, which is simpler and, for this system's event volume, no less
     * accurate; revisit if `guard_event` grows large enough for this scan to matter.
     *
     * The daily bucket is KST (§4.3's "NFR-07 고려해 KST 고정 권장"), not the row's own `ts`
     * timezone.
     */
    fun dryRunStats(policyId: String, since: Instant): PolicyDryRunProductionStats {
        val totals = jdbcTemplate.query(
            """
            SELECT COUNT(*) AS match_count,
                   COUNT(*) FILTER (WHERE would_escalate) AS would_escalate_count,
                   MAX(ts) AS last_ts
            FROM guard_event
            WHERE ? = ANY(dry_run_matched_policy_ids) AND ts >= ?
            """.trimIndent(),
            { rs, _ -> Triple(rs.getInt("match_count"), rs.getInt("would_escalate_count"), rs.getTimestamp("last_ts")?.toInstant()) },
            policyId,
            Timestamp.from(since),
        ).first()

        val breakdown = jdbcTemplate.query(
            """
            SELECT dry_run_verdict, COUNT(*) AS verdict_count
            FROM guard_event
            WHERE ? = ANY(dry_run_matched_policy_ids) AND ts >= ? AND dry_run_verdict IS NOT NULL
            GROUP BY dry_run_verdict
            """.trimIndent(),
            { rs, _ -> rs.getString("dry_run_verdict") to rs.getInt("verdict_count") },
            policyId,
            Timestamp.from(since),
        ).toMap()

        val dailySeries = jdbcTemplate.query(
            """
            SELECT (ts AT TIME ZONE 'Asia/Seoul')::date AS day,
                   COUNT(*) AS match_count,
                   COUNT(*) FILTER (WHERE dry_run_verdict = 'block') AS would_block_count
            FROM guard_event
            WHERE ? = ANY(dry_run_matched_policy_ids) AND ts >= ?
            GROUP BY day
            ORDER BY day
            """.trimIndent(),
            { rs, _ ->
                PolicyDryRunDailyPoint(
                    date = rs.getDate("day").toLocalDate(),
                    matchCount = rs.getInt("match_count"),
                    wouldBlockCount = rs.getInt("would_block_count"),
                )
            },
            policyId,
            Timestamp.from(since),
        )

        return PolicyDryRunProductionStats(
            matchCount = totals.first,
            verdictBreakdown = breakdown,
            wouldEscalateCount = totals.second,
            dailySeries = dailySeries,
            lastMatchedAt = totals.third,
        )
    }

    /**
     * SPEC-POL-04 §6.1's closing note: for a policy that is `dryRun: false` (already active,
     * possibly after having been dry-run earlier), `production.verdictBreakdown` shows its
     * *real* activation history — `matched_policy_ids`/`verdict`, the same columns
     * [policyStats] reads — never the shadow (`dry_run_*`) columns, which for an
     * already-actionable policy only ever hold its pre-activation dry-run past, a separate
     * story from "how this policy is behaving now that it's live". `wouldEscalateCount` is
     * always 0 here: an active policy being compared to itself has nothing to escalate past.
     */
    fun activationStats(policyId: String, since: Instant): PolicyDryRunProductionStats {
        val totals = jdbcTemplate.query(
            "SELECT COUNT(*) AS match_count, MAX(ts) AS last_ts FROM guard_event WHERE ? = ANY(matched_policy_ids) AND ts >= ?",
            { rs, _ -> rs.getInt("match_count") to rs.getTimestamp("last_ts")?.toInstant() },
            policyId,
            Timestamp.from(since),
        ).first()

        val breakdown = jdbcTemplate.query(
            """
            SELECT verdict, COUNT(*) AS verdict_count
            FROM guard_event
            WHERE ? = ANY(matched_policy_ids) AND ts >= ?
            GROUP BY verdict
            """.trimIndent(),
            { rs, _ -> rs.getString("verdict") to rs.getInt("verdict_count") },
            policyId,
            Timestamp.from(since),
        ).toMap()

        val dailySeries = jdbcTemplate.query(
            """
            SELECT (ts AT TIME ZONE 'Asia/Seoul')::date AS day,
                   COUNT(*) AS match_count,
                   COUNT(*) FILTER (WHERE verdict = 'block') AS would_block_count
            FROM guard_event
            WHERE ? = ANY(matched_policy_ids) AND ts >= ?
            GROUP BY day
            ORDER BY day
            """.trimIndent(),
            { rs, _ ->
                PolicyDryRunDailyPoint(
                    date = rs.getDate("day").toLocalDate(),
                    matchCount = rs.getInt("match_count"),
                    wouldBlockCount = rs.getInt("would_block_count"),
                )
            },
            policyId,
            Timestamp.from(since),
        )

        return PolicyDryRunProductionStats(
            matchCount = totals.first,
            verdictBreakdown = breakdown,
            wouldEscalateCount = 0,
            dailySeries = dailySeries,
            lastMatchedAt = totals.second,
        )
    }

    private val rowMapper = RowMapper { rs, _ ->
        @Suppress("UNCHECKED_CAST")
        val policyIds = (rs.getArray("matched_policy_ids").array as Array<Any?>).map { it as String }
        @Suppress("UNCHECKED_CAST")
        val dryRunPolicyIds = (rs.getArray("dry_run_matched_policy_ids").array as Array<Any?>).map { it as String }
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
            rawPayloadRef = rs.getObject("raw_payload_ref", UUID::class.java),
            seq = seq,
            prevHash = rs.getString("prev_hash"),
            hash = rs.getString("hash"),
            dryRunVerdict = rs.getString("dry_run_verdict"),
            dryRunMatchedPolicyIds = dryRunPolicyIds,
            wouldEscalate = rs.getBoolean("would_escalate"),
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
                 matched_policy_ids, detections, mask_diff_ref, seq, prev_hash, hash,
                 dry_run_verdict, dry_run_matched_policy_ids, would_escalate)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (event_id) DO NOTHING
        """

        private const val UPDATE_RAW_PAYLOAD_REF_SQL =
            "UPDATE guard_event SET raw_payload_ref = ? WHERE event_id = ?"

        private const val SELECT_COLUMNS_FROM = """
            SELECT event_id, session_id, ts, direction, tool_name, args_digest, verdict, risk_score,
                   matched_policy_ids, detections, mask_diff_ref, raw_payload_ref, seq, prev_hash, hash,
                   dry_run_verdict, dry_run_matched_policy_ids, would_escalate
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
