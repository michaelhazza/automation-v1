#!/usr/bin/env bash
# verify-no-do-references.sh — CI gate for DigitalOcean retirement (Chunk 17).
#
# Asserts that no DigitalOcean-substrate references remain in live code.
# References are: provider names, env-var prefixes, or infrastructure terms
# (droplet, VPS) that imply a DO compute dependency.
#
# Historical spec and decision documents are excluded — they preserve the
# rationale for the migration, not live substrate config.
#
# Exit codes (per gate convention):
#   0 — all checks pass
#   1 — one or more violations detected (blocking)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

FAIL=0

# ── Excluded paths ─────────────────────────────────────────────────────────────
# These paths are intentionally excluded from the token scan. Each exclusion
# has a rationale.
#
#   tasks/              — build artefacts and audit trail; references are
#                         historical record, not live substrate
#   docs/decisions/     — ADR archive; preserves the decision to retire DO
#   tasks/review-logs/  — review log artefacts; not live code
#   KNOWLEDGE.md        — lessons / history log; not live substrate
#   .git/               — git internals; not source
#   node_modules/       — third-party packages; not our code
#   .worktrees/         — parallel development git worktrees; not main tree
#
#   docs/iee-development-spec.md              — original IEE spec that
#     describes the DO VPS rollout plan written before the e2b migration;
#     preserved as historical specification context
#   docs/agent-cloud-compute-dev-brief.md     — competitive brief that uses
#     "VPS" in generic market-context prose (OpenClaw references), not as
#     a live infrastructure dependency
#   docs/agent-orchestration-hitl-reference.md — brief that references
#     Docker/VPS in generic capability-planning prose, not live substrate
#   docs/hitl-platform-dev-brief-v3.md        — brief that references
#     Docker/VPS in generic phase-planning prose, not live substrate
#   scripts/gates/verify-no-do-references.sh  — this script; contains the
#     forbidden tokens as grep pattern strings, not substrate references

EXCLUDE_ARGS=(
  --exclude-dir=".git"
  --exclude-dir="node_modules"
  --exclude-dir=".worktrees"
  --exclude-dir="tasks"
  --exclude-dir="decisions"
  --exclude="KNOWLEDGE.md"
)

is_allowed_path() {
  local file="$1"
  # Strip ROOT_DIR prefix for comparison
  local rel="${file#$ROOT_DIR/}"
  case "$rel" in
    tasks/*)                                   return 0 ;;
    docs/decisions/*)                          return 0 ;;
    tasks/review-logs/*)                       return 0 ;;
    KNOWLEDGE.md)                              return 0 ;;
    docs/iee-development-spec.md)              return 0 ;;
    docs/agent-cloud-compute-dev-brief.md)     return 0 ;;
    docs/agent-orchestration-hitl-reference.md) return 0 ;;
    docs/hitl-platform-dev-brief-v3.md)        return 0 ;;
    scripts/gates/verify-no-do-references.sh)  return 0 ;;
    .git/*)                                    return 0 ;;
    node_modules/*)                            return 0 ;;
    .worktrees/*)                              return 0 ;;
    *)                                         return 1 ;;
  esac
}

# ── Check 1: forbidden token scan ─────────────────────────────────────────────
# Each pattern is a DO-substrate indicator. The gate fails if any match is found
# in a non-excluded file.

declare -A FORBIDDEN_TOKENS=(
  ["DigitalOcean"]="Provider name reference"
  ["digitalocean"]="Provider name reference (lowercase)"
  ["digital_ocean"]="Provider name reference (underscore variant)"
  ["DO_VPS"]="DO VPS env-var prefix"
  ["DO_DROPLET"]="DO Droplet env-var prefix"
)

for token in "${!FORBIDDEN_TOKENS[@]}"; do
  while IFS= read -r match_file; do
    [ -z "$match_file" ] && continue
    if ! is_allowed_path "$match_file"; then
      echo "[FAIL] DO-substrate token '${token}' found in: $match_file"
      echo "       Reason: ${FORBIDDEN_TOKENS[$token]}"
      FAIL=1
    fi
  done < <(
    grep -rl "$token" \
      "${EXCLUDE_ARGS[@]}" \
      "$ROOT_DIR" 2>/dev/null || true
  )
done

# Case-insensitive scan for "droplet" (DO Droplet — not a common word in other contexts)
while IFS= read -r match_file; do
  [ -z "$match_file" ] && continue
  if ! is_allowed_path "$match_file"; then
    echo "[FAIL] DO-substrate token 'droplet' (case-insensitive) found in: $match_file"
    FAIL=1
  fi
done < <(
  grep -ril "droplet" \
    "${EXCLUDE_ARGS[@]}" \
    "$ROOT_DIR" 2>/dev/null || true
)

# Word-boundary scan for VPS (uppercase) — short token, must be whole word to
# avoid false positives on path segments.
while IFS= read -r match_file; do
  [ -z "$match_file" ] && continue
  if ! is_allowed_path "$match_file"; then
    echo "[FAIL] DO-substrate token '\\bVPS\\b' found in: $match_file"
    FAIL=1
  fi
done < <(
  grep -rlE "\bVPS\b" \
    "${EXCLUDE_ARGS[@]}" \
    "$ROOT_DIR" 2>/dev/null || true
)

# Word-boundary scan for vps (lowercase)
while IFS= read -r match_file; do
  [ -z "$match_file" ] && continue
  if ! is_allowed_path "$match_file"; then
    echo "[FAIL] DO-substrate token '\\bvps\\b' found in: $match_file"
    FAIL=1
  fi
done < <(
  grep -rlE "\bvps\b" \
    "${EXCLUDE_ARGS[@]}" \
    "$ROOT_DIR" 2>/dev/null || true
)

# ── Check 2: deleted DO worker files must not exist ────────────────────────────
# These six files were the DigitalOcean VPS worker code paths and were deleted
# as part of the DO retirement (Chunk 17). If they reappear (e.g. a bad merge
# or accidental restore), this gate catches it immediately.

DELETED_FILES=(
  "worker/Dockerfile"
  "worker/src/handlers/browserTask.ts"
  "worker/src/handlers/runHandler.ts"
  "worker/src/handlers/cleanupOrphans.ts"
  "worker/src/runtime/queueMetrics.ts"
  "worker/src/runtime/cost.ts"
)

for f in "${DELETED_FILES[@]}"; do
  if [ -f "$ROOT_DIR/$f" ]; then
    echo "[FAIL] DO worker file that should have been deleted still exists: $f"
    FAIL=1
  fi
done

# ── Result ────────────────────────────────────────────────────────────────────

if [ $FAIL -eq 0 ]; then
  echo "[PASS] verify-no-do-references: no DigitalOcean substrate references found"
  exit 0
else
  exit 1
fi
