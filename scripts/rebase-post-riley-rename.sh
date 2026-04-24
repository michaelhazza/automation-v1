#!/usr/bin/env bash
# Rebase helper for branches that forked before the Riley Observations W1 rename lands.
# Sequence:
#   (a) fetch + merge origin/main  — pulls in the rename commits
#   (b) run the codemod            — mechanically renames surviving references
#   (c) build to surface unresolved imports
#   (d) print a punch list of remaining manual conflicts
#
# Usage:
#   ./scripts/rebase-post-riley-rename.sh [--dry-run]
#
# --dry-run: runs steps a + b in dry-run mode, skips build, prints what would change.
#
# Plan §4.5.

set -euo pipefail
DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then DRY_RUN=1; fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "==> Riley W1 post-merge rebase helper"
echo ""

# (a) Merge main
echo "==> Step 1: fetching origin..."
git fetch origin
echo "==> Step 2: merging origin/main..."
if [[ $DRY_RUN -eq 1 ]]; then
  echo "[dry-run] would run: git merge origin/main --no-edit"
else
  git merge origin/main --no-edit || {
    echo ""
    echo "MERGE CONFLICT — resolve conflicts, then re-run this script."
    exit 1
  }
fi

echo ""

# (b) Run codemod
if [[ $DRY_RUN -eq 1 ]]; then
  echo "==> Step 3: codemod dry-run..."
  npx tsx scripts/codemod-riley-rename.ts --dry-run
else
  echo "==> Step 3: applying codemod..."
  npx tsx scripts/codemod-riley-rename.ts
fi

echo ""

# (c) Build to surface unresolved imports
if [[ $DRY_RUN -eq 1 ]]; then
  echo "==> Step 4: [dry-run] skipping build"
else
  echo "==> Step 4: building to surface unresolved imports..."
  npm run build:server 2>&1 | grep -E 'error TS|Cannot find' | head -30 || true
fi

echo ""

# (d) Punch list
echo "==> Step 5: punch list — remaining manual review items:"
grep -rn 'playbook_\|Playbook\|PLAYBOOK' server/ client/ \
  --include='*.ts' --include='*.tsx' \
  | grep -v 'migrations/' | grep -v 'tasks/' | grep -v 'docs/' \
  | head -20 \
  && echo "(see full list: grep -rn 'playbook_|Playbook' server/ client/ ...)" \
  || echo "  None found — codemod is complete."

echo ""
echo "==> Done."
echo "    Next: resolve any remaining hits above, run npm run build:server, then push."
