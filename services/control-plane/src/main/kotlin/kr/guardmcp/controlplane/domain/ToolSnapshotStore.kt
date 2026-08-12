package kr.guardmcp.controlplane.domain

import com.fasterxml.jackson.annotation.JsonValue
import com.fasterxml.jackson.databind.ObjectMapper
import org.postgresql.util.PGobject
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.RowMapper
import org.springframework.stereotype.Component
import org.springframework.transaction.annotation.Transactional
import java.sql.PreparedStatement
import java.sql.Timestamp
import java.time.Clock
import java.time.Instant
import java.util.UUID

enum class ToolSnapshotStatus(@get:JsonValue val wire: String) {
    ACTIVE("active"),
    SUPERSEDED("superseded");

    companion object {
        fun fromWire(value: String): ToolSnapshotStatus? = entries.firstOrNull { it.wire == value }
    }
}

enum class ToolDiffType(@get:JsonValue val wire: String) {
    TOOL_ADDED("tool_added"),
    TOOL_REMOVED("tool_removed"),
    DESCRIPTION_CHANGED("description_changed"),
    SCHEMA_CHANGED("schema_changed");

    companion object {
        fun fromWire(value: String): ToolDiffType? = entries.firstOrNull { it.wire == value }
    }
}

/** The approved baseline for one tool (spec §4 `ToolSnapshot`). `inputSchema`/`fingerprint` are
 *  opaque JSON/hash text this service stores and returns verbatim — see V2 migration header. */
data class ToolSnapshot(
    val id: UUID,
    val serverId: UUID,
    val toolName: String,
    val description: String,
    val inputSchema: String,
    val fingerprint: String,
    val capturedAt: Instant,
    val capturedBy: String,
    val status: ToolSnapshotStatus,
)

/** One drift record (spec §4 `ToolDefinitionDiff`). `before`/`after` are raw JSON text. */
data class ToolDefinitionDiff(
    val id: UUID,
    val serverId: UUID,
    val toolName: String,
    val snapshotId: UUID?,
    val diffType: ToolDiffType,
    val before: String?,
    val after: String?,
    val detectedAt: Instant,
    val acknowledged: Boolean,
    val acknowledgedBy: String?,
    val acknowledgedAt: Instant?,
)

/** Latest `tools/list` observation for one (server, tool) pair, independent of approval state. */
data class ToolObservation(
    val serverId: UUID,
    val toolName: String,
    val description: String,
    val inputSchema: String,
    val fingerprint: String,
    val observedAt: Instant,
)

/** One tool as submitted to the approve/re-approve endpoint (spec §5.1.4). */
data class ApprovedToolInput(
    val name: String,
    val description: String,
    val inputSchema: String,
    val fingerprint: String,
)

/** One drift as reported by the gateway watcher, before this service assigns it an id/timestamp. */
data class ReportedDiff(
    val toolName: String,
    val diffType: ToolDiffType,
    val before: String?,
    val after: String?,
)

/** Per-tool status the console renders (spec §6.1 `snapshotStatus`). */
data class ToolSnapshotStatusView(
    val state: String,
    val snapshotCapturedAt: Instant?,
    val lastCheckedAt: Instant?,
    val pendingDiffCount: Int,
    val latestDiffId: UUID?,
)

class ToolDiffNotFoundException(serverId: String, toolName: String, diffId: String) :
    RuntimeException("diff $diffId for $serverId/$toolName not found")

/**
 * `tool_snapshot` / `tool_definition_diff` / `tool_observation` repository. Follows
 * [GuardEventRepository]'s pattern (`JdbcTemplate`, hand-written SQL, no ORM — this
 * codebase has no JPA layer anywhere) rather than introducing a new persistence style.
 */
@Component
class ToolSnapshotStore(private val jdbcTemplate: JdbcTemplate, private val clock: Clock) {
    private val objectMapper = ObjectMapper()

    /**
     * Supersedes each tool's previous active snapshot (if any) and inserts a new one
     * (spec §5.1.2 initial capture, §5.1.4 re-approval — the same operation either way).
     * Transactional so a re-approval never leaves two rows racing for "active" on the
     * partial unique index.
     */
    @Transactional
    fun approve(serverId: UUID, capturedBy: String, tools: List<ApprovedToolInput>): List<ToolSnapshot> {
        val now = clock.instant()
        return tools.map { tool ->
            jdbcTemplate.update(SUPERSEDE_SQL, serverId, tool.name)
            val snapshot = ToolSnapshot(
                id = UUID.randomUUID(), serverId = serverId, toolName = tool.name,
                description = tool.description, inputSchema = tool.inputSchema, fingerprint = tool.fingerprint,
                capturedAt = now, capturedBy = capturedBy, status = ToolSnapshotStatus.ACTIVE,
            )
            insertSnapshot(snapshot)
            snapshot
        }
    }

