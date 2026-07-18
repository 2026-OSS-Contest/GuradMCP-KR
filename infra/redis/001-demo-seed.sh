#!/bin/sh
set -eu

redis-cli -h redis -p 6379 SET guardmcp:seed:version guardmcp-demo-v1 >/dev/null
redis-cli -h redis -p 6379 HSET guardmcp:runtime \
  mode deterministic \
  default_policy_pack default \
  korean_pii_policy_pack korean-pii >/dev/null
redis-cli -h redis -p 6379 DEL guardmcp:approval:queue >/dev/null
redis-cli -h redis -p 6379 RPUSH guardmcp:approval:queue \
  20000000-0000-4000-8000-000000000001 >/dev/null

printf '%s\n' 'Redis deterministic seed guardmcp-demo-v1 applied.'

