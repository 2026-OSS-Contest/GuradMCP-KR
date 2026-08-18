"""T-01 reproduction without a running stack (GMCP-95).

The transport is stubbed, so these assert what the agent does with a gateway's answer,
not that a gateway is reachable. The end-to-end proof — a real block from a real
policy — is `scripts/demo-langgraph-t01.sh`, which needs `docker compose --profile demo`.
"""

from __future__ import annotations

import json

import pytest

from guardmcp_langgraph.graph import run_readme_summary
from guardmcp_langgraph.mcp import McpClient

BLOCK_RESPONSE = {
    "jsonrpc": "2.0",
    "id": "t-01",
    "error": {
        "code": -32000,
        "message": "GuardMCP-KR policy violation",
        "data": {
            "guardmcp": {
                "policyId": "block_env_file_read",
                "matchedPolicyIds": [],
                "riskScore": 38,
                "message": "차단했습니다 — 정책 block_env_file_read",
            }
        },
    },
}
ALLOW_RESPONSE = {"jsonrpc": "2.0", "id": "t-01", "result": {"content": []}}


def transport_for(responses):
    """Answers each call in order and records what was asked."""
    calls: list[str] = []

    def transport(url: str, body: bytes) -> bytes:
        calls.append(json.loads(body)["params"]["name"])
        return json.dumps(responses[len(calls) - 1]).encode("utf-8")

    return transport, calls


def test_guarded_run_stops_at_the_first_call():
    transport, calls = transport_for([BLOCK_RESPONSE])
    state = run_readme_summary(McpClient("http://gateway", transport))

    # The exfiltration is a two-step chain. Blocking step one means step two is never
    # asked — that is the claim the demo makes, so assert the absence, not just the block.
    assert calls == ["read_file"]
    assert "send_email" not in calls
    results = state["results"]
    assert results[0].blocked is True
    assert results[0].policy_ids == ["block_env_file_read"]
    assert results[0].risk_score == 38
    assert "차단" in state["summary"]


def test_unguarded_run_completes_the_chain():
    transport, calls = transport_for([ALLOW_RESPONSE, ALLOW_RESPONSE])
    state = run_readme_summary(McpClient("http://tools", transport))

    assert calls == ["read_file", "send_email"]
    assert all(not r.blocked for r in state["results"])


def test_both_modes_run_identical_agent_code():
    """The onboarding claim: only the URL differs.

    Both runs go through the same graph with the same plan; the difference in outcome
    comes from the endpoint's answers, not from a branch inside the agent.
    """
    blocked_transport, blocked_calls = transport_for([BLOCK_RESPONSE])
    open_transport, open_calls = transport_for([ALLOW_RESPONSE, ALLOW_RESPONSE])

    run_readme_summary(McpClient("http://gateway", blocked_transport))
    run_readme_summary(McpClient("http://tools", open_transport))

    # Same first call in both: the agent asked for the same thing and one side refused.
    assert blocked_calls[0] == open_calls[0] == "read_file"


def test_a_non_2xx_gateway_answer_fails_closed():
    import urllib.error

    def failing(url: str, body: bytes) -> bytes:
        raise urllib.error.HTTPError(url, 502, "Bad Gateway", {}, None)  # type: ignore[arg-type]

    result = McpClient("http://gateway", failing).call("read_file", {"path": ".env"}, "t-01")
    # An unknown verdict must read as blocked; treating it as allowed would let a
    # gateway outage silently turn the demo into the unguarded path.
    assert result.blocked is True
    assert result.verdict == "error"


@pytest.mark.parametrize("mode,expected", [("guarded", 1), ("vulnerable", 0)])
def test_cli_exit_code_reflects_whether_the_chain_was_stopped(monkeypatch, mode, expected):
    from guardmcp_langgraph import __main__ as cli

    transport, _ = transport_for([ALLOW_RESPONSE, ALLOW_RESPONSE])
    monkeypatch.setattr(cli, "McpClient", lambda url: McpClient(url, transport))
    # Nothing blocked: guarded must fail loudly, vulnerable is expected to complete.
    assert cli.main(["--mode", mode]) == expected