    private fun insertSnapshot(snapshot: ToolSnapshot) {
        jdbcTemplate.update({ connection ->
            val statement: PreparedStatement = connection.prepareStatement(INSERT_SNAPSHOT_SQL)
            statement.setObject(1, snapshot.id)
            statement.setObject(2, snapshot.serverId)
            statement.setString(3, snapshot.toolName)
            statement.setString(4, snapshot.description)
            statement.setObject(5, jsonb(snapshot.inputSchema))
            statement.setString(6, snapshot.fingerprint)
            statement.setTimestamp(7, Timestamp.from(snapshot.capturedAt))
            statement.setString(8, snapshot.capturedBy)
            statement.setString(9, snapshot.status.wire)
            statement
        })
    }

    fun activeSnapshots(serverId: UUID): List<ToolSnapshot> =
        jdbcTemplate.query(SELECT_ACTIVE_SNAPSHOTS_SQL, snapshotRowMapper, serverId)

    private fun activeSnapshot(serverId: UUID, toolName: String): ToolSnapshot? =
        jdbcTemplate.query(SELECT_ACTIVE_SNAPSHOT_SQL, snapshotRowMapper, serverId, toolName).firstOrNull()

    /**
     * Persists gateway-reported drift (spec §5.2 step 3). Each diff is linked to the tool's
     * current active snapshot when one exists — null only for `tool_added` (no prior row).
     *
     * The gateway has no persistent connection to the upstream MCP server, so it detects drift
     * on every `tools/list` call that passes through it (spec §11: no background poll of the
     * upstream). Left unguarded, an Agent calling `tools/list` repeatedly while a drifted tool
     * sits unacknowledged would insert a fresh row every single time, inflating
     * `pendingDiffCount` and the diff list with N copies of the same finding. Dedup on
     * (serverId, toolName, diffType) among *unacknowledged* rows: a still-open finding for the
     * same tool and change kind isn't reported again until it's acknowledged or the tool is
     * re-approved (which clears it by making the description the new baseline).
     */
    fun recordDiffs(serverId: UUID, diffs: List<ReportedDiff>): List<ToolDefinitionDiff> {
        val now = clock.instant()
        val result = mutableListOf<ToolDefinitionDiff>()
        for (reported in diffs) {
            val pending = pendingDiffs(serverId, reported.toolName).firstOrNull { it.diffType == reported.diffType }
            if (pending != null) {
                result += pending
                continue
            }
            val snapshot = activeSnapshot(serverId, reported.toolName)
            val diff = ToolDefinitionDiff(
                id = UUID.randomUUID(), serverId = serverId, toolName = reported.toolName,
                snapshotId = snapshot?.id, diffType = reported.diffType,
                before = reported.before, after = reported.after,
                detectedAt = now, acknowledged = false, acknowledgedBy = null, acknowledgedAt = null,
            )
            insertDiff(diff)
            result += diff
        }
        return result
    }

    private fun insertDiff(diff: ToolDefinitionDiff) {
        jdbcTemplate.update({ connection ->
            val statement: PreparedStatement = connection.prepareStatement(INSERT_DIFF_SQL)
            statement.setObject(1, diff.id)
            statement.setObject(2, diff.serverId)
            statement.setString(3, diff.toolName)
            statement.setObject(4, diff.snapshotId)
            statement.setString(5, diff.diffType.wire)
            statement.setObject(6, diff.before?.let(::jsonb))
            statement.setObject(7, diff.after?.let(::jsonb))
            statement.setTimestamp(8, Timestamp.from(diff.detectedAt))
            statement.setBoolean(9, diff.acknowledged)
            statement.setString(10, diff.acknowledgedBy)
            statement.setTimestamp(11, diff.acknowledgedAt?.let(Timestamp::from))
            statement
        })
    }

    /** Unacknowledged diffs, most recent first (spec §6.2). */
    fun pendingDiffs(serverId: UUID, toolName: String): List<ToolDefinitionDiff> =
        jdbcTemplate.query(SELECT_PENDING_DIFFS_SQL, diffRowMapper, serverId, toolName)

    /** Every diff for the tool, acknowledged or not, most recent first — spec §9 AC-4's
     *  "acknowledge 후에도 재조회 시 acknowledged: true가 유지된다" is otherwise unobservable,
     *  since [pendingDiffs] excludes exactly the rows that criterion is about. */
    fun allDiffs(serverId: UUID, toolName: String): List<ToolDefinitionDiff> =
        jdbcTemplate.query(SELECT_ALL_DIFFS_SQL, diffRowMapper, serverId, toolName)

