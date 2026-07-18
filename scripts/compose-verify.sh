#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  docker compose --profile demo config --quiet
  docker compose --profile dev config --quiet
  printf '%s\n' 'Compose demo/dev profiles are valid (docker compose config).'
else
  python3 infra/validate-compose.py docker-compose.yml
fi

for script in scripts/compose-*.sh infra/redis/*.sh; do
  bash -n "$script"
done
printf '%s\n' 'Compose shell scripts pass bash syntax validation.'

