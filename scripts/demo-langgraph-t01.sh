#!/usr/bin/env bash
# GMCP-95 — the T-01 scenario run from the Python LangGraph agent, as a check rather
# than a script whose output you have to read.
#
# Asserts the same difference the Kotlin demo asserts, from a different ecosystem:
# pointed at the gateway the chain stops at read_file under block_env_file_read and
# send_email is never asked; pointed straight at the tool server it completes.
#
# The agent code is identical across both runs — only the endpoint URL differs, which
# is the onboarding claim this example exists to demonstrate.
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/apps/demo-agent/langgraph"
PYTHON="${PYTHON:-python3}"
GATEWAY_URL="${GATEWAY_URL:-http://localhost:3001}"
TOOLS_URL="${TOOLS_URL:-http://localhost:3003}"

fail() { printf '\n실패: %s\n' "$1" >&2; exit 1; }

if [ ! -d "$APP_DIR/.pydeps" ]; then
  printf '의존성을 %s/.pydeps 에 설치합니다...\n' "$APP_DIR"
  "$PYTHON" -m pip install -q --disable-pip-version-check --target "$APP_DIR/.pydeps" langgraph \
    || fail "langgraph 설치에 실패했습니다. PYTHON 환경변수로 다른 인터프리터를 지정해 보세요."
fi

run_mode() {
  ( cd "$APP_DIR" && PYTHONPATH=".pydeps:." "$PYTHON" -m guardmcp_langgraph --mode "$1" --endpoint "$2" )
}

printf '\n=== 적용 (게이트웨이 경유: %s) ===\n' "$GATEWAY_URL"
guarded_output="$(run_mode guarded "$GATEWAY_URL")" || fail "게이트웨이 경유 실행이 0이 아닌 코드로 끝났습니다.\n$guarded_output"
printf '%s\n' "$guarded_output"

grep -q 'block_env_file_read' <<<"$guarded_output" \
  || fail "차단 근거로 block_env_file_read 가 보고되지 않았습니다."
grep -q '\[차단\] read_file' <<<"$guarded_output" \
  || fail "1단계 read_file 이 차단되지 않았습니다."
grep -q 'send_email' <<<"$guarded_output" \
  && fail "2단계 send_email 이 시도됐습니다 — 체인이 1단계에서 멈추지 않았습니다."

printf '\n=== 미적용 (도구 서버 직접: %s) ===\n' "$TOOLS_URL"
if vulnerable_output="$(run_mode vulnerable "$TOOLS_URL")"; then
  printf '%s\n' "$vulnerable_output"
  # Without this the guarded result proves nothing: a chain that fails for unrelated
  # reasons would also "not leak".
  grep -q '\[실행\] send_email' <<<"$vulnerable_output" \
    || fail "미적용 경로가 send_email 까지 도달하지 않아 대조가 성립하지 않습니다."
else
  fail "미적용 실행이 실패했습니다.\n$vulnerable_output"
fi

printf '\n통과: 같은 에이전트 코드가 엔드포인트만 바꿔 한쪽에서만 차단됐습니다.\n'
