#!/usr/bin/env bash
# Lift setup/portable/ to a standalone GitHub repo (Phase B of the framework-standalone-repo spec).
#
# Prerequisite: you have already created an empty GitHub repo (e.g. claude-code-framework).
# This script publishes the contents of setup/portable/ to that repo's main branch
# as a single commit, then tags it with the current FRAMEWORK_VERSION.
#
# Usage:
#   bash scripts/lift-framework-to-standalone-repo.sh <new-repo-url>
#
# Example:
#   bash scripts/lift-framework-to-standalone-repo.sh git@github.com:michaelhazza/claude-code-framework.git
#
# What this does (all idempotent / re-runnable):
#   1. git subtree split -P setup/portable -b <timestamped-branch>   (extract setup/portable/ as standalone history)
#   2. git push <new-repo-url> <split-branch>:main                    (publish to the new repo's main)
#   3. git push <new-repo-url> <split-sha>:refs/tags/v<VERSION>       (tag at FRAMEWORK_VERSION)
#   4. git branch -D <split-branch>                                   (clean up local split branch)
#
# After this completes, see § "Phase C — automation-v1 self-adopts" in
# tasks/builds/framework-standalone-repo/spec.md for the follow-up work.

set -euo pipefail

if [ $# -lt 1 ]; then
  cat <<'EOF'
usage: bash scripts/lift-framework-to-standalone-repo.sh <new-repo-url>

example:
  bash scripts/lift-framework-to-standalone-repo.sh git@github.com:michaelhazza/claude-code-framework.git

prerequisite: create the empty GitHub repo first (one-click in the GitHub UI).
EOF
  exit 1
fi

NEW_REPO_URL="$1"

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "")"
if [ -z "${REPO_ROOT}" ]; then
  echo "ERROR: not inside a git repository"
  exit 1
fi
cd "${REPO_ROOT}"

if [ ! -d "setup/portable" ]; then
  echo "ERROR: setup/portable/ not found at repo root — are you in the automation-v1 clone?"
  exit 1
fi

if [ ! -f "setup/portable/.claude/FRAMEWORK_VERSION" ]; then
  echo "ERROR: setup/portable/.claude/FRAMEWORK_VERSION missing — bundle is incomplete"
  exit 1
fi

VERSION="$(cat setup/portable/.claude/FRAMEWORK_VERSION | tr -d '[:space:]')"
if [ -z "${VERSION}" ]; then
  echo "ERROR: FRAMEWORK_VERSION is empty"
  exit 1
fi

if ! git diff-index --quiet HEAD --; then
  echo "ERROR: working tree has uncommitted changes — commit or stash before lifting"
  echo "       (clean tree required so git subtree split produces a deterministic result)"
  exit 1
fi

SPLIT_BRANCH="framework-export-$(date +%Y%m%d%H%M%S)"

echo ""
echo "Framework lift — automation-v1 setup/portable/  ->  ${NEW_REPO_URL}"
echo "  framework version:  v${VERSION}"
echo "  split branch:       ${SPLIT_BRANCH}"
echo ""

echo "[1/4] git subtree split -P setup/portable -b ${SPLIT_BRANCH}"
git subtree split -P setup/portable -b "${SPLIT_BRANCH}" >/dev/null
SPLIT_SHA="$(git rev-parse "${SPLIT_BRANCH}")"
echo "      split commit: ${SPLIT_SHA}"

echo "[2/4] pushing ${SPLIT_BRANCH} -> ${NEW_REPO_URL}:main"
git push "${NEW_REPO_URL}" "${SPLIT_BRANCH}:main"

echo "[3/4] tagging v${VERSION} on the framework repo"
git push "${NEW_REPO_URL}" "${SPLIT_SHA}:refs/tags/v${VERSION}"

echo "[4/4] cleaning up local split branch"
git branch -D "${SPLIT_BRANCH}" >/dev/null

cat <<EOF

DONE.
  framework repo:  ${NEW_REPO_URL}
  default branch:  main  (at ${SPLIT_SHA:0:12})
  tag:             v${VERSION}

Next — Phase C (automation-v1 self-adopts the framework as a submodule):

  # 1. Add the submodule (replaces the in-repo setup/portable/ as the source of truth).
  git submodule add ${NEW_REPO_URL} .claude-framework
  cd .claude-framework && git checkout v${VERSION} && cd ..

  # 2. Preflight diff (CRITICAL — see spec § 8 step 6.5 before continuing).
  #    Diff each managed file in the deployed tree (.claude/agents/*, docs/decisions/0001-*, etc.)
  #    against the substituted equivalent in setup/portable/ or .claude-framework/.
  #    Classify each diff into:
  #      (a) expected project customisation -> let sync detect and skip via .framework-new
  #      (b) framework drift to backport    -> backport to .claude-framework/ FIRST, push, retag
  #      (c) accidental divergence          -> accept framework version
  #    Skipping this step risks losing internal refinements when --adopt runs.

  # 3. Self-adopt: write the state file recording current per-file hashes.
  node .claude-framework/sync.js --adopt

  # 4. Remove the obsolete in-repo bundle (it now lives in .claude-framework/).
  git rm -rf setup/portable/
  git rm -f scripts/build-portable-framework.ts 2>/dev/null || true
  git rm -f scripts/lift-framework-to-standalone-repo.sh

  # 5. Commit Phase C.
  git add .gitmodules .claude-framework .claude/.framework-state.json
  git commit -m "feat: adopt claude-code-framework as submodule (v${VERSION}); remove in-repo bundle"

  # 6. Verify.
  node .claude-framework/sync.js --check  # exit 0 = clean
  # Open Claude Code, /agents to confirm fleet still loads.

For the full Phase C contract see tasks/builds/framework-standalone-repo/spec.md § 8.
EOF
