package kr.guardmcp.controlplane.domain

import com.fasterxml.jackson.annotation.JsonValue
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.RowMapper
import org.springframework.stereotype.Component
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter
import java.sql.PreparedStatement
import java.sql.Timestamp
import java.time.Clock
import java.time.Instant
import java.util.UUID

/**
 * What the gateway does when its own inspection pipeline errors or times out (NFR-03,
 * GMCP-68 §2.1). `FAIL_CLOSED` is the shipped default; the reverse of §5.7's `FailMode` on the
 * console (`apps/console/lib/api/types.ts`), which this enum's [wire] values match exactly.
 */
enum class FailurePolicy(@get:JsonValue val wire: String) {
    FAIL_CLOSED("fail_closed"),
    FAIL_OPEN("fail_open");

    companion object {
        fun fromWire(value: String): FailurePolicy? = entries.firstOrNull { it.wire == value }
    }
}

data class GuardSettings(
    val id: UUID,
    val failurePolicy: FailurePolicy,
    val riskAcknowledged: Boolean,
    val riskAcknowledgedAt: Instant?,
    val storeRawOptIn: Boolean,
    val locale: String,
    val approvalTimeoutSeconds: Int,
    val updatedBy: String?,
    val updatedAt: Instant,
    val version: Long,
)

/** Wire shape for `GET`/`PUT /api/v1/settings` — matches the console's `GatewaySettings`
 *  (apps/console/lib/api/types.ts) field-for-field, including `failMode` rather than
 *  `failurePolicy`, since the console already shipped against that name (SCR-501, GMCP-88). */
data class SettingsResponse(
    val failMode: String,
    val riskAcknowledged: Boolean,
    val storeRawOptIn: Boolean,
    val locale: String,
    val approvalTimeoutSeconds: Int,
)

fun GuardSettings.toResponse() = SettingsResponse(
    failMode = failurePolicy.wire,
    riskAcknowledged = riskAcknowledged,
    storeRawOptIn = storeRawOptIn,
    locale = locale,
    approvalTimeoutSeconds = approvalTimeoutSeconds,
)

/**
 * Singleton `guard_settings` row (§3.1: "단일 행 보장") plus the push channel that keeps the
 * gateway's local `failurePolicyCache` (packages/gateway/src/settings/failurePolicyCache.ts)
 * aligned with it (§4.3, REQ-06). Follows [ServerRegistryStore]'s `@Component` +
 * `synchronized(lock)` + `SseEmitter` broadcast shape, adapted for a Postgres-backed singleton
 * row rather than an in-memory map — the row itself is the source of truth, so `current()`/
 * `update()` always read/write through to it rather than caching a copy in this JVM.
 */
