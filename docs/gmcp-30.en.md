# GMCP-30 — Five-minute fresh-environment verification

**English** | [한국어](gmcp-30.md)

## Conditions

- A fresh ARM64 or AMD64 environment without existing GuardMCP-KR images or volumes
- A stable internet connection
- No verbal help beyond the [Quick Start](quickstart.en.md)

## Record

| Item | Result |
| --- | --- |
| Tester / date |  |
| OS / CPU architecture |  |
| Docker / Compose version |  |
| Clone start |  |
| `docker compose --profile demo up -d --build` start |  |
| All required services healthy |  |
| Console first opened |  |
| First demo event displayed |  |
| Total elapsed time |  |
| Failure, workaround, or confusing documentation |  |

## Pass criteria

1. The console loads within five minutes of the start.
2. Every required service is healthy.
3. A deterministic demo runs and displays a policy ID, detections, and risk score.
4. The tester completes the task from the document alone, without hidden settings or help.

Attach the completed record and reproduction logs to an issue or pull request after removing secrets and personal data.
