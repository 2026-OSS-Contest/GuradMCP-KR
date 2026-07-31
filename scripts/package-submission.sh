#!/usr/bin/env bash
# Collect final-submission artifacts (GMCP-48) into artifacts/submission/.
# Copies only what already exists; missing optional deliverables are
# reported as warnings instead of failing the run.
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-$ROOT_DIR/artifacts/submission}"

cd "$ROOT_DIR"

mkdir -p "$OUT_DIR"

missing=()

copy_if_exists() {
  local src="$1" dest_name="$2"
  if [ -e "$src" ]; then
    cp -R "$src" "$OUT_DIR/$dest_name"
    printf 'collected: %s -> %s\n' "$src" "$dest_name"
  else
    missing+=("$src")
  fi
}

# 1. Source archive at the current HEAD.
git archive --format=tar.gz --output "$OUT_DIR/source.tar.gz" HEAD
printf 'collected: git archive HEAD -> source.tar.gz\n'

# 2. README and license.
copy_if_exists "$ROOT_DIR/README.md" "README.md"
copy_if_exists "$ROOT_DIR/README.en.md" "README.en.md"
copy_if_exists "$ROOT_DIR/LICENSE" "LICENSE"

# 3. Dependency license report (run `npm run license:report` first if missing).
copy_if_exists "$ROOT_DIR/artifacts/licenses" "licenses"

# 4. Demo video, final report, and external reproduction evidence.
copy_if_exists "$ROOT_DIR/docs/submission/demo-video.md" "demo-video.md"
copy_if_exists "$ROOT_DIR/docs/submission/final-report.md" "final-report.md"
copy_if_exists "$ROOT_DIR/docs/submission/reproduction-report.md" "reproduction-report.md"

# 5. Release tag metadata, if the working tree is at a tag.
if tag="$(git describe --tags --exact-match 2>/dev/null)"; then
  printf '%s\n' "$tag" >"$OUT_DIR/RELEASE_TAG.txt"
  printf 'collected: git tag -> RELEASE_TAG.txt (%s)\n' "$tag"
else
  missing+=("git tag (HEAD is not tagged)")
fi

if [ "${#missing[@]}" -gt 0 ]; then
  printf '\nMissing optional deliverables (see docs/submission-checklist.md):\n' >&2
  for item in "${missing[@]}"; do
    printf '  - %s\n' "$item" >&2
  done
fi

printf '\nSubmission artifacts collected in %s\n' "$OUT_DIR"
