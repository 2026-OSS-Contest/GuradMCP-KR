# GMCP-30 — Five-minute fresh-environment verification

**English** | [한국어](gmcp-30.md)

## Conditions

- A fresh ARM64 or AMD64 environment without existing GuardMCP-KR images or volumes
- A stable internet connection
- No verbal help beyond the [Quick Start](quickstart.en.md)

## Record

| Item | Result |
| --- | --- |
| Tester / date | Gyuho Kim / 2026-07-31 (internal first pass) |
| OS / CPU architecture | macOS 15 (Darwin 25.5.0) / ARM64 (Apple Silicon) |
| Docker / Compose version | Docker 29.4.2 |
| Clone start | Not measured — replaced by a fresh git worktree of dev@8dc45bc plus a successful `npm ci` |
| `docker compose --profile demo up -d --build` start | Reference time T+0s (required services only, demo profile excluded) |
| All required services healthy | T+136s (console, gateway, control-plane, postgres, redis all healthy) |
| Console first opened | T+142s (`/api/health` UP including gateway and control-plane dependencies) |
| First demo event displayed | Not measured — demo profile not run (to be measured during external verification) |
| Total elapsed time | **142 seconds (passes the 5-minute KPI)** |
| Failure, workaround, or confusing documentation | Local ports 3000/5432 were taken by unrelated processes → avoided via the provided `CONSOLE_PORT`-style env overrides; no compose file changes needed |

> This first record is an internal verification (team member's machine, warm npm/Docker caches). The clean-machine, external-verifier reproduction required by the DoD will be performed separately before submission.

## Pass criteria

1. The console loads within five minutes of the start.
2. Every required service is healthy.
3. The deterministic demo API runs and returns a policy ID, detections, and risk score.
4. The tester completes the task from the document alone, without hidden settings or help.

Attach the completed record and reproduction logs to an issue or pull request after removing secrets and personal data.
