package kr.guardmcp.demoagent.support

import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress

/**
 * Minimal stand-in for the demo MCP tool servers' `POST /tools/call/<name>` surface, so
 * the vulnerable path can be exercised without running demo-mcp-tools. It answers with
 * the same shapes the real sandbox returns — synthetic `.env` contents for `read_file`
 * and an outbox acknowledgement for `send_email` — plus a failing tool so the client's
 * transport-error branch is covered.
 *
 * Every value is synthetic: the fake keys mirror the sandbox fixture's shape so the
 * detector has something to recognize, and none of them authenticate anywhere.
 */
class ToolsStub {
    private val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)

    /** Records each tool name the agent called, in order, so tests can assert the chain. */
    val calls: MutableList<String> = mutableListOf()

    val baseUrl: String get() = "http://127.0.0.1:${server.address.port}"

    fun start(): ToolsStub {
        server.createContext("/tools/call/") { exchange ->
            val name = exchange.requestURI.path.substringAfterLast('/')
            calls += name
            exchange.requestBody.readBytes()
            val (status, payload) = when (name) {
                "read_file" -> 200 to ENV_CONTENT
                "send_email" -> 200 to OUTBOX_ACK
                "search_tickets" -> 200 to CONSULTATION_TICKET
                "broken_tool" -> 500 to """{"code":"INTERNAL_ERROR"}"""
                else -> 200 to """{"content":[]}"""
            }
            val body = payload.toByteArray()
            exchange.responseHeaders.add("content-type", "application/json")
            exchange.sendResponseHeaders(status, body.size.toLong())
            exchange.responseBody.use { it.write(body) }
        }
        server.start()
        return this
    }

    fun stop() = server.stop(0)

    private companion object {
        /** Mirrors apps/demo-mcp-tools/sandbox/.env — synthetic, non-routable values. */
        const val ENV_CONTENT =
            """{"content":"OPENAI_API_KEY=sk-DEMO000000000000000000000000000000FAKE\nSMTP_PASSWORD=demo-fake-smtp-secret-not-real"}"""
        const val OUTBOX_ACK = """{"delivered":false,"outbox":"local","message":"recorded to local outbox"}"""

        /**
         * Mirrors the seeded `TCK-2026-9001` consultation log (GMCP-20) as the unguarded
         * path returns it: unmasked. The phone, RRN and account are the same synthetic
         * checksum-shaped values as the seed — no real person or account.
         */
        const val CONSULTATION_TICKET =
            """{"content":[{"ticketId":"TCK-2026-9001","body":"연락처는 010-3456-7890 입니다. 주민등록번호 881124-2300149 확인했고, 환불 계좌번호: 110-234-567890 으로 안내했습니다."}]}"""
    }
}
