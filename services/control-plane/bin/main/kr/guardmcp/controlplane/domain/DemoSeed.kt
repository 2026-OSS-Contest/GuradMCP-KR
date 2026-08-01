package kr.guardmcp.controlplane.domain

import java.time.Instant
import java.util.UUID

/**
 * Deterministic bootstrap data. The identifiers and values mirror
 * infra/postgres/001-demo-seed.sql and infra/redis/001-demo-seed.sh so the in-memory
 * stores expose the same demo contract as the seeded containers.
 */
object DemoSeed {
    val SEEDED_AT: Instant = Instant.parse("2026-01-01T00:00:00Z")

    val SESSION_INJECTION_ID: UUID = UUID.fromString("00000000-0000-4000-8000-000000000001")
    val SESSION_PII_ID: UUID = UUID.fromString("00000000-0000-4000-8000-000000000002")

    val EVENT_BLOCKED_READ_ID: UUID = UUID.fromString("10000000-0000-4000-8000-000000000001")
    val EVENT_MASKED_LOOKUP_ID: UUID = UUID.fromString("10000000-0000-4000-8000-000000000002")

    val APPROVAL_PENDING_ID: UUID = UUID.fromString("20000000-0000-4000-8000-000000000001")
    val APPROVAL_PENDING_EXPIRES_AT: Instant = Instant.parse("2099-01-01T00:00:00Z")
}
