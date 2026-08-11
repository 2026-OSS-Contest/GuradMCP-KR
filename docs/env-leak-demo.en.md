# .env exfiltration demo (T-01)

**English** | [한국어](env-leak-demo.md)

The headline demo. A comment hidden in a malicious README tells the Agent to read `.env` and mail it out, and the gateway stops it at the **first step** (threat T-01). This is the 0:20–1:30 segment of the walkthrough.

## What gets compared

| | Unguarded | Guarded |
| --- | --- | --- |
| Call target | Tool server directly | Through the gateway |
| Step 1 `read_file('.env')` | Succeeds — credentials returned | **Blocked** (`block_env_file_read`) |
| Step 2 `send_email` | Runs — the leak completes | **Never happens** |
| Outcome | `leaked: true` | `blocked: true`, `leaked: false` |

**The agent code is identical on both sides.** Same plan, same loop — the only difference is the endpoint the tool calls go to.

That the block lands on **step 1** is the point. Exfiltration is a two-step chain; stop the first step and the second never gets asked.

## Reproducing it

```bash
docker compose --profile demo up -d
```

```bash
./scripts/demo-env-leak.sh
```

The script does not merely print a result — it **asserts** one:

- the guarded chain ended after one step (`send_email` never ran at all);
- the block cited `block_env_file_read`;
- nothing from the sandbox `.env` (`sk-`, `ghp_`, `AKIA`, `SMTP_PASSWORD`) appears anywhere in the guarded response;
- and the unguarded run **actually leaks** — without that half, the guarded result proves nothing.

Any mismatch names what broke and exits non-zero.

To watch it from the agent's side:

```bash
curl --fail --silent --request POST "http://localhost:3002/demo/readme-summary?mode=guarded"
curl --fail --silent --request POST "http://localhost:3002/demo/readme-summary?mode=vulnerable"
curl --fail --silent --request POST http://localhost:3002/demo/readme-summary/compare
```

## Isolation

The tool servers are a sandbox. The `.env` holds **synthetic** values that authenticate nowhere, and `send_email` records to a local outbox instead of contacting SMTP. When vulnerable mode "succeeds", there is nowhere for the data to go.

## What the block event carries

The gateway emits the block as a GuardEvent and forwards it to the control plane over the audit path (`POST /api/v1/events`). The real event looks like this:

| Field | Value |
| --- | --- |
| `verdict` | `block` |
| `matchedPolicyIds` | `["block_env_file_read"]` |
| `riskScore` | `38` |
| `explanation.ko` / `.en` | Blocked — policy block_env_file_read (severity critical)… |
| `argsDigest` | Digest of the inspected arguments — **not** the arguments |
| `normalizedPath` | `.env` |

`normalizedPath` is included deliberately (FR-SEC-04 §3.3) — it records **what the `path_regex` matched against**, and the file's contents appear nowhere. Note that the field is not part of the control plane's ingest DTO, so it is dropped at that boundary; it does not reach the Replay timeline.

## Seeing it in Replay

The block event arrives at the control plane carrying its policy id and risk score exactly as tabled above, and **Replay reads it** (GMCP-114). The run you just executed appears in the session list.

```bash
curl --fail --silent "http://localhost:8080/api/v1/sessions?limit=100"
```

Find the entry whose `agentLabel` is this demo's gateway session id, then open its timeline by `sessionId` (the UUID).

```bash
curl --fail --silent "http://localhost:8080/api/v1/sessions/<uuid>/timeline"
```

The blocked node carries `verdict: "block"`, its `riskScore`, and `detail.matchedPolicyIds: ["block_env_file_read"]` with the same values as the table above. See [Replay sessions and timelines](replay.en.md) for the details.

Projection happens at read time, so new events appear on reload — there is no live push yet.
