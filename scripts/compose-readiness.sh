#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${GUARDMCP_PROFILE:-${1:-demo}}"
POLL_SECONDS="${COMPOSE_READY_POLL_SECONDS:-2}"
REPORT_PATH="${GMCP30_REPORT_PATH:-$ROOT_DIR/reports/gmcp-30-readiness.json}"

read_env_value() {
  local key="$1" fallback="$2" value
  value="$(sed -nE "s/^${key}=([^#[:space:]]+).*$/\\1/p" "$ROOT_DIR/.env" 2>/dev/null | tail -n 1)"
  printf '%s' "${value:-$fallback}"
}

TIMEOUT_SECONDS="${COMPOSE_READY_TIMEOUT_SECONDS:-$(read_env_value COMPOSE_READY_TIMEOUT_SECONDS 300)}"
case "$TIMEOUT_SECONDS" in
  ''|*[!0-9]*) printf '%s\n' 'COMPOSE_READY_TIMEOUT_SECONDS must be an integer.' >&2; exit 64 ;;
esac
if (( TIMEOUT_SECONDS < 1 || TIMEOUT_SECONDS > 300 )); then
  printf '%s\n' 'GMCP-30 timeout must be between 1 and 300 seconds.' >&2
  exit 64
fi

CONSOLE_PORT="${CONSOLE_PORT:-$(read_env_value CONSOLE_PORT 3000)}"
GATEWAY_PORT="${GATEWAY_PORT:-$(read_env_value GATEWAY_PORT 3001)}"
DEMO_AGENT_PORT="${DEMO_AGENT_PORT:-$(read_env_value DEMO_AGENT_PORT 3002)}"
DEMO_MCP_TOOLS_PORT="${DEMO_MCP_TOOLS_PORT:-$(read_env_value DEMO_MCP_TOOLS_PORT 3003)}"
CONTROL_PLANE_PORT="${CONTROL_PLANE_PORT:-$(read_env_value CONTROL_PLANE_PORT 8080)}"

CHECK_NAMES=(console gateway control-plane demo-agent demo-mcp-tools)
CHECK_URLS=(
  "http://127.0.0.1:${CONSOLE_PORT}/api/health"
  "http://127.0.0.1:${GATEWAY_PORT}/health"
  "http://127.0.0.1:${CONTROL_PLANE_PORT}/actuator/health"
  "http://127.0.0.1:${DEMO_AGENT_PORT}/health"
  "http://127.0.0.1:${DEMO_MCP_TOOLS_PORT}/health"
)

mkdir -p "$(dirname -- "$REPORT_PATH")"
start_epoch="${GMCP30_STARTED_AT_EPOCH:-$(date +%s)}"
case "$start_epoch" in
  ''|*[!0-9]*) printf '%s\n' 'GMCP30_STARTED_AT_EPOCH must be a Unix epoch integer.' >&2; exit 64 ;;
esac
if (( start_epoch > $(date +%s) )); then
  printf '%s\n' 'GMCP30_STARTED_AT_EPOCH cannot be in the future.' >&2
  exit 64
fi
deadline=$((start_epoch + TIMEOUT_SECONDS))
attempt=0
failed="console"

write_report() {
  local status="$1" elapsed="$2" failed_service="${3:-}"
  local completed_at started_at
  completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  # `date -d @epoch` is GNU-only (BSD/macOS date has no equivalent flag); node is
  # already a hard dependency of this script (see the demo-scenario check below).
  started_at="$(node -e "console.log(new Date(${start_epoch} * 1000).toISOString().replace(/\.\d+Z$/, 'Z'))")"
  cat >"$REPORT_PATH" <<JSON
{
  "requirement": "GMCP-30",
  "status": "${status}",
  "profile": "${PROFILE}",
  "elapsedSeconds": ${elapsed},
  "timeoutSeconds": ${TIMEOUT_SECONDS},
  "consoleUrl": "${CHECK_URLS[0]%/api/health}",
  "seedId": "guardmcp-demo-v1",
  "failedService": "${failed_service}",
  "startedAt": "${started_at}",
  "completedAt": "${completed_at}"
}
JSON
}

already_elapsed=$(( $(date +%s) - start_epoch ))
if (( already_elapsed > TIMEOUT_SECONDS )); then
  failed="compose-build-or-startup"
fi
printf 'GMCP-30: %ss of %ss elapsed since Compose build/start began; waiting for the %s stack...\n' \
  "$already_elapsed" "$TIMEOUT_SECONDS" "$PROFILE"
while (( $(date +%s) <= deadline )); do
  attempt=$((attempt + 1))
  failed=""
  for index in "${!CHECK_URLS[@]}"; do
    if ! curl --fail --silent --show-error --max-time 2 "${CHECK_URLS[$index]}" >/dev/null 2>&1; then
      failed="${CHECK_NAMES[$index]}"
      break
    fi
  done

  if [[ -z "$failed" ]]; then
    demo_response="$(curl --fail --silent --show-error --max-time 3 \
      --request POST "http://127.0.0.1:${DEMO_AGENT_PORT}/demo/pii" 2>/dev/null || true)"
    if DEMO_RESPONSE="$demo_response" node -e '
      const body = JSON.parse(process.env.DEMO_RESPONSE || "null");
      const serialized = JSON.stringify(body);
      const result = JSON.stringify(body?.result);
      if (body?.verdict !== "mask_then_allow"
        || !Array.isArray(body?.policyIds) || !body.policyIds.includes("mask_korean_pii_response")
        || !Array.isArray(body?.detections) || body.detections.length < 2
        || !Number.isFinite(body?.riskScore)
        || !result.includes("[PHONE]") || !result.includes("[BANK_ACCOUNT]")
        || serialized.includes("010-1234-5678") || serialized.includes("110-123-456789")) process.exit(1);
    ' 2>/dev/null; then
      elapsed=$(( $(date +%s) - start_epoch ))
      write_report pass "$elapsed"
      printf 'GMCP-30 PASS: console, dependencies, and deterministic demo ready in %ss (%s).\n' \
        "$elapsed" "${CHECK_URLS[0]%/api/health}"
      exit 0
    fi
    failed="demo-scenario"
  fi

  printf '  attempt %d: waiting for %s\n' "$attempt" "$failed"
  sleep "$POLL_SECONDS"
done

elapsed=$(( $(date +%s) - start_epoch ))
write_report fail "$elapsed" "$failed"
printf 'GMCP-30 FAIL: %s was not ready within %ss. Evidence: %s\n' \
  "$failed" "$TIMEOUT_SECONDS" "$REPORT_PATH" >&2
if command -v docker >/dev/null 2>&1; then
  (cd "$ROOT_DIR" && docker compose --profile "$PROFILE" ps) >&2 || true
fi
exit 1
