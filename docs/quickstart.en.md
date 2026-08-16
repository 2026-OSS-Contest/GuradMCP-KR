# Five-minute Quick Start

**English** | [한국어](quickstart.md)

Success means opening the console and being ready to run the deterministic demo within five minutes on a new environment.

## 0:00–1:00 — Prerequisites and clone

- Docker Engine 24 or later
- Docker Compose v2.20 or later (`docker compose version`)
- Git
- available local ports: `3000`–`3003`, `8080`, `5432`, and `6379`
  (if taken, use the **port overrides** below)

```bash
git clone https://github.com/2026-OSS-Contest/GuradMCP-KR.git
cd GuradMCP-KR
```

## 1:00–4:00 — Start the demo

```bash
docker compose --profile demo up -d --build
```

If host ports are already allocated, override them (pattern validated in GMCP-30 re-check):

```bash
export POSTGRES_PORT=25432 REDIS_PORT=26379 \
  CONSOLE_PORT=23000 GATEWAY_PORT=23001 CONTROL_PLANE_PORT=28080 \
  DEMO_AGENT_PORT=23002 DEMO_MCP_TOOLS_PORT=23003
docker compose --profile demo up -d --build
# Console: http://127.0.0.1:23000  Gateway: http://127.0.0.1:23001
```

The `demo` profile starts `demo-agent`, `demo-mcp-tools`, and deterministic seed data in addition to the product services: `gateway`, `control-plane`, `console`, `postgres`, and `redis`. The command is identical on ARM64 and AMD64 hosts.

## 4:00–5:00 — Verify and open the console

```bash
docker compose ps
curl --fail --silent http://localhost:3001/health
curl --fail --silent http://localhost:8080/actuator/health
# Pipeline instrumentation: verdict counts and latency percentiles only (no payloads or detected values)
curl --fail --silent http://localhost:3001/metrics
```

When the started services are `healthy` and the health request succeeds, open <http://localhost:3000>. Run the deterministic scenario below and confirm that its verdict includes policy IDs, detections, and a risk score.

```bash
curl --fail --silent --request POST http://localhost:3002/demo/pii
```

The Demo Agent (LangChain4j) also reproduces the T-01 malicious-README scenario. Both modes
**run the same agent logic and differ only in the endpoint they target.** Guarded mode routes
requests through the gateway (`/mcp`) so the policy blocks the `.env` read; vulnerable mode
calls the same tool servers directly (`/tools/call/…`) and shows the leak succeeding with no
inspection in the way. Those tool servers are an isolated sandbox: the `.env` holds synthetic
values and `send_email` records to a local outbox instead of contacting real SMTP.

```bash
curl --fail --silent --request POST "http://localhost:3002/demo/readme-summary?mode=guarded"
curl --fail --silent --request POST "http://localhost:3002/demo/readme-summary?mode=vulnerable"
```

To assert the block rather than read it, run the check below. See the [.env exfiltration demo](env-leak-demo.en.md).

```bash
./scripts/demo-env-leak.sh
```

The T-02/T-08 scenario runs the same way: a support-ticket lookup whose phone number, resident
registration number, and bank account are masked. That lookup is legitimate work, so it ends in
`mask_then_allow` rather than a block. See the [Korean PII masking demo](korean-pii-demo.en.md).

```bash
curl --fail --silent --request POST http://localhost:3002/demo/consultation-log
# To assert the masking rather than just read it
./scripts/demo-korean-pii.sh
```

## Profiles

| Purpose | Command | Contents |
| --- | --- | --- |
| Minimal product | `docker compose up -d` | gateway, control-plane, console, PostgreSQL, Redis |
| Reproducible demo | `docker compose --profile demo up -d` | product services + demo-agent + demo-mcp-tools + deterministic seed |
| Development-mode demo | `docker compose --profile dev up -d` | product services + demo-mcp-tools (source-mounted) + demo-agent (built image) |

In development mode, `demo-mcp-tools` reflects source edits. `demo-agent` is a compiled JVM service that runs from its built image, so code changes take effect on rebuild.

## Connect an MCP agent

Replace the MCP endpoint used by the agent with the gateway endpoint. The local demo default is `http://localhost:3001/mcp`. The `default` and `korean-pii` packs are enabled.

This demo verifies policy evaluation plus request/response masking and blocking. Since `docker compose` injects `CONTROL_PLANE_URL` by default, a `require_approval` verdict holds on a real Control Plane approval: an operator decides (approve, approve-masked, or block), or it fails closed automatically after 120 seconds with no response (without `CONTROL_PLANE_URL`, it fails closed immediately). The human approval UI, the Replay screen, and the hash chain are not yet wired to these approval events — see the [external-email approval demo](external-email-approval-demo.en.md) for the reproduction steps and limits. PostgreSQL and Redis prove startup, seed, and health boundaries but do not yet store verdict history.

## Stop or reset

```bash
docker compose --profile demo down
# Also remove volumes to reload deterministic seed data
docker compose --profile demo down -v
```

## Troubleshooting

1. **A container is not healthy:** inspect `docker compose ps` and `docker compose logs <service>`.
2. **A port is already in use:** stop the process using the port or change the compose host port.
3. **An image fails to build:** refresh its base image with `docker compose build --pull --no-cache <service>`.
4. **No event appears in the console:** verify `gateway` and `control-plane` health, then run Demo again.

Use the [GMCP-30 verification checklist](gmcp-30.en.md) to record the five-minute KPI run.
