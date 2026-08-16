# Replay sessions and timelines

**English** | [한국어](replay.md)

The Replay screen is where you retrace **why a verdict came out the way it did** — which tool call hit which policy, at what risk score, in what order (GMCP-28).

## Where the data comes from

Two places.

| Source | Contents | Why it exists |
| --- | --- | --- |
| **Ingested audit events** | Verdicts the gateway actually emitted | A demo you ran has to show up on the screen |
| **Four seeded sessions** | Demo fixtures built at startup | Some things cannot be produced by running anything |

```text
gateway verdict → POST /api/v1/events → guard_event (Postgres)
                                            │
                                            ├─ projected into sessions/timelines
four seeded sessions ──────────────────────┤
                                            ▼
                            GET /sessions · /sessions/{id}/timeline · /events/{id}
```

**The seeds stay** because two of them are not reproducible by execution. The broken-chain session was deliberately corrupted to show **tamper being detected**, and the 1200-node session exists to **actually page past one page** at the maximum limit. They also keep the screen from being empty on a first boot where nothing has run yet.

## One event is one node

The gateway emits exactly **one** GuardEvent per routing decision, so the projection builds exactly **one VERDICT node**, and that node carries the tool name, direction, and args digest of the call it judged.

It does not synthesize a separate TOOL_CALL node. Doing so would put **an event that was never emitted** on the timeline, which is not something an audit trail may do.

A node's `eventId` is the value the gateway sent, so an id from the audit record opens `GET /events/{id}` directly.

## Verdict vocabulary

The policy engine produces five verdicts. Replay has four badges.

| Policy engine | Replay |
| --- | --- |
| `block` | `block` |
| `require_approval` | `require_approval` |
| `warn` | `warn` |
| **`mask_then_allow`** | **`warn`** |
| `allow` | `allow` |

Folding `mask_then_allow` into `warn` is the rule the console already documents. What the reader needs to know is that **the call was altered**, and Replay has no fifth badge to say it separately.

## Session ids

Gateway session ids are opaque strings (`req-s-envdemo`, `attacklab-1a2b`), but Replay addresses sessions by **UUID**, down to the console URL. So the UUID is **derived from the string by name**.

No mapping table is needed and the value survives a restart, which keeps deep links into a session valid. The original string stays visible as `agentLabel` in the list.

## Seeing a demo run in Replay

```bash
docker compose --profile demo up -d
./scripts/demo-env-leak.sh
```

The session you just ran is now in the list.

```bash
curl --fail --silent "http://localhost:8080/api/v1/sessions?limit=100"
```

Find the entry whose `agentLabel` is the gateway session id, then open its timeline by `sessionId` (the UUID).

```bash
curl --fail --silent "http://localhost:8080/api/v1/sessions/<uuid>/timeline"
```

The blocked node carries `verdict: "block"`, its `riskScore`, and `detail.matchedPolicyIds: ["block_env_file_read"]`.

## What is not carried

Inspected text is never stored anywhere (NFR-04). What a node carries is `argsDigest` — the digest, nothing else.

The gateway sometimes puts `normalizedPath` (which path matched `path_regex`) on its own GuardEvent, but **the ingest DTO has no such field, so it is dropped at the boundary.** It does not reach the Replay timeline.

## The hash chain

A session's VERDICT nodes bind their own `hash` to the previous verdict's `hash`. `chainStatus` has three values.

| Value | Meaning |
| --- | --- |
| `valid` | The stored hash and the recomputed one agree |
| `broken` | They disagree; `brokenAt` names the first event that failed |
| `unknown` | **No stored hash to check against — no verification is claimed** |

**Projected sessions report `unknown`.** A verification needs a hash written when the event was recorded, and `guard_event.hash`/`prev_hash` are schema-only — always null until GMCP-83 fills them in. Deriving a hash at read time and comparing it to a value derived in the same breath proves only that the function is deterministic; it would answer `valid` over a tampered row just as readily. So it does not do that.

The console omits the chain pill entirely when the status is `unknown`. A green "verified" badge on a session nothing has verified is worse than showing nothing — the rule `replay-adapter.ts` already applied to deep-linked event lookups.

Seeded sessions do report `valid` and `broken`. Their hashes are built at startup and held on the nodes, and one fixture stores a **deliberately wrong** hash, so the mismatch is genuinely detected.

Seeds and projections compute it with the **same code** (`ReplayChain`). Duplicating it lets the two drift, and the first symptom of that drift is **reporting a sound chain as BROKEN**.

## Known limits

- **There is no live push.** Projection happens at read time, so new events appear on reload. The SSE stream is separate work.
- The projection is computed per request. Fine at demo scale; a larger log will want caching.
- An audit trail is finished history, so it never matches the `status=live` filter. Only seeded sessions report `isLive: true`.
