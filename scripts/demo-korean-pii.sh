#!/usr/bin/env bash
# GMCP-20 — Korean personal-data masking demo, run as a check rather than a script
# you have to read the output of.
#
# Looks the seeded consultation log up twice: once straight from the sandbox tool
# server (no gateway) and once through the gateway. Then it asserts the difference —
# the unguarded body still carries the phone, resident-registration and account
# values, and the guarded body carries none of them, only their tags.
#
# Every value here is synthetic seed data (apps/demo-mcp-tools/scripts/generate-tickets.ts).
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TICKET_ID="TCK-2026-9001"

read_env_value() {
  local key="$1" fallback="$2" value
  value="$(sed -nE "s/^${key}=([^#[:space:]]+).*$/\\1/p" "$ROOT_DIR/.env" 2>/dev/null | tail -n 1)"
  printf '%s' "${value:-$fallback}"
}

GATEWAY_PORT="${GATEWAY_PORT:-$(read_env_value GATEWAY_PORT 3001)}"
DEMO_MCP_TOOLS_PORT="${DEMO_MCP_TOOLS_PORT:-$(read_env_value DEMO_MCP_TOOLS_PORT 3003)}"
GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:${GATEWAY_PORT}}"
TOOLS_URL="${TOOLS_URL:-http://127.0.0.1:${DEMO_MCP_TOOLS_PORT}}"

# The three values the demo claims to protect. Kept in one place so an assertion
# can never silently drift away from what the seed actually contains.
SECRETS=("010-3456-7890" "881124-2300149" "110-234-567890")
TAGS=("[PHONE]" "[RRN_LIKE]" "[BANK_ACCOUNT]")

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

require_service() {
  local name="$1" url="$2"
  curl -sf --max-time 5 "$url/health" >/dev/null \
    || fail "$name is not reachable at $url. Start it with 'docker compose --profile demo up -d' or 'npm run dev'."
}

require_service "demo-mcp-tools" "$TOOLS_URL"
require_service "gateway" "$GATEWAY_URL"

unguarded="$(curl -sf --max-time 10 -X POST "$TOOLS_URL/tools/call/search_tickets" \
  -H 'content-type: application/json' \
  -d "{\"query\":\"$TICKET_ID\"}")" || fail "the unguarded lookup did not return a response"

guarded="$(curl -sf --max-time 10 -X POST "$GATEWAY_URL/mcp" \
  -H 'content-type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":\"demo-korean-pii\",\"method\":\"tools/call\",\"params\":{\"name\":\"search_tickets\",\"arguments\":{\"query\":\"$TICKET_ID\"}}}")" \
  || fail "the guarded lookup did not return a response"

verdict="$(printf '%s' "$guarded" | sed -nE 's/.*"verdict":"([a-z_]+)".*/\1/p')"
[ "$verdict" = "mask_then_allow" ] \
  || fail "expected the guarded lookup to be masked and delivered, got verdict '${verdict:-none}'"

# The unguarded run must actually leak, or the guarded run proves nothing.
for secret in "${SECRETS[@]}"; do
  case "$unguarded" in
    *"$secret"*) ;;
    *) fail "the unguarded lookup did not contain $secret — the seed no longer matches this demo" ;;
  esac
  case "$guarded" in
    *"$secret"*) fail "the guarded lookup still contains $secret" ;;
    *) ;;
  esac
done

for tag in "${TAGS[@]}"; do
  case "$guarded" in
    *"$tag"*) ;;
    *) fail "the guarded lookup is missing the $tag mask" ;;
  esac
done

printf 'PASS: %s masked %s in the guarded lookup; the unguarded lookup leaked all three.\n' \
  "$verdict" "$(printf '%s ' "${TAGS[@]}")"
