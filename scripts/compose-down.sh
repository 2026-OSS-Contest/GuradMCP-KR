#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${GUARDMCP_PROFILE:-demo}"

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  printf '%s\n' 'Docker Compose v2 is required.' >&2
  exit 69
fi

case "${1:-}" in
  "") extra=() ;;
  --volumes) extra=(--volumes) ;;
  *) printf 'Usage: %s [--volumes]\n' "${0##*/}" >&2; exit 64 ;;
esac

cd "$ROOT_DIR"
docker compose --profile "$PROFILE" down --remove-orphans "${extra[@]}"

