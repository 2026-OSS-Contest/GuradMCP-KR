package kr.guardmcp.controlplane.domain

import java.time.Instant
import java.util.UUID

/**
 * Deterministic bootstrap data. `SESSION_INJECTION_ID` and `SESSION_PII_ID` (and the
 * legacy events/approval below) mirror infra/postgres/001-demo-seed.sql and
 * infra/redis/001-demo-seed.sh so the in-memory stores expose the same demo contract as
 * the seeded containers. `SESSION_BROKEN_CHAIN_ID` and `SESSION_LARGE_ID` are Replay-only
 * (GMCP-28) test fixtures — a tampered hash chain and a 1200-node session — that exist
 * solely to exercise [kr.guardmcp.controlplane.domain.ReplayStore] and are not part of the
 * T-01..T-08 scenario set, so they are intentionally absent from the SQL/Redis seeds.
 */
object DemoSeed {
    val SEEDED_AT: Instant = Instant.parse("2026-01-01T00:00:00Z")

    val SESSION_INJECTION_ID: UUID = UUID.fromString("00000000-0000-4000-8000-000000000001")
    val SESSION_PII_ID: UUID = UUID.fromString("00000000-0000-4000-8000-000000000002")

    /** Replay-only fixture (not in infra seeds): a deliberately tampered hash chain. */
    val SESSION_BROKEN_CHAIN_ID: UUID = UUID.fromString("00000000-0000-4000-8000-000000000003")

    /** Replay-only fixture (not in infra seeds): a 1200-node session for pagination tests. */
    val SESSION_LARGE_ID: UUID = UUID.fromString("00000000-0000-4000-8000-000000000004")

    val EVENT_BLOCKED_READ_ID: UUID = UUID.fromString("10000000-0000-4000-8000-000000000001")
    val EVENT_MASKED_LOOKUP_ID: UUID = UUID.fromString("10000000-0000-4000-8000-000000000002")

    val APPROVAL_PENDING_ID: UUID = UUID.fromString("20000000-0000-4000-8000-000000000001")
    val APPROVAL_PENDING_EXPIRES_AT: Instant = Instant.parse("2099-01-01T00:00:00Z")

    val SERVER_FILE_ID: UUID = UUID.fromString("30000000-0000-4000-8000-000000000001")
    val SERVER_MAIL_ID: UUID = UUID.fromString("30000000-0000-4000-8000-000000000002")
    val SERVER_DB_ID: UUID = UUID.fromString("30000000-0000-4000-8000-000000000003")
}
