package kr.guardmcp.controlplane.api

import kr.guardmcp.controlplane.domain.PolicyFixtures
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.context.TestPropertySource

/**
 * `POST /policies/sync` is the only writer of [kr.guardmcp.controlplane.domain.PolicyStore]'s
 * pack/policy state (`PolicyController.sync`'s own doc) — an unauthenticated caller able to
 * reach it could overwrite the entire registry the console renders. `security.sync-token` must
 * be configured for it to succeed, same contract as `security.reveal-token`
 * ([AuditEventApiTest]'s sibling coverage): unconfigured (blank) always denies.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestPropertySource(properties = ["security.sync-token=test-sync-token"])
class PolicyControllerSyncAuthApiTest : ApiTestSupport() {
    @Test
    fun `sync with no token is forbidden`() {
        val response = send("POST", "/api/v1/policies/sync", PolicyFixtures.syncRequestBody())

        assertEquals(403, response.statusCode())
        assertEquals("sync_unauthorized", parseMap(response.body())["code"])
    }

    @Test
    fun `sync with the wrong token is forbidden`() {
        val response = send(
            "POST", "/api/v1/policies/sync", PolicyFixtures.syncRequestBody(),
            headers = mapOf(SYNC_TOKEN_HEADER to "not-the-configured-token"),
        )

        assertEquals(403, response.statusCode())
        assertEquals("sync_unauthorized", parseMap(response.body())["code"])
    }

    @Test
    fun `sync with the configured token succeeds`() {
        val response = send(
            "POST", "/api/v1/policies/sync", PolicyFixtures.syncRequestBody(),
            headers = mapOf(SYNC_TOKEN_HEADER to "test-sync-token"),
        )

        assertEquals(200, response.statusCode())
        val body = parseMap(response.body())
        assertEquals(PolicyFixtures.policies.size, body["policiesStored"])
    }

    private companion object {
        const val SYNC_TOKEN_HEADER = "X-Sync-Token"
    }
}
