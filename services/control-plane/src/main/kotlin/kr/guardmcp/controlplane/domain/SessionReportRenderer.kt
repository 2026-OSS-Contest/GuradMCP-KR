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
        val chainLine = "${chain.status.wire}" + (chain.brokenAt?.let { " (broken at $it)" } ?: "")
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
</style>
</head>
<body>
<h1>${esc("Session ${session.id}")}</h1>
<p>${esc("Agent: ${session.agentLabel} · Started: ${session.startedAt} · $statusLine")}</p>
<p>${esc("Chain status: $chainLine")}</p>
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
