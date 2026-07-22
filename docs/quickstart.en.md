# Five-minute Quick Start

**English** | [한국어](quickstart.md)

Success means opening the console and being ready to run the deterministic demo within five minutes on a new environment.

## 0:00–1:00 — Prerequisites and clone

- Docker Engine 24 or later
- Docker Compose v2.20 or later (`docker compose version`)
- Git
- available local ports: `3000`–`3003`, `8080`, `5432`, and `6379`

```bash
git clone https://github.com/2026-OSS-Contest/GuradMCP-KR.git
cd GuradMCP-KR
```

## 1:00–4:00 — Start the demo

```bash
docker compose --profile demo up -d --build
```

The `demo` profile starts `demo-agent`, `demo-mcp-tools`, and deterministic seed data in addition to the product services: `gateway`, `control-plane`, `console`, `postgres`, and `redis`. The command is identical on ARM64 and AMD64 hosts.

## 4:00–5:00 — Verify and open the console

```bash
docker compose ps
curl --fail --silent http://localhost:3001/health
curl --fail --silent http://localhost:8080/actuator/health
```

When the started services are `healthy` and the health request succeeds, open <http://localhost:3000>. Run the deterministic scenario below and confirm that its verdict includes policy IDs, detections, and a risk score.

```bash
curl --fail --silent --request POST http://localhost:3002/demo/pii
```

The Demo Agent (LangChain4j) also reproduces the T-01 malicious-README scenario. The same
code runs against a different MCP endpoint only: in guarded mode the gateway policy blocks
the `.env` read, and in vulnerable mode the leak is replayed inside an isolated sandbox.

```bash
curl --fail --silent --request POST "http://localhost:3002/demo/readme-summary?mode=guarded"
curl --fail --silent --request POST "http://localhost:3002/demo/readme-summary?mode=vulnerable"
```

## Profiles

| Purpose | Command | Contents |
| --- | --- | --- |
| Minimal product | `docker compose up -d` | gateway, control-plane, console, PostgreSQL, Redis |
| Reproducible demo | `docker compose --profile demo up -d` | product services + demo-agent + demo-mcp-tools + deterministic seed |
| Development-mode demo | `docker compose --profile dev up -d` | product services + development-mode demo-agent + demo-mcp-tools |

## Connect an MCP agent

Replace the MCP endpoint used by the agent with the gateway endpoint. The local demo default is `http://localhost:3001/mcp`. The `default` and `korean-pii` packs are enabled.

This demo verifies policy evaluation plus request/response masking and blocking. Human approval UI and durable audit/replay are not implemented, so `require_approval` returns a fail-closed error without invoking upstream. PostgreSQL and Redis prove startup, seed, and health boundaries but do not yet store verdict history.

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
