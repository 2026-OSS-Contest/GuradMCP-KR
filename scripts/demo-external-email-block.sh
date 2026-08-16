#!/usr/bin/env bash
# GMCP-26 — Outbound email carrying a secret, held for approval, then released only
# masked (8.3 approval sequence), run as a check rather than a script you have to read
# the output of.
#
# Sends a send_email tool call — an external recipient, a secret in the body — through
# the gateway. The policy (policy-packs/default/policies/require-approval-external-secret-
# email.yaml) holds it instead of delivering it, so the gateway's own HTTP response for
# this call blocks until an operator resolves it. This script plays the operator's part
# too, through Control Plane's own API — the same POST a console click makes — then
# checks the demo mail-server's outbox to prove only the masked body was ever delivered,
# never the secret.
#
# Pass --timeout to instead demonstrate the other half of the spec: take no operator
# action at all, and let the 120-second fail-closed timeout auto-block it. That mode
# genuinely waits out the full 120 seconds, the same as an operator watching the
# countdown would.
#
# The API key shape here is synthetic (`sk-ant-demo...`), not a real credential.
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

read_env_value() {
  local key="$1" fallback="$2" value
  value="$(sed -nE "s/^${key}=([^#[:space:]]+).*$/\\1/p" "$ROOT_DIR/.env" 2>/dev/null | tail -n 1)"
  printf '%s' "${value:-$fallback}"
}

GATEWAY_PORT="${GATEWAY_PORT:-$(read_env_value GATEWAY_PORT 3001)}"
CONTROL_PLANE_PORT="${CONTROL_PLANE_PORT:-$(read_env_value CONTROL_PLANE_PORT 8080)}"
DEMO_MCP_TOOLS_PORT="${DEMO_MCP_TOOLS_PORT:-$(read_env_value DEMO_MCP_TOOLS_PORT 3003)}"
GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:${GATEWAY_PORT}}"
CONTROL_PLANE_URL="${CONTROL_PLANE_URL:-http://127.0.0.1:${CONTROL_PLANE_PORT}}"
TOOLS_URL="${TOOLS_URL:-http://127.0.0.1:${DEMO_MCP_TOOLS_PORT}}"

MODE="masked"
if [ "${1:-}" = "--timeout" ]; then
  MODE="timeout"
elif [ -n "${1:-}" ]; then
  printf 'usage: %s [--timeout]\n' "$0" >&2
  exit 2
fi

SECRET="sk-ant-demo0000000000000000demo"
TO="outside@example.net"
SESSION_ID="demo-external-email-$(date +%s)-$$"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

command -v jq >/dev/null 2>&1 || fail "jq is required (e.g. 'brew install jq')"

require_service() {
  local name="$1" url="$2" path="${3:-/health}"
  curl -sf --max-time 5 "$url$path" >/dev/null \
    || fail "$name is not reachable at $url. Start it with 'docker compose up -d' (gateway and control-plane are not profile-gated)."
}

require_service "gateway" "$GATEWAY_URL"
require_service "control-plane" "$CONTROL_PLANE_URL" "/actuator/health"
require_service "demo-mcp-tools" "$TOOLS_URL"

RESPONSE_FILE="$(mktemp)"
trap 'rm -f "$RESPONSE_FILE"' EXIT

outbox_count_for() {
  curl -sf --max-time 5 -X POST "$TOOLS_URL/tools/call/list_outbox" -H 'content-type: application/json' -d '{}' \
    | jq -r --arg to "$1" '.content[0].text | fromjson | [.[] | select(.to == $to)] | length'
}

# The outbox persists across runs, so "nothing was delivered" has to be judged against
# this run's own baseline, not an assumption that the outbox starts empty.
BASELINE_OUTBOX_COUNT="$(outbox_count_for "$TO")"

# The Agent's own call: the gateway holds this HTTP request open until the approval
# resolves (§5.1), so it has to run in the background while this script plays the
# operator's part on a separate connection.
curl -sf --max-time 130 -X POST "$GATEWAY_URL/mcp" \
  -H 'content-type: application/json' \
  -d "$(jq -n --arg sid "$SESSION_ID" --arg to "$TO" --arg body "key $SECRET" '{
    jsonrpc: "2.0", id: "demo-external-email", sessionId: $sid, method: "tools/call",
    params: { name: "send_email", arguments: { to: $to, subject: "Q3 report", body: $body } }
  }')" \
  >"$RESPONSE_FILE" &
