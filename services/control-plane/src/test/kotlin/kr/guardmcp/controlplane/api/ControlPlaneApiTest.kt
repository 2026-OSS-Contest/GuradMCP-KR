package kr.guardmcp.controlplane.api

import kr.guardmcp.controlplane.domain.DemoSeed
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.boot.test.context.SpringBootTest
import java.time.Instant
import java.util.UUID

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ControlPlaneApiTest : ApiTestSupport() {
    @Test
    fun `overview exposes the protection summary contract`() {
        val response = get("/api/v1/overview")

        assertEquals(200, response.statusCode())
        val body = parseMap(response.body())
        assertEquals(true, body["protected"])
        assertEquals(listOf("default", "korean-pii"), body["activePolicyPacks"])
        assertEquals(1, body["gatewayCount"])
        assertNotNull(body["blockedToday"])
        assertNotNull(body["maskedToday"])
        assertNotNull(body["pendingApprovals"])
        assertNotNull(body["generatedAt"])
    }

    @Test
    fun `seeded session timeline includes all 5 node types in order, verdict-only detail`() {
        val response = get("/api/v1/sessions/${DemoSeed.SESSION_INJECTION_ID}/timeline")

        assertEquals(200, response.statusCode())
        val body = parseMap(response.body())
        assertEquals("claude-code-cli", body["agentLabel"])
        assertEquals(true, body["isLive"])
        assertEquals("valid", body["chainStatus"])
        assertNull(body["brokenAt"])

        val nodes = (body["nodes"] as List<*>).map { it as Map<*, *> }
        assertEquals(listOf("USER_INPUT", "AGENT_STEP", "TOOL_CALL", "VERDICT", "RESULT"), nodes.map { it["type"] })

        val timestamps = nodes.map { Instant.parse(it["ts"] as String) }
        assertEquals(timestamps.sorted(), timestamps)
        // First two nodes share a `ts`; the tie-break must fall back to ascending eventId.
        assertEquals(timestamps[0], timestamps[1])
        assertTrue((nodes[0]["eventId"] as String) < (nodes[1]["eventId"] as String))

        nodes.forEachIndexed { index, node ->
            if (index == 3) {
                val detail = node["detail"] as Map<*, *>
                assertEquals(listOf("pol-env-read-block"), detail["matchedPolicyIds"])
                assertEquals("block", node["verdict"])
                assertEquals(92, node["riskScore"])
                val detections = detail["detections"] as List<*>
                assertEquals(2, detections.size)
                assertTrue(response.body().contains("AKIA****************"))
                assertNotNull(detail["hash"])
                assertNotNull(detail["prevHash"])
            } else {
                assertTrue(node.containsKey("detail"), "node $index must emit an explicit detail key")
                assertNull(node["detail"])
            }
        }
    }

    @Test
    fun `no raw secret material leaks into the timeline response`() {
        val response = get("/api/v1/sessions/${DemoSeed.SESSION_INJECTION_ID}/timeline")

        assertFalse(response.body().contains("AKIAIOSFODNN7EXAMPLE"))
        assertTrue(response.body().contains("AKIA****************"))
    }

    @Test
    fun `unknown session timeline returns the standardized 404 error`() {
        val response = get("/api/v1/sessions/${UUID.randomUUID()}/timeline")

        assertEquals(404, response.statusCode())
        assertEquals("session_not_found", parseMap(response.body())["code"])
    }

    @Test
    fun `deep-link event anchoring includes the target node, unknown eventId is a 400`() {
        val timeline = parseMap(get("/api/v1/sessions/${DemoSeed.SESSION_INJECTION_ID}/timeline").body())
        val nodes = (timeline["nodes"] as List<*>).map { it as Map<*, *> }
        val verdictEventId = nodes.single { it["type"] == "VERDICT" }["eventId"] as String

        val anchored = get("/api/v1/sessions/${DemoSeed.SESSION_INJECTION_ID}/timeline?event=$verdictEventId")
        assertEquals(200, anchored.statusCode())
        val anchoredNodes = (parseMap(anchored.body())["nodes"] as List<*>).map { it as Map<*, *> }
        assertTrue(anchoredNodes.any { it["eventId"] == verdictEventId })

        val missing = get("/api/v1/sessions/${DemoSeed.SESSION_INJECTION_ID}/timeline?event=${UUID.randomUUID()}")
        assertEquals(400, missing.statusCode())

        val direct = get("/api/v1/events/$verdictEventId")
        assertEquals(200, direct.statusCode())
        val directBody = parseMap(direct.body())
        assertEquals(DemoSeed.SESSION_INJECTION_ID.toString(), directBody["sessionId"])
        assertEquals("VERDICT", directBody["type"])
        assertEquals("block", directBody["verdict"])
        assertEquals(92, directBody["riskScore"])
        assertNotNull(directBody["detail"])

        val unknownEvent = get("/api/v1/events/${UUID.randomUUID()}")
        assertEquals(404, unknownEvent.statusCode())
        assertEquals("event_not_found", parseMap(unknownEvent.body())["code"])

        val userInputEventId = nodes.single { it["type"] == "USER_INPUT" }["eventId"] as String
        val nonVerdictLookup = parseMap(get("/api/v1/events/$userInputEventId").body())
        assertTrue(nonVerdictLookup.containsKey("detail"), "non-VERDICT lookup must still emit an explicit detail key")
        assertNull(nonVerdictLookup["detail"])
    }

    @Test
    fun `deep-link anchoring on a large session windows around the anchor and paginates the rest`() {
        val fullFirstPage = parseMap(get("/api/v1/sessions/${DemoSeed.SESSION_LARGE_ID}/timeline?limit=1000").body())
        val midEventId = ((fullFirstPage["nodes"] as List<*>)[500] as Map<*, *>)["eventId"] as String

        val anchored = parseMap(get("/api/v1/sessions/${DemoSeed.SESSION_LARGE_ID}/timeline?event=$midEventId").body())
        val anchoredNodes = (anchored["nodes"] as List<*>).map { it as Map<*, *> }
        assertTrue(anchoredNodes.any { it["eventId"] == midEventId })
        // Anchor at index 500 of 1200, ±50 radius, inclusive of the anchor: exactly 101 nodes.
        assertEquals(101, anchoredNodes.size)
        val nextCursor = anchored["nextCursor"] as String

        // Following the cursor while `event` is still in the URL must page forward, not repeat the window.
        val next = parseMap(
            get("/api/v1/sessions/${DemoSeed.SESSION_LARGE_ID}/timeline?event=$midEventId&cursor=$nextCursor").body(),
        )
        val nextNodes = (next["nodes"] as List<*>).map { it as Map<*, *> }
        assertTrue(nextNodes.isNotEmpty())
        assertTrue(anchoredNodes.none { a -> nextNodes.any { it["eventId"] == a["eventId"] } }, "paged-forward nodes must not repeat the window")
    }

    @Test
    fun `sessions list is sorted by startedAt descending and supports status and q filters`() {
        // Sibling test classes in this suite (AuditEventApiTest, ReplayLiveEventsApiTest) share
        // this Postgres container and ingest their own live sessions with `startedAt: now()`,
        // which always sort ahead of the seeded fixtures' fixed 2026-01-01 timestamp. The default
        // `limit=20` page can fill up entirely with that live-session churn before ever reaching
        // a seeded row, so every lookup below asks for the full `MAX_SESSION_LIMIT` page instead
        // of relying on the unpaged default.
        val all = parseMap(get("/api/v1/sessions?limit=100").body())
        val items = (all["items"] as List<*>).map { it as Map<*, *> }
        val startedAts = items.map { Instant.parse(it["startedAt"] as String) }
        assertEquals(startedAts.sortedDescending(), startedAts)
        // `total` is the match count, not the page size — distinct once a `size`/`limit` narrower
        // than the full result set is introduced (GMCP-80 §3.2).
        assertEquals(items.size, all["total"])

        val live = parseMap(get("/api/v1/sessions?status=live&limit=100").body())
        val liveItems = (live["items"] as List<*>).map { it as Map<*, *> }
        assertTrue(liveItems.isNotEmpty())
        assertTrue(liveItems.all { it["isLive"] == true })

        val closed = parseMap(get("/api/v1/sessions?status=closed&limit=100").body())
        val closedItems = (closed["items"] as List<*>).map { it as Map<*, *> }
        assertTrue(closedItems.isNotEmpty())
        assertTrue(closedItems.all { it["isLive"] == false })

        val byTool = parseMap(get("/api/v1/sessions?q=read_file&limit=100").body())
        val toolIds = (byTool["items"] as List<*>).map { (it as Map<*, *>)["sessionId"] }
        // Sessions projected from ingested audit events match this search too (GMCP-114), so the
        // assertion is that the seeded read_file session is found and an unrelated seeded session
        // is not — rather than that the seeds are the only thing in the store.
        assertTrue(toolIds.contains(DemoSeed.SESSION_INJECTION_ID.toString()))
        assertTrue(!toolIds.contains(DemoSeed.SESSION_PII_ID.toString()))

        val invalidStatus = get("/api/v1/sessions?status=bogus")
        assertEquals(400, invalidStatus.statusCode())

        val firstPage = parseMap(get("/api/v1/sessions?limit=1").body())
        assertEquals(1, (firstPage["items"] as List<*>).size)
        assertEquals(all["total"], firstPage["total"])

        val injectionSession = items.single { it["sessionId"] == DemoSeed.SESSION_INJECTION_ID.toString() }
        val verdictSummary = injectionSession["verdictSummary"] as Map<*, *>
        assertEquals(setOf("allow", "warn", "require_approval", "block"), verdictSummary.keys)
        assertEquals(1, verdictSummary["block"])
    }

    @Test
    fun `a tampered hash chain is reported as broken with the first offending eventId`() {
        val response = get("/api/v1/sessions/${DemoSeed.SESSION_BROKEN_CHAIN_ID}/timeline")

        assertEquals(200, response.statusCode())
        val body = parseMap(response.body())
        assertEquals("broken", body["chainStatus"])
        val brokenAt = body["brokenAt"] as String

        val nodes = (body["nodes"] as List<*>).map { it as Map<*, *> }
        val brokenNode = nodes.single { it["eventId"] == brokenAt }
        assertEquals("require_approval", brokenNode["verdict"])
    }

    @Test
    fun `large session pagination round-trips without gaps, overlap or duplicates`() {
        val firstPage = parseMap(get("/api/v1/sessions/${DemoSeed.SESSION_LARGE_ID}/timeline?limit=1000").body())
        val firstNodes = (firstPage["nodes"] as List<*>).map { it as Map<*, *> }
        assertEquals(1000, firstNodes.size)
        val nextCursor = firstPage["nextCursor"] as String

        val secondPage = parseMap(get("/api/v1/sessions/${DemoSeed.SESSION_LARGE_ID}/timeline?limit=1000&cursor=$nextCursor").body())
        val secondNodes = (secondPage["nodes"] as List<*>).map { it as Map<*, *> }
        assertEquals(200, secondNodes.size)
        assertNull(secondPage["nextCursor"])

        val allIds = (firstNodes + secondNodes).map { it["eventId"] }
        assertEquals(1200, allIds.size)
        assertEquals(allIds.toSet().size, allIds.size)

        val allTimestamps = (firstNodes + secondNodes).map { Instant.parse(it["ts"] as String) }
        assertEquals(allTimestamps.sorted(), allTimestamps)
    }

    @Test
    fun `html export contains only the masked form, never the raw secret`() {
        val response = send("POST", "/api/v1/sessions/${DemoSeed.SESSION_INJECTION_ID}/export", mapOf("format" to "html", "theme" to "light"))

        assertEquals(200, response.statusCode())
        assertTrue(response.headers().firstValue("Content-Type").orElse("").startsWith("text/html"))
        assertTrue(response.headers().firstValue("Content-Disposition").orElse("").contains("attachment"))
        assertFalse(response.body().contains("AKIAIOSFODNN7EXAMPLE"))
        assertTrue(response.body().contains("AKIA****************"))
    }

    @Test
    fun `pdf export produces a real PDF document`() {
        val response = send("POST", "/api/v1/sessions/${DemoSeed.SESSION_INJECTION_ID}/export", mapOf("format" to "pdf", "theme" to "light"))

        assertEquals(200, response.statusCode())
        assertTrue(response.headers().firstValue("Content-Type").orElse("").startsWith("application/pdf"))
        assertTrue(response.body().startsWith("%PDF-"))
    }

    @Test
    fun `export defaults to html when no body is sent`() {
        val response = send("POST", "/api/v1/sessions/${DemoSeed.SESSION_INJECTION_ID}/export", null)

        assertEquals(200, response.statusCode())
        assertTrue(response.headers().firstValue("Content-Type").orElse("").startsWith("text/html"))
    }

    @Test
    fun `export rejects an unknown format, a non-light theme, and an unknown session`() {
        val badFormat = send("POST", "/api/v1/sessions/${DemoSeed.SESSION_INJECTION_ID}/export", mapOf("format" to "docx", "theme" to "light"))
        assertEquals(400, badFormat.statusCode())
        assertEquals("invalid_format", parseMap(badFormat.body())["code"])

        val badTheme = send("POST", "/api/v1/sessions/${DemoSeed.SESSION_INJECTION_ID}/export", mapOf("format" to "html", "theme" to "dark"))
        assertEquals(400, badTheme.statusCode())
        assertEquals("invalid_theme", parseMap(badTheme.body())["code"])

        val unknownSession = send("POST", "/api/v1/sessions/${UUID.randomUUID()}/export", null)
        assertEquals(404, unknownSession.statusCode())
        assertEquals("session_not_found", parseMap(unknownSession.body())["code"])
    }

    @Test
    fun `policies and policy packs expose the seeded catalog`() {
        val policies = get("/api/v1/policies")
        val packs = get("/api/v1/policy-packs")

        assertEquals(200, policies.statusCode())
        assertEquals(3, parseList(policies.body()).size)
        assertEquals(200, packs.statusCode())
        assertEquals(2, parseList(packs.body()).size)
    }

    @Test
    fun `policy stats for a never-triggered policy is a zero count, not a 404`() {
        val response = get("/api/v1/policies/mask_korean_phone/stats")

        assertEquals(200, response.statusCode())
        val body = parseMap(response.body())
        assertEquals("mask_korean_phone", body["policyId"])
        assertEquals(0, body["firedLast30d"])
        assertNull(body["lastTriggeredAt"])
    }

    @Test
    fun `policy stats counts guard_event rows whose matched_policy_ids contains the id`() {
        val eventId = UUID.randomUUID()
        val ts = Instant.parse("2026-05-01T00:00:00Z")
        send(
            "POST", "/api/v1/events",
            mapOf(
                "eventId" to eventId.toString(),
                "sessionId" to UUID.randomUUID().toString(),
                "ts" to ts.toString(),
                "direction" to "response",
                "toolName" to "read_file",
                "argsDigest" to "sha256:abc123",
                "verdict" to "block",
                "riskScore" to 90,
                "matchedPolicyIds" to listOf("approve_external_email"),
                "detections" to emptyList<Any>(),
            ),
        )

        val response = get("/api/v1/policies/approve_external_email/stats?window=3650d")

        assertEquals(200, response.statusCode())
        val body = parseMap(response.body())
        assertEquals(1, body["firedLast30d"])
        assertEquals(ts.toString(), body["lastTriggeredAt"])
    }

    @Test
    fun `policy stats rejects an unknown policy id and a malformed window`() {
        val unknown = get("/api/v1/policies/does-not-exist/stats")
        assertEquals(404, unknown.statusCode())
        assertEquals("policy_not_found", parseMap(unknown.body())["code"])

        val badWindow = get("/api/v1/policies/mask_korean_phone/stats?window=bogus")
        assertEquals(400, badWindow.statusCode())
        assertEquals("invalid_window", parseMap(badWindow.body())["code"])
    }

    @Test
    fun `policy pack toggle round-trips and bumps the version`() {
        val disabled = send("PUT", "/api/v1/policy-packs/korean-pii", mapOf("enabled" to false))
        assertEquals(200, disabled.statusCode())
        assertEquals(false, parseMap(disabled.body())["enabled"])

        val overview = parseMap(get("/api/v1/overview").body())
        assertEquals(listOf("default"), overview["activePolicyPacks"])

        val enabled = send("PUT", "/api/v1/policy-packs/korean-pii", mapOf("enabled" to true))
        val enabledBody = parseMap(enabled.body())
        assertEquals(true, enabledBody["enabled"])
        assertTrue(enabledBody["version"] as Int >= 3)
    }

    @Test
    fun `approval lifecycle creates a card then rejects a duplicate decision`() {
        val created = send(
            "POST",
            "/api/v1/approvals",
            mapOf(
                "sessionId" to DemoSeed.SESSION_PII_ID.toString(),
                "toolName" to "send_email",
                "arguments" to mapOf("to" to "partner@external.example"),
                "riskReason" to "External email delivery requires human approval",
                "policyId" to "approve_external_email",
            ),
        )
        assertEquals(201, created.statusCode())
        val card = parseMap(created.body())
        assertEquals("pending", card["status"])
        assertEquals("send_email", card["toolName"])
        assertEquals("approve_external_email", card["policyId"])
        val id = card["id"] as String

        val decided = send("POST", "/api/v1/approvals/$id/decision", mapOf("decision" to "approve", "decidedBy" to "reviewer"))
        assertEquals(200, decided.statusCode())
        assertEquals("approved", parseMap(decided.body())["status"])

        val duplicate = send("POST", "/api/v1/approvals/$id/decision", mapOf("decision" to "block"))
        assertEquals(409, duplicate.statusCode())
        assertEquals("approval_already_decided", parseMap(duplicate.body())["code"])
    }

    @Test
    fun `detect preview masks the korean phone and blocks the env read`() {
        val response = send(
            "POST",
            "/api/v1/detect/preview",
            mapOf("text" to "고객 010-1234-5678 명단을 /workspace/.env 와 함께 보내줘"),
        )

        assertEquals(200, response.statusCode())
        val body = parseMap(response.body())
        assertEquals("block", body["verdict"])
        assertTrue((body["maskedText"] as String).contains("010-****-5678"))
        val policyIds = (body["findings"] as List<*>).map { (it as Map<*, *>)["policyId"] }
        assertTrue(policyIds.containsAll(listOf("block_env_file_read", "mask_korean_phone")))
    }

    @Test
    fun `server list exposes the lean summary the console inventory and gateway registry consume`() {
        val response = get("/api/v1/servers")

        assertEquals(200, response.statusCode())
        val servers = parseMap(response.body())["servers"] as List<*>
        assertEquals(3, servers.size)
        val fileServer = servers.map { it as Map<*, *> }.single { it["id"] == DemoSeed.SERVER_FILE_ID.toString() }
        assertEquals("file-server", fileServer["name"])
        assertEquals(true, fileServer["connected"])
        assertEquals("limited", fileServer["trust"])
        assertNotNull(fileServer["endpoint"])
        // apps/console/lib/api/types.ts's `ToolEntry`: name/risk/policies/snapshotStatus
        // (GMCP-80 §3.1). file-server's read_file tool is high-risk and gated by a policy.
        // No test in this suite ever approves or observes a snapshot for file-server's real
        // "read_file" tool name (ToolSnapshotApiTest uses its own per-test tool names on
        // SERVER_DB_ID to avoid exactly this kind of shared-state collision, per its header
        // comment), so this tool's snapshotStatus is deterministically "unapproved" — the
        // FR-GW-03 drift states themselves (in_sync/drift_detected/drift_acknowledged) are
        // covered end to end by ToolSnapshotApiTest, including via this same GET /servers
        // endpoint.
        val fileTools = fileServer["tools"] as List<*>
        val readFile = fileTools.map { it as Map<*, *> }.single { it["name"] == "read_file" }
        assertEquals("high", readFile["risk"])
        assertEquals(listOf("block_env_file_read"), readFile["policies"])
        assertEquals("unapproved", (readFile["snapshotStatus"] as Map<*, *>)["state"])
    }

    @Test
    fun `an empty server registry would serialize to an empty array, not a missing field`() {
        val body = objectMapper.writeValueAsString(ServersResponse(emptyList()))
        assertEquals("""{"servers":[]}""", body)
    }

    @Test
    fun `server detail exposes the full entity including endpoint and provenance`() {
        // file-server is never mutated by another test (only ever round-tripped back to its
        // seeded grade), so its starting fields are safe to assert regardless of test order.
        val response = get("/api/v1/servers/${DemoSeed.SERVER_FILE_ID}")

        assertEquals(200, response.statusCode())
        val body = parseMap(response.body())
        assertEquals("file-server", body["name"])
        assertEquals("limited", body["trustLevel"])
        assertEquals("connected", body["connectionStatus"])
        assertNotNull(body["endpoint"])
    }

    @Test
    fun `unknown server id returns the standardized 404 error`() {
        val response = get("/api/v1/servers/${UUID.randomUUID()}")

        assertEquals(404, response.statusCode())
        assertEquals("server_not_found", parseMap(response.body())["code"])
    }

    // The Spring context (and its in-memory stores) is shared across every @Test in this class,
    // same as the existing policy-pack/approval tests. Each server-trust test below claims one
    // seeded server exclusively (mail-server, db-server) so mutations in one test cannot leak
    // into another test's assumptions about that server's starting grade, regardless of JUnit's
    // execution order. file-server is only ever touched by no-op writes, so read-only tests can
    // rely on its seeded "limited" grade unconditionally.

    @Test
    fun `downgrading a server trust level applies immediately without confirmation`() {
        val response = send("PUT", "/api/v1/servers/${DemoSeed.SERVER_MAIL_ID}/trust", mapOf("trustLevel" to "untrusted", "confirmed" to false))

        assertEquals(200, response.statusCode())
        assertEquals("untrusted", parseMap(response.body())["trust"])

        val events = parseList(get("/api/v1/servers/trust-events").body())
        val recorded = events.last()
        assertEquals(DemoSeed.SERVER_MAIL_ID.toString(), recorded["serverId"])
        assertEquals("downgrade", recorded["direction"])
        assertNotNull(recorded["hash"])
        assertNotNull(recorded["prevHash"])
    }

    @Test
    fun `an unconfirmed upgrade is rejected with an impact summary, and confirming it then applies`() {
        val rejected = send("PUT", "/api/v1/servers/${DemoSeed.SERVER_DB_ID}/trust", mapOf("trustLevel" to "trusted", "confirmed" to false))

        assertEquals(409, rejected.statusCode())
        val rejectedBody = parseMap(rejected.body())
        assertEquals("upgrade_requires_confirmation", rejectedBody["code"])
        @Suppress("UNCHECKED_CAST")
        val details = rejectedBody["details"] as Map<String, Any?>
        assertEquals("untrusted", details["fromTrust"])
        assertEquals("trusted", details["toTrust"])
        assertNotNull(details["affectedPolicyCount"])
        assertEquals("untrusted", parseMap(get("/api/v1/servers/${DemoSeed.SERVER_DB_ID}").body())["trustLevel"])

        val confirmed = send("PUT", "/api/v1/servers/${DemoSeed.SERVER_DB_ID}/trust", mapOf("trustLevel" to "trusted", "confirmed" to true))

        assertEquals(200, confirmed.statusCode())
        assertEquals("trusted", parseMap(confirmed.body())["trust"])
        val detail = parseMap(get("/api/v1/servers/${DemoSeed.SERVER_DB_ID}").body())
        assertEquals("console", detail["trustLevelUpdatedBy"])

        val events = parseList(get("/api/v1/servers/trust-events").body())
        val recorded = events.last()
        assertEquals("upgrade", recorded["direction"])
        assertEquals("console", recorded["confirmedBy"])
    }

    @Test
    fun `requesting the current trust level is a no-op`() {
        val response = send("PUT", "/api/v1/servers/${DemoSeed.SERVER_FILE_ID}/trust", mapOf("trustLevel" to "limited", "confirmed" to false))

        assertEquals(200, response.statusCode())
        assertEquals("limited", parseMap(response.body())["trust"])
    }

    @Test
    fun `the registry stream pushes a snapshot on connect and again on every trust change`() {
        openStream("/api/v1/servers/stream").use { stream ->
            val initial = nextEventData(stream.reader)
            assertTrue(initial.contains(DemoSeed.SERVER_FILE_ID.toString()))

            // A downgrade always applies regardless of the file server's current grade in other
            // tests, and is restored below so later tests still see the seeded "limited" grade.
            send("PUT", "/api/v1/servers/${DemoSeed.SERVER_FILE_ID}/trust", mapOf("trustLevel" to "untrusted", "confirmed" to false))
            val pushed = nextEventData(stream.reader)
            assertTrue(pushed.contains(DemoSeed.SERVER_FILE_ID.toString()))
            assertTrue(pushed.contains("\"trust\":\"untrusted\""))
        }
        send("PUT", "/api/v1/servers/${DemoSeed.SERVER_FILE_ID}/trust", mapOf("trustLevel" to "limited", "confirmed" to true))
    }

    @Test
    fun `attack lab run accepts known scenarios and rejects unknown ones`() {
        val accepted = send("POST", "/api/v1/attacklab/run/T-01", null)
        assertEquals(202, accepted.statusCode())
        val acceptedBody = parseMap(accepted.body())
        assertEquals("queued", acceptedBody["status"])
        assertEquals("T-01", acceptedBody["scenarioId"])

        val rejected = send("POST", "/api/v1/attacklab/run/T-99", null)
        assertEquals(404, rejected.statusCode())
        assertEquals("scenario_not_found", parseMap(rejected.body())["code"])
    }

    @Test
    fun `attack lab scenarios list all eight threats, not implemented ones as unavailable`() {
        val response = get("/api/v1/attacklab/scenarios")

        assertEquals(200, response.statusCode())
        val scenarios = (parseMap(response.body())["scenarios"] as List<*>).map { it as Map<*, *> }
        assertEquals((1..8).map { "T-%02d".format(it) }.toSet(), scenarios.map { it["id"] }.toSet())

        val t06 = scenarios.single { it["id"] == "T-06" }
        assertEquals(false, t06["available"])
        assertEquals(emptyList<Any>(), t06["modes"])

        val t01 = scenarios.single { it["id"] == "T-01" }
        assertEquals(true, t01["available"])
        assertEquals(listOf("vulnerable", "guarded"), t01["modes"])
        assertNotNull(t01["title"])
        assertNotNull(t01["description"])
    }
}
