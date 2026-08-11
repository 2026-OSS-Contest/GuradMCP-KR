# GMCP-30 — Five-minute fresh-environment verification

**English** | [한국어](gmcp-30.md)

## Conditions

- A fresh ARM64 or AMD64 environment without existing GuardMCP-KR images or volumes
- A stable internet connection
- No verbal help beyond the [Quick Start](quickstart.en.md)

## Record

### Pass 1 — 2026-07-31 (internal)

| Item | Result |
| --- | --- |
| Tester / date | Gyuho Kim / 2026-07-31 (internal first pass) |
| OS / CPU architecture | macOS 15 (Darwin 25.5.0) / ARM64 (Apple Silicon) |
| Docker / Compose version | Docker 29.4.2 |
| Clone start | Not measured — fresh git worktree of dev@8dc45bc plus successful `npm ci` |
| Compose start | T+0s (required services focus) |
| All required services healthy | T+136s |
| Console first opened | T+142s (`/api/health` UP) |
| Total elapsed | **142 seconds (passes the 5-minute KPI)** |
| Workaround | Ports 3000/5432 taken → `CONSOLE_PORT`-style env overrides |

### Pass 2 — 2026-08-11 (internal re-check, full demo profile)

| Item | Result |
| --- | --- |
| Tester / date | Gyuho Kim / 2026-08-11 (`dev`@`9f91841`) |
| Docker | 29.6.2 |
| Start | 2026-08-11T09:57:05+09:00 — `docker compose --profile demo up -d --build` |
| Port strategy | Host defaults conflicted; used `POSTGRES_PORT=25432` `REDIS_PORT=26379` `CONSOLE_PORT=23000` `GATEWAY_PORT=23001` `CONTROL_PLANE_PORT=28080` `DEMO_AGENT_PORT=23002` `DEMO_MCP_TOOLS_PORT=23003` |
| Console `/api/health` UP | **T+18s** with gateway + control-plane dependencies up |
| Required services | postgres·redis·gateway·control-plane·demo-mcp-tools healthy; console returned UP |
| Gateway `/health` | UP |
| Control Plane health | UP |
| `/api/v1/overview` | 200 — `activePolicyPacks: ["default","korean-pii"]` |
| Total elapsed | **18 seconds (passes KPI)** — warm image cache; cold build ≈ pass 1 |
| Doc improvement | Default host ports often collide; surface port-override block in Quick Start. External one-person reproduction tracked in [reproduction report](submission/reproduction-report.md) (GMCP-48) |

> Both passes are internal. The **external verifier** required by the DoD is recorded under GMCP-48 before final submission.

## Pass criteria

1. Console loads within five minutes — **pass** (142s / 18s)
2. Every required service is healthy — **pass** (pass 2, demo profile)
3. Deterministic demo API returns policy packs / seed signals — **pass**
4. Document-only completion — internal pass; external verifier under GMCP-48

## Port-conflict recipe

```bash
export POSTGRES_PORT=25432 REDIS_PORT=26379 \
  CONSOLE_PORT=23000 GATEWAY_PORT=23001 CONTROL_PLANE_PORT=28080 \
  DEMO_AGENT_PORT=23002 DEMO_MCP_TOOLS_PORT=23003
docker compose --profile demo up -d --build
# Console: http://127.0.0.1:23000
```

Attach the completed record and reproduction logs to an issue or pull request after removing secrets and personal data.