AGENT_PID=$!

find_approval_id() {
  curl -sf --max-time 5 "$CONTROL_PLANE_URL/api/v1/approvals" \
    | jq -r --arg sid "$SESSION_ID" '[.[] | select(.sessionId == $sid)][0].id // empty'
}

APPROVAL_ID=""
for _ in $(seq 1 20); do
  APPROVAL_ID="$(find_approval_id || true)"
  [ -n "$APPROVAL_ID" ] && break
  sleep 0.5
done
[ -n "$APPROVAL_ID" ] || fail "no approval card was created for session $SESSION_ID within 10s"

printf 'Approval card created: %s (send_email -> %s)\n' "$APPROVAL_ID" "$TO"

if [ "$MODE" = "masked" ]; then
  printf 'Operator action: 마스킹 후 승인 (approve_masked)\n'
  curl -sf --max-time 5 -X POST "$CONTROL_PLANE_URL/api/v1/approvals/$APPROVAL_ID/decision" \
    -H 'content-type: application/json' \
    -d '{"decision":"approve_masked","decidedBy":"demo-operator"}' >/dev/null \
    || fail "the decision endpoint rejected approve_masked"
else
  printf 'Operator action: none — waiting out the 120s fail-closed timeout...\n'
fi

wait "$AGENT_PID" || true
RESULT="$(cat "$RESPONSE_FILE")"
[ -n "$RESULT" ] || fail "the gateway never answered the Agent's request"

case "$RESULT" in
  *"$SECRET"*) fail "the raw secret reached the Agent's own response" ;;
esac

if [ "$MODE" = "masked" ]; then
  case "$RESULT" in
    *'"error"'*) fail "expected approve_masked to deliver the call, got an error: $RESULT" ;;
  esac

  outbox_after="$(outbox_count_for "$TO")"
  [ "$outbox_after" -gt "$BASELINE_OUTBOX_COUNT" ] || fail "no new message to $TO was recorded in the outbox"

  outbox="$(curl -sf --max-time 5 -X POST "$TOOLS_URL/tools/call/list_outbox" -H 'content-type: application/json' -d '{}' \
    | jq -r '.content[0].text')" || fail "could not read the outbox"
  delivered="$(printf '%s' "$outbox" | jq --arg to "$TO" '[.[] | select(.to == $to)] | sort_by(.sentAt) | last')"
  [ "$delivered" != "null" ] || fail "no message to $TO was ever recorded in the outbox"

  body="$(printf '%s' "$delivered" | jq -r '.body')"
  case "$body" in
    *"$SECRET"*) fail "the outbox message body still contains the raw secret: $body" ;;
  esac
  case "$body" in
    *'[SECRET]'*) ;;
    *) fail "the outbox message body is missing the [SECRET] mask: $body" ;;
  esac
  [ "$(printf '%s' "$delivered" | jq -r '.to')" = "$TO" ] \
    || fail "the recipient was altered by masking — got $(printf '%s' "$delivered" | jq -r '.to')"

  printf 'PASS: approve_masked delivered "%s" to %s with the secret replaced by [SECRET], recipient untouched.\n' "$body" "$TO"
else
  case "$RESULT" in
    *'"error"'*) ;;
    *) fail "expected a fail-closed error after the 120s timeout, got: $RESULT" ;;
  esac
  reason_code="$(printf '%s' "$RESULT" | jq -r '.error.data.guardmcp.reasonCode // empty')"
  [ "$reason_code" = "APPROVAL_TIMEOUT_BLOCKED" ] \
    || fail "expected reasonCode APPROVAL_TIMEOUT_BLOCKED, got '${reason_code:-none}'"

  outbox_after="$(outbox_count_for "$TO")"
  [ "$outbox_after" = "$BASELINE_OUTBOX_COUNT" ] || fail "upstream send_email was called even though the approval timed out"

  printf 'PASS: no operator action -> auto-blocked after 120s (reasonCode=APPROVAL_TIMEOUT_BLOCKED), nothing delivered.\n'
fi
