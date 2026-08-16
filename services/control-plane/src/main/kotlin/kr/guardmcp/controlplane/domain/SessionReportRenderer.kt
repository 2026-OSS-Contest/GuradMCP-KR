package kr.guardmcp.controlplane.domain

import com.openhtmltopdf.pdfboxout.PdfRendererBuilder
import org.springframework.stereotype.Component
import java.io.ByteArrayOutputStream

/**
 * `POST /sessions/{id}/export` (GMCP-80 §3.7): a light-theme HTML report of one session's
 * timeline, verdict rationale and chain status, straight from [ReplayTimelines]'s existing model —
 * the same data `GET /sessions/{id}/timeline` already serves. Nothing here reads
 * [GuardEventRecord.rawPayload]; [Detection.maskedAs] is the only per-finding text this renders,
 * so the report never carries more than the timeline API already exposes (NFR-04).
 */
@Component
class SessionReportRenderer {
    fun renderHtml(session: ReplaySession, nodes: List<TimelineNode>, chain: ChainResult): String {
        val rows = nodes.joinToString("\n") { renderRow(it) }
        val statusLine = if (session.isLive) "Live" else "Ended: ${session.endedAt}"
        return """<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8" />
<title>${esc("Session Report - ${session.id}")}</title>
<style>
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; background: #ffffff; color: #111111; margin: 2em; }
  h1 { font-size: 1.4em; }
  table { width: 100%; border-collapse: collapse; margin-top: 1em; }
  th, td { border: 1px solid #dddddd; padding: 6px 8px; text-align: left; vertical-align: top; font-size: 0.85em; }
  th { background: #f5f5f5; }
  .verdict-block { color: #b42318; font-weight: bold; }
  .verdict-warn { color: #b54708; font-weight: bold; }
  .verdict-require_approval { color: #6941c6; font-weight: bold; }
  .verdict-allow { color: #067647; }
  .chain-box { border: 1px solid #dddddd; border-radius: 6px; padding: 0.75em 1em; margin: 1em 0; }
  .chain-box h2 { font-size: 1em; margin: 0 0 0.4em; }
  .chain-box p { margin: 0.2em 0; font-size: 0.85em; }
  .chain-valid { border-color: #067647; background: #f2fbf6; }
  .chain-broken { border-color: #b42318; background: #fef3f2; }
  .chain-unknown { border-color: #dddddd; background: #f9fafb; }
  .chain-warning { color: #b42318; font-weight: bold; }
</style>
</head>
<body>
<h1>${esc("Session ${session.id}")}</h1>
<p>${esc("Agent: ${session.agentLabel} · Started: ${session.startedAt} · $statusLine")}</p>
${renderChainSection(chain)}
<table>
<thead><tr><th>Time</th><th>Type</th><th>Summary</th><th>Verdict</th><th>Risk</th><th>Matched policies</th><th>Detections</th></tr></thead>
<tbody>
$rows
</tbody>
</table>
</body>
</html>
"""
    }

    /**
     * GMCP-83 §7: placed at the top (right after the summary, before the timeline table) so a
     * reader knows whether to trust the record before reading it. The report is a snapshot —
     * built from the [ChainResult] the caller already computed for this one export request —
     * so a later tamper to the underlying rows never changes an already-issued report (§7's
     * "이미 발급된 리포트의 값은 바뀌지 않는" requirement).
     */
    private fun renderChainSection(chain: ChainResult): String {
        val cssClass = when (chain.status) {
            ChainStatus.VALID -> "chain-valid"
            ChainStatus.BROKEN -> "chain-broken"
            ChainStatus.UNKNOWN -> "chain-unknown"
        }
        val statusLabel = when (chain.status) {
            ChainStatus.VALID -> "체인 검증됨 ✓"
            ChainStatus.BROKEN -> "체인 검증 실패 ⚠"
            ChainStatus.UNKNOWN -> "체인 검증 불가 (대상 없음)"
        }
        val mismatchLine = chain.mismatchEventIds.takeIf { it.isNotEmpty() }?.let {
            "<p>${esc("불일치 이벤트: ${it.joinToString(", ")}")}</p>"
        }.orEmpty()
        val warningLine = if (chain.status == ChainStatus.BROKEN) {
            "<p class=\"chain-warning\">${esc("※ 이 세션의 감사 기록은 무결성이 보장되지 않습니다. 원본 데이터베이스에서 직접 확인이 필요합니다.")}</p>"
        } else {
            ""
        }
        return """<div class="chain-box $cssClass">
<h2>감사 체인 무결성</h2>
<p>${esc("상태: $statusLabel")}</p>
<p>${esc("검증 시각: ${chain.verifiedAt}")}</p>
<p>${esc("검증된 이벤트: ${chain.verifiedCount} / ${chain.totalCount}")}</p>
$mismatchLine$warningLine
</div>"""
    }

    fun renderPdf(html: String): ByteArray {
        val output = ByteArrayOutputStream()
        val builder = PdfRendererBuilder()
        builder.useFastMode()
        builder.withHtmlContent(html, null)
        builder.toStream(output)
        builder.run()
        return output.toByteArray()
    }

    private fun renderRow(node: TimelineNode): String {
        val verdictCell = node.verdict?.let { "<span class=\"verdict-${it.wire}\">${esc(it.wire)}</span>" } ?: ""
        val policies = node.detail?.matchedPolicyIds?.joinToString(", ").orEmpty()
        val detections = node.detail?.detections
            ?.joinToString("; ") { "${it.type}.${it.subtype} (${it.maskedAs})" }
            .orEmpty()
        return "<tr>" +
            "<td>${esc(node.ts.toString())}</td>" +
            "<td>${esc(node.type.wire)}</td>" +
            "<td>${esc(node.summary)}</td>" +
            "<td>$verdictCell</td>" +
            "<td>${node.riskScore ?: ""}</td>" +
            "<td>${esc(policies)}</td>" +
            "<td>${esc(detections)}</td>" +
            "</tr>"
    }

    private fun esc(text: String): String =
        text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
}
