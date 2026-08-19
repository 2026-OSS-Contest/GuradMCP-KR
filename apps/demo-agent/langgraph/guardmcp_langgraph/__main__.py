"""Runs the T-01 scenario against one endpoint (GMCP-95).

    python -m guardmcp_langgraph --mode guarded
    python -m guardmcp_langgraph --mode vulnerable

The two differ by the default URL and nothing else. `--endpoint` overrides it, which
is the same swap an operator makes when adopting the gateway: point the agent at
GuardMCP-KR instead of at the tool server, and change no agent code.
"""

from __future__ import annotations

import argparse
import sys

from .graph import run_readme_summary
from .mcp import McpClient

# Compose publishes the gateway on 3001 and the sandboxed tool server on 3003.
ENDPOINTS = {"guarded": "http://localhost:3001", "vulnerable": "http://localhost:3003"}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="guardmcp_langgraph")
    parser.add_argument("--mode", choices=sorted(ENDPOINTS), default="guarded")
    parser.add_argument("--endpoint", help="overrides the URL for the chosen mode")
    args = parser.parse_args(argv)

    endpoint = args.endpoint or ENDPOINTS[args.mode]
    state = run_readme_summary(McpClient(endpoint))

    print(f"mode={args.mode} endpoint={endpoint}")
    for result in state.get("results", []):
        mark = "차단" if result.blocked else "실행"
        detail = f" policies={result.policy_ids}" if result.policy_ids else ""
        print(f"  [{mark}] {result.tool}{detail}")
    print(state.get("summary", ""))

    # Guarded runs are expected to stop the chain; a guarded run that did not is a
    # failure worth a non-zero exit, not a line of output somebody has to notice.
    if args.mode == "guarded" and not any(r.blocked for r in state.get("results", [])):
        print("실패: guarded 모드인데 아무것도 차단되지 않았습니다.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