    fun findDiff(serverId: UUID, toolName: String, diffId: UUID): ToolDefinitionDiff? =
        jdbcTemplate.query(SELECT_DIFF_SQL, diffRowMapper, diffId, serverId, toolName).firstOrNull()

    /** Marks a diff confirmed without touching the snapshot it was raised against (spec §6.3:
     *  acknowledging and re-approving are deliberately separate operations). */
    fun acknowledge(serverId: UUID, toolName: String, diffId: UUID, acknowledgedBy: String): ToolDefinitionDiff {
        val existing = findDiff(serverId, toolName, diffId)
            ?: throw ToolDiffNotFoundException(serverId.toString(), toolName, diffId.toString())
        if (existing.acknowledged) return existing
        val now = clock.instant()
        jdbcTemplate.update(ACKNOWLEDGE_SQL, acknowledgedBy, Timestamp.from(now), diffId)
        return existing.copy(acknowledged = true, acknowledgedBy = acknowledgedBy, acknowledgedAt = now)
    }

    /** Per-tool pending-diff count and latest diff id, for the `GET /servers` `snapshotStatus`
     *  summary (spec §6.1) — computed per server rather than per tool since `ServerController`
     *  needs it for every tool on every server in one response. */
    fun pendingDiffSummary(serverId: UUID): Map<String, Pair<Int, UUID>> {
        val rows = jdbcTemplate.query(SELECT_PENDING_SUMMARY_SQL, { rs, _ ->
            Triple(rs.getString("tool_name"), rs.getInt("pending_count"), rs.getObject("latest_diff_id", UUID::class.java))
        }, serverId)
        return rows.associate { (toolName, count, latestId) -> toolName to (count to latestId) }
    }

    fun upsertObservation(observation: ToolObservation) {
        jdbcTemplate.update({ connection ->
            val statement: PreparedStatement = connection.prepareStatement(UPSERT_OBSERVATION_SQL)
            statement.setObject(1, observation.serverId)
            statement.setString(2, observation.toolName)
            statement.setString(3, observation.description)
            statement.setObject(4, jsonb(observation.inputSchema))
            statement.setString(5, observation.fingerprint)
            statement.setTimestamp(6, Timestamp.from(observation.observedAt))
            statement
        })
    }

    fun observations(serverId: UUID): List<ToolObservation> =
        jdbcTemplate.query(SELECT_OBSERVATIONS_SQL, observationRowMapper, serverId)

    /**
     * Combines the active snapshot, latest observation, and pending-diff summary for one
     * server into the per-tool `snapshotStatus` view the console reads (spec §6.1, §9.2).
     * Tool identity is the union of "ever observed" and "has an approved snapshot," so a
     * removed tool that still has an unacknowledged `tool_removed` diff keeps showing up.
     */
    fun statusView(serverId: UUID): Map<String, ToolSnapshotStatusView> {
        val snapshots = activeSnapshots(serverId).associateBy { it.toolName }
        val observed = observations(serverId).associateBy { it.toolName }
        val pending = pendingDiffSummary(serverId)
        val toolNames = snapshots.keys + observed.keys
        return toolNames.associateWith { toolName ->
            val snapshot = snapshots[toolName]
            val (count, latestId) = pending[toolName] ?: (0 to null)
            val state = when {
                snapshot == null -> "unapproved"
                count > 0 -> "drift_detected"
                else -> "in_sync"
            }
            ToolSnapshotStatusView(
                state = state,
                snapshotCapturedAt = snapshot?.capturedAt,
                lastCheckedAt = observed[toolName]?.observedAt,
                pendingDiffCount = count,
                latestDiffId = latestId,
            )
        }
    }

    private fun jsonb(json: String): PGobject = PGobject().apply {
        type = "jsonb"
        value = json
    }

    private val snapshotRowMapper = RowMapper { rs, _ ->
        ToolSnapshot(
            id = rs.getObject("id", UUID::class.java),
            serverId = rs.getObject("server_id", UUID::class.java),
            toolName = rs.getString("tool_name"),
            description = rs.getString("description"),
            inputSchema = rs.getString("input_schema"),
            fingerprint = rs.getString("fingerprint"),
            capturedAt = rs.getTimestamp("captured_at").toInstant(),
            capturedBy = rs.getString("captured_by"),
            status = ToolSnapshotStatus.fromWire(rs.getString("status")) ?: error("unknown status in storage"),
        )
    }

