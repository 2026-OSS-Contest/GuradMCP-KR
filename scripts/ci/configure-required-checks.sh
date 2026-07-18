#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
manifest="$root_dir/.github/required-checks.json"

command -v gh >/dev/null || {
  echo "GitHub CLI (gh) is required." >&2
  exit 1
}
command -v node >/dev/null || {
  echo "Node.js is required." >&2
  exit 1
}

repo="${GH_REPO:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
branch="$(node -e 'console.log(require(process.argv[1]).branch)' "$manifest")"

payload="$(node - "$manifest" <<'NODE'
const config = require(process.argv[2]);
process.stdout.write(JSON.stringify({
    required_status_checks: { strict: config.strict, contexts: config.contexts },
    enforce_admins: true,
    required_pull_request_reviews: {
      dismiss_stale_reviews: true,
      require_code_owner_reviews: false,
      required_approving_review_count: 1,
      require_last_push_approval: false
    },
    restrictions: null,
    required_linear_history: false,
    allow_force_pushes: false,
    allow_deletions: false,
    block_creations: false,
    required_conversation_resolution: true,
    lock_branch: false,
    allow_fork_syncing: true
}));
NODE
)"

# PUT initializes protection on a new repository as well as converging an existing
# branch to the checked-in baseline. Review count and destructive branch operations
# are therefore intentional parts of this repository's trust policy.
gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "repos/$repo/branches/$branch/protection" \
  --input - <<<"$payload"

echo "Configured required checks for $repo:$branch"
node -e 'for (const context of require(process.argv[1]).contexts) console.log(`- ${context}`)' "$manifest"