@Component
class GuardSettingsStore(
    private val jdbcTemplate: JdbcTemplate,
    private val auditLog: AuditLogStore,
    private val clock: Clock,
    transactionManager: PlatformTransactionManager,
) {
    private val lock = Any()
    private val emitters = mutableListOf<SseEmitter>()
    // Programmatic rather than @Transactional: a self-invoked `update()` would bypass Spring's
    // AOP proxy, and declarative @Transactional would commit only *after* this method returns —
    // after `broadcast()` already ran. TransactionTemplate commits when its callback returns, so
    // `broadcast(updated)` below, called after `execute()` returns, is guaranteed to see a
    // change that has actually landed (§3.3: never tell the gateway about a write that rolled back).
    private val transactionTemplate = TransactionTemplate(transactionManager)

    fun current(): GuardSettings = synchronized(lock) { fetch() }

    /**
     * Applies only the fields the caller actually sent (`null` = unchanged), matching the
     * console's "each control sends only what it changed" contract
     * (apps/console/lib/api/client.ts `updateSettings`). The acknowledgement precondition for
     * `fail_open` (REQ-08) is enforced by the caller ([kr.guardmcp.controlplane.api.SettingsController])
     * before this is reached; this only records the resulting state and, on a genuine
     * `failurePolicy` change, the audit trail (§3.3, REQ-09: no audit/acknowledgement bookkeeping
     * on any other field).
     */
    fun update(
        failurePolicy: FailurePolicy?,
        riskAcknowledged: Boolean?,
        storeRawOptIn: Boolean?,
        locale: String?,
        approvalTimeoutSeconds: Int?,
        actor: String,
        requestIp: String?,
    ): GuardSettings {
        val updated = synchronized(lock) {
            transactionTemplate.execute {
                doUpdate(failurePolicy, riskAcknowledged, storeRawOptIn, locale, approvalTimeoutSeconds, actor, requestIp)
            }
        }
        // Push outside the lock, same reasoning as ServerRegistryStore.changeTrust: broadcasting
        // must never block the write that triggered it, nor stall on a slow subscriber. Also
        // outside the transaction (see the transactionTemplate comment above): only a committed
        // change is ever pushed.
        broadcast(updated)
        return updated
    }

    /** Runs inside [transactionTemplate]: `persist` and `auditLog.record` commit atomically. */
    private fun doUpdate(
        failurePolicy: FailurePolicy?,
        riskAcknowledged: Boolean?,
        storeRawOptIn: Boolean?,
        locale: String?,
        approvalTimeoutSeconds: Int?,
        actor: String,
        requestIp: String?,
    ): GuardSettings {
        val before = fetch()
        val now = clock.instant()
        val next = before.copy(
            failurePolicy = failurePolicy ?: before.failurePolicy,
            // REQ-09: reverting to fail_closed clears the acknowledgement — the *next* time
            // fail_open is chosen, it has to be re-confirmed, not grandfathered in.
            riskAcknowledged = when (failurePolicy) {
                FailurePolicy.FAIL_OPEN -> true
                FailurePolicy.FAIL_CLOSED -> false
                null -> riskAcknowledged ?: before.riskAcknowledged
            },
            riskAcknowledgedAt = when (failurePolicy) {
                FailurePolicy.FAIL_OPEN -> now
                FailurePolicy.FAIL_CLOSED -> null
                null -> before.riskAcknowledgedAt
            },
            storeRawOptIn = storeRawOptIn ?: before.storeRawOptIn,
            locale = locale ?: before.locale,
            approvalTimeoutSeconds = approvalTimeoutSeconds ?: before.approvalTimeoutSeconds,
            updatedBy = actor,
            updatedAt = now,
            version = before.version + 1,
        )
        persist(next)
        if (failurePolicy != null && failurePolicy != before.failurePolicy) {
            auditLog.record(
                action = "SETTINGS_FAILURE_POLICY_CHANGED",
                actor = actor,
                before = mapOf("failurePolicy" to before.failurePolicy.wire),
                after = mapOf("failurePolicy" to next.failurePolicy.wire, "riskAcknowledged" to next.riskAcknowledged),
                // §3.3: fail_open activation stands out from routine config edits.
                severity = if (next.failurePolicy == FailurePolicy.FAIL_OPEN) "high" else "info",
                requestIp = requestIp,
            )
        }
        // NFR-04: only the transition *into* raw-payload storage is audited, matching
        // ServerRegistryStore.changeTrust only auditing an upgrade, not every write.
        if (!before.storeRawOptIn && next.storeRawOptIn) {
            auditLog.record(
                action = "SETTINGS_RAW_PAYLOAD_OPT_IN_CHANGED",
                actor = actor,
                before = mapOf("storeRawOptIn" to false),
                after = mapOf("storeRawOptIn" to true),
                severity = "high",
                requestIp = requestIp,
            )
        }
        return next
    }

    /** Hot-reload push channel for the gateway's cache (§4.3, mirrors ServerRegistryStore.subscribe). */
    fun subscribe(emitter: SseEmitter) {
        val snapshot = synchronized(lock) {
            emitters += emitter
            fetch()
        }
        emitter.onCompletion { synchronized(lock) { emitters -= emitter } }
        emitter.onTimeout { emitter.complete(); synchronized(lock) { emitters -= emitter } }
        emitter.onError { synchronized(lock) { emitters -= emitter } }
        sendSnapshot(emitter, snapshot)
    }

    private fun broadcast(settings: GuardSettings) {
        val targets = synchronized(lock) { emitters.toList() }
        for (emitter in targets) sendSnapshot(emitter, settings)
    }

    private fun sendSnapshot(emitter: SseEmitter, settings: GuardSettings) {
        try {
            emitter.send(
                SseEmitter.event().name("settings.changed")
                    .data(mapOf("failMode" to settings.failurePolicy.wire, "version" to settings.version)),
            )
        } catch (exception: Exception) {
            synchronized(lock) { emitters -= emitter }
            emitter.completeWithError(exception)
        }
    }

    private fun fetch(): GuardSettings = jdbcTemplate.query(SELECT_SQL, rowMapper).first()

    private fun persist(settings: GuardSettings) {
        jdbcTemplate.update({ connection ->
            val statement: PreparedStatement = connection.prepareStatement(UPDATE_SQL)
            statement.setString(1, settings.failurePolicy.wire)
            statement.setBoolean(2, settings.riskAcknowledged)
            statement.setTimestamp(3, settings.riskAcknowledgedAt?.let(Timestamp::from))
            statement.setBoolean(4, settings.storeRawOptIn)
            statement.setString(5, settings.locale)
            statement.setInt(6, settings.approvalTimeoutSeconds)
            statement.setString(7, settings.updatedBy)
            statement.setTimestamp(8, Timestamp.from(settings.updatedAt))
            statement.setLong(9, settings.version)
            statement.setObject(10, settings.id)
            statement
        })
    }

    private val rowMapper = RowMapper { rs, _ ->
        GuardSettings(
            id = rs.getObject("id", UUID::class.java),
            failurePolicy = FailurePolicy.fromWire(rs.getString("failure_policy")) ?: FailurePolicy.FAIL_CLOSED,
            riskAcknowledged = rs.getBoolean("risk_acknowledged"),
            riskAcknowledgedAt = rs.getTimestamp("risk_acknowledged_at")?.toInstant(),
            storeRawOptIn = rs.getBoolean("store_raw_opt_in"),
            locale = rs.getString("locale"),
            approvalTimeoutSeconds = rs.getInt("approval_timeout_seconds"),
            updatedBy = rs.getString("updated_by"),
            updatedAt = rs.getTimestamp("updated_at").toInstant(),
            version = rs.getLong("version"),
        )
    }

    companion object {
        private const val SELECT_SQL = """
            SELECT id, failure_policy, risk_acknowledged, risk_acknowledged_at, store_raw_opt_in,
                   locale, approval_timeout_seconds, updated_by, updated_at, version
            FROM guard_settings
            LIMIT 1
        """

        private const val UPDATE_SQL = """
            UPDATE guard_settings
            SET failure_policy = ?, risk_acknowledged = ?, risk_acknowledged_at = ?,
                store_raw_opt_in = ?, locale = ?, approval_timeout_seconds = ?,
                updated_by = ?, updated_at = ?, version = ?
            WHERE id = ?
        """
    }
}
