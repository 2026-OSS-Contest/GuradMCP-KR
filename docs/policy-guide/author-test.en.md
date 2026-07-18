# External policy-author test

**English** | [한국어](author-test.md)

The goal is to verify that an external contributor who does not know the GuardMCP-KR implementation can create one valid policy and regression fixtures from the [Policy Authoring Guide](README.en.md) alone.

## Participant

- At least one person who has not seen the project code or policy-engine implementation
- Knows basic YAML but received no separate Appendix A explanation
- The facilitator does not provide answers or verbal command guidance

## Task

> In a new pack, author a high-severity policy that blocks a `fetch_url` response from an `untrusted` MCP server when `INJECTION.OBFUSCATED` is detected and risk is at least 80. Add one attack and one benign fixture, then run validation and the benchmark. Do not use real secrets or personal data.

## Observation record

| Item | Record |
| --- | --- |
| Start/end time |  |
| Help requested outside the guide |  |
| Misunderstood field or rule |  |
| First validation result |  |
| Final benchmark result |  |
| Documentation improvement |  |

## Pass criteria

1. Finish within 30 minutes.
2. `direction`, `tool`, `server_trust`, `detections`, `risk_score`, action, and severity match the task.
3. `npm run policy:validate` passes.
4. `npm run bench` preserves all quality thresholds.
5. The attack fixture matches and the benign fixture does not.
6. No real personal data/secrets or facilitator hints are used.

## Evidence

Attach the completed commit/pull request, anonymized observation record, validation output, and benchmark JSON to an issue. Do not mark this test successful before an external run. Record failures as documentation defects, improve the guide, and retest with a new participant.
