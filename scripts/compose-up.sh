#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${1:-${GUARDMCP_PROFILE:-demo}}"

case "$PROFILE" in
  demo|dev) ;;
  *)
    printf 'Usage: %s [demo|dev]\n' "${0##*/}" >&2
    exit 64
    ;;
esac

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  printf '%s\n' 'Docker Compose v2 is required.' >&2
  exit 69
fi

cd "$ROOT_DIR"
if [[ ! -f .env ]]; then
  cp .env.example .env
  printf '%s\n' 'Created .env from deterministic local defaults.'
fi

printf 'Starting GuardMCP-KR %s profile...\n' "$PROFILE"
gmcp30_started_at_epoch="$(date +%s)"
docker compose --profile "$PROFILE" up --detach --build --remove-orphans
GUARDMCP_PROFILE="$PROFILE" \
  GMCP30_STARTED_AT_EPOCH="$gmcp30_started_at_epoch" \
  "$ROOT_DIR/scripts/compose-readiness.sh"
