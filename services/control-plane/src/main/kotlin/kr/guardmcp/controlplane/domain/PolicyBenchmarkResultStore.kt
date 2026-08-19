package kr.guardmcp.controlplane.domain

import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.RowMapper
import org.springframework.stereotype.Component
import java.math.BigDecimal
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

/**
 * SPEC-POL-04 §4.3/§6.1/§6.2/§8.3 (GMCP-77): one Benchmark Runner execution's FPR for one
 * policy, against a labeled Attack Lab dataset (`normalSampleCount`/`falsePositiveCount` are
 * `PolicyDryRunStat.labeledNormalMatchCount`/`labeledNormalFpCount` in the spec's own naming —
 * renamed here to match `GET /policies/{id}/stats`'s `benchmark` block field-for-field).
 */
data class PolicyBenchmarkResultRecord(
    val id: UUID,
    val policyId: String,
    val ranAt: Instant,
    val datasetVersion: String,
    val normalSampleCount: Int,
    val falsePositiveCount: Int,
    val fpr: BigDecimal,
)

/** What the Benchmark Runner posts after a run (`guardmcp bench run`, §7.1/§7.2). */
data class PolicyBenchmarkResultDraft(
    val policyId: String,
    val ranAt: Instant,
    val datasetVersion: String,
    val normalSampleCount: Int,
    val falsePositiveCount: Int,
    val fpr: BigDecimal,
)

/**
 * Append-only store over `policy_benchmark_result` (V8 migration). §8.3 resolves its own open
 * question — MVP reads only the latest row per policy, but every run is still stored so a
 * later trend chart needs no migration, just a different query.
 */
@Component
class PolicyBenchmarkResultStore(private val jdbcTemplate: JdbcTemplate) {
    private val rowMapper = RowMapper { rs, _ ->
        PolicyBenchmarkResultRecord(
            id = rs.getObject("id", UUID::class.java),
            policyId = rs.getString("policy_id"),
            ranAt = rs.getTimestamp("ran_at").toInstant(),
            datasetVersion = rs.getString("dataset_version"),
            normalSampleCount = rs.getInt("normal_sample_count"),
            falsePositiveCount = rs.getInt("false_positive_count"),
            fpr = rs.getBigDecimal("fpr"),
        )
    }

    fun insert(draft: PolicyBenchmarkResultDraft): PolicyBenchmarkResultRecord {
        val record = PolicyBenchmarkResultRecord(
            id = UUID.randomUUID(),
            policyId = draft.policyId,
            ranAt = draft.ranAt,
            datasetVersion = draft.datasetVersion,
            normalSampleCount = draft.normalSampleCount,
            falsePositiveCount = draft.falsePositiveCount,
            fpr = draft.fpr,
        )
        jdbcTemplate.update(
            """
            INSERT INTO policy_benchmark_result
                (id, policy_id, ran_at, dataset_version, normal_sample_count, false_positive_count, fpr)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """.trimIndent(),
            record.id,
            record.policyId,
            Timestamp.from(record.ranAt),
            record.datasetVersion,
            record.normalSampleCount,
            record.falsePositiveCount,
            record.fpr,
        )
        return record
    }

    /** Latest run for `policyId`, or `null` when it has never been benchmarked (§6.1: `benchmark: null`). */
    fun latestFor(policyId: String): PolicyBenchmarkResultRecord? =
        jdbcTemplate.query(
            """
            SELECT id, policy_id, ran_at, dataset_version, normal_sample_count, false_positive_count, fpr
            FROM policy_benchmark_result
            WHERE policy_id = ?
            ORDER BY ran_at DESC
            LIMIT 1
            """.trimIndent(),
            rowMapper,
            policyId,
        ).firstOrNull()
}