    private val diffRowMapper = RowMapper { rs, _ ->
        ToolDefinitionDiff(
            id = rs.getObject("id", UUID::class.java),
            serverId = rs.getObject("server_id", UUID::class.java),
            toolName = rs.getString("tool_name"),
            snapshotId = rs.getObject("snapshot_id", UUID::class.java),
            diffType = ToolDiffType.fromWire(rs.getString("diff_type")) ?: error("unknown diff_type in storage"),
            before = rs.getString("before"),
            after = rs.getString("after"),
            detectedAt = rs.getTimestamp("detected_at").toInstant(),
            acknowledged = rs.getBoolean("acknowledged"),
            acknowledgedBy = rs.getString("acknowledged_by"),
            acknowledgedAt = rs.getTimestamp("acknowledged_at")?.toInstant(),
        )
    }

    private val observationRowMapper = RowMapper { rs, _ ->
        ToolObservation(
            serverId = rs.getObject("server_id", UUID::class.java),
            toolName = rs.getString("tool_name"),
            description = rs.getString("description"),
            inputSchema = rs.getString("input_schema"),
            fingerprint = rs.getString("fingerprint"),
            observedAt = rs.getTimestamp("observed_at").toInstant(),
        )
    }

    companion object {
        private const val SUPERSEDE_SQL = """
            UPDATE tool_snapshot SET status = 'superseded' WHERE server_id = ? AND tool_name = ? AND status = 'active'
        """

        private const val INSERT_SNAPSHOT_SQL = """
            INSERT INTO tool_snapshot (id, server_id, tool_name, description, input_schema, fingerprint, captured_at, captured_by, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """

        private const val SELECT_ACTIVE_SNAPSHOTS_SQL = """
            SELECT id, server_id, tool_name, description, input_schema, fingerprint, captured_at, captured_by, status
            FROM tool_snapshot WHERE server_id = ? AND status = 'active'
        """

        private const val SELECT_ACTIVE_SNAPSHOT_SQL = """
            SELECT id, server_id, tool_name, description, input_schema, fingerprint, captured_at, captured_by, status
            FROM tool_snapshot WHERE server_id = ? AND tool_name = ? AND status = 'active'
        """

        private const val INSERT_DIFF_SQL = """
            INSERT INTO tool_definition_diff
                (id, server_id, tool_name, snapshot_id, diff_type, before, after, detected_at, acknowledged, acknowledged_by, acknowledged_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """

        private const val SELECT_PENDING_DIFFS_SQL = """
            SELECT id, server_id, tool_name, snapshot_id, diff_type, before, after, detected_at, acknowledged, acknowledged_by, acknowledged_at
            FROM tool_definition_diff WHERE server_id = ? AND tool_name = ? AND acknowledged = false ORDER BY detected_at DESC
        """

        private const val SELECT_ALL_DIFFS_SQL = """
            SELECT id, server_id, tool_name, snapshot_id, diff_type, before, after, detected_at, acknowledged, acknowledged_by, acknowledged_at
            FROM tool_definition_diff WHERE server_id = ? AND tool_name = ? ORDER BY detected_at DESC
        """

        private const val SELECT_DIFF_SQL = """
            SELECT id, server_id, tool_name, snapshot_id, diff_type, before, after, detected_at, acknowledged, acknowledged_by, acknowledged_at
            FROM tool_definition_diff WHERE id = ? AND server_id = ? AND tool_name = ?
        """

        private const val ACKNOWLEDGE_SQL = """
            UPDATE tool_definition_diff SET acknowledged = true, acknowledged_by = ?, acknowledged_at = ? WHERE id = ?
        """

        private const val SELECT_PENDING_SUMMARY_SQL = """
            SELECT tool_name, COUNT(*) AS pending_count, (ARRAY_AGG(id ORDER BY detected_at DESC))[1] AS latest_diff_id
            FROM tool_definition_diff WHERE server_id = ? AND acknowledged = false GROUP BY tool_name
        """

        private const val UPSERT_OBSERVATION_SQL = """
            INSERT INTO tool_observation (server_id, tool_name, description, input_schema, fingerprint, observed_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (server_id, tool_name) DO UPDATE SET
                description = EXCLUDED.description, input_schema = EXCLUDED.input_schema,
                fingerprint = EXCLUDED.fingerprint, observed_at = EXCLUDED.observed_at
        """

        private const val SELECT_OBSERVATIONS_SQL = """
            SELECT server_id, tool_name, description, input_schema, fingerprint, observed_at
            FROM tool_observation WHERE server_id = ?
        """
    }
}
