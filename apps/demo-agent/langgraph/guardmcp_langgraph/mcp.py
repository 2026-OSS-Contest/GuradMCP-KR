"""MCP JSON-RPC client for the GuardMCP-KR demo (GMCP-95).

The only thing that differs between the guarded and unguarded runs is the URL this
client is constructed with. Nothing above it — not the graph, not the tool plan, not
the summarizer — is told which one it got, which is what makes "swap the endpoint,
change no agent code" a property of the code rather than a claim in a README.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable, Mapping

Transport = Callable[[str, bytes], bytes]


@dataclass(frozen=True)
class ToolResult:
    """One tool call's outcome, in the vocabulary the demo reports."""

    tool: str
    blocked: bool
    verdict: str
    policy_ids: list[str] = field(default_factory=list)
    risk_score: int = 0
    message: str | None = None
    payload: Any = None


def _http_transport(url: str, body: bytes) -> bytes:
    request = urllib.request.Request(
        url, data=body, headers={"content-type": "application/json"}, method="POST"
    )
    # The gateway answers HTTP 200 even for a block — the verdict rides inside the
    # JSON-RPC error — so a non-2xx here means the verdict is unknown, not benign.
    with urllib.request.urlopen(request, timeout=130) as response:  # noqa: S310
        return response.read()


class McpClient:
    """Calls `tools/call` against whatever endpoint it was pointed at."""

    def __init__(self, base_url: str, transport: Transport | None = None) -> None:
        self._base_url = base_url.rstrip("/")
        self._transport = transport or _http_transport

    def call(self, name: str, arguments: Mapping[str, Any], session_id: str) -> ToolResult:
        body = json.dumps(
            {
                "jsonrpc": "2.0",
                "id": session_id,
                "method": "tools/call",
                "params": {"name": name, "arguments": dict(arguments)},
            }
        ).encode("utf-8")
        try:
            raw = self._transport(f"{self._base_url}/mcp", body)
        except urllib.error.HTTPError as error:
            # Fail closed: a gateway that did not answer 2xx has not told us a verdict.
            return ToolResult(
                tool=name, blocked=True, verdict="error",
                message=f"gateway returned HTTP {error.code}",
            )
        except urllib.error.URLError as error:
            # Connection refused, DNS failure and timeout land here rather than above
            # (HTTPError is the subclass, so it is caught first). An outage has to read
            # as blocked for the same reason a 502 does — nothing told us the call was
            # safe — and raising out of the agent would report neither verdict at all.
            return ToolResult(
                tool=name, blocked=True, verdict="error",
                message=f"gateway at {self._base_url} is unreachable: {error.reason}",
            )
        return self._read(name, json.loads(raw))

    @staticmethod
    def _read(name: str, node: Mapping[str, Any]) -> ToolResult:
        error = node.get("error")
        if error:
            # FR-GW-05 §3.1: the standardized block payload is at error.data.guardmcp.
            # A JSON-RPC error means nothing ran upstream, so this is always a block.
            guard = (error.get("data") or {}).get("guardmcp") or {}
            policy_id = guard.get("policyId")
            matched = [p for p in guard.get("matchedPolicyIds", []) if isinstance(p, str)]
            return ToolResult(
                tool=name,
                blocked=True,
                verdict="block",
                policy_ids=([policy_id] if policy_id else []) + matched,
                risk_score=int(guard.get("riskScore") or 0),
                # error.message is a fixed literal for every block; the readable reason
                # is on guardmcp.message.
                message=guard.get("message") or error.get("message"),
            )
        result = node.get("result") or {}
        return ToolResult(tool=name, blocked=False, verdict="allow", payload=result)
