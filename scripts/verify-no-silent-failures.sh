#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-no-silent-failures.sh
#
# Detects silent failure patterns in server and client TypeScript code:
#
#   1. .catch(() => {}) — promise errors silently swallowed with no logging
#   2. .catch(() => undefined/null) — promise errors returned as falsy values
#   3. catch(e){} — empty try/catch blocks
#   4. .catch(() => { \n }) — multi-line empty catch
#
# Patterns that are NOT flagged (legitimate):
#   - .catch(() => fallbackValue) where fallback is a string, statusText, etc.
#   - catch(err) { /* body with actual handling */ }
#   - Suppressed lines via guard-ignore / guard-ignore-next-line comments
#
# Suppression:
#   // guard-ignore-next-line: no-silent-failures reason="fire-and-forget cleanup"
#   // guard-ignore: no-silent-failures reason="best-effort flush"
#
# Suppress format: $(format_suppression no-silent-failures)
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="no-silent-failures"
GUARD_NAME="No Silent Failures"

source "$SCRIPT_DIR/lib/guard-utils.sh"

VIOLATIONS=0
VIOLATION_KEYS=""

# Track unique files scanned across all patterns.
declare -A SEEN_FILES

emit_header "$GUARD_NAME"

# ── File-level suppression helper ────────────────────────────────────────────
# Usage: is_file_suppressed <file>
# Returns 0 if suppressed, 1 if not.
is_file_suppressed() {
  local file="$1"
  local first_line
  first_line=$(sed -n '1p' "$file" 2>/dev/null || echo "")
  if echo "$first_line" | grep -qE "guard-ignore-file:\s*${GUARD_ID}\s+reason=\"[^\"]+\""; then
    return 0
  fi
  return 1
}

# ── Pattern scan helper ───────────────────────────────────────────────────────
# Emit a violation and record its key for baseline diffing.
# Usage: record_violation <rel_path> <lineno> <message>
record_violation() {
  local rel_path="$1"
  local lineno="$2"
  local message="$3"
  local key="${rel_path}:${lineno}:${message}"
  emit_violation "$GUARD_ID" "warning" "$rel_path" "$lineno" \
    "$message" \
    "Log the error or add a suppression comment: $(format_suppression $GUARD_ID | head -1)"
  VIOLATIONS=$((VIOLATIONS + 1))
  VIOLATION_KEYS="${VIOLATION_KEYS}${key}
"
}

# ── Pattern 1: .catch(() => {}) — swallowed promise errors ──────────────────

while IFS=: read -r file lineno line_content; do
  [ -z "$file" ] && continue
  SEEN_FILES["$file"]=1

  if is_file_suppressed "$file" || is_suppressed "$file" "$lineno" "$GUARD_ID"; then
    continue
  fi

  rel_path="${file#$ROOT_DIR/}"
  record_violation "$rel_path" "$lineno" "Swallowed promise error: .catch(() => {})"
done < <(grep -rnE '\.catch\(\s*\(\)\s*=>\s*\{\s*\}\)' \
           "$ROOT_DIR/server" "$ROOT_DIR/client/src" \
           --include='*.ts' --include='*.tsx' 2>/dev/null || true)

# ── Pattern 2: .catch(() => undefined) or .catch(() => null) ────────────────

while IFS=: read -r file lineno line_content; do
  [ -z "$file" ] && continue
  SEEN_FILES["$file"]=1

  if is_file_suppressed "$file" || is_suppressed "$file" "$lineno" "$GUARD_ID"; then
    continue
  fi

  rel_path="${file#$ROOT_DIR/}"
  record_violation "$rel_path" "$lineno" "Swallowed promise error: .catch(() => undefined/null)"
done < <(grep -rnE '\.catch\(\s*\(\)\s*=>\s*(undefined|null)\s*\)' \
           "$ROOT_DIR/server" "$ROOT_DIR/client/src" \
           --include='*.ts' --include='*.tsx' 2>/dev/null || true)

# ── Pattern 3: catch(e){} — empty try/catch ─────────────────────────────────

while IFS=: read -r file lineno line_content; do
  [ -z "$file" ] && continue
  SEEN_FILES["$file"]=1

  if is_file_suppressed "$file" || is_suppressed "$file" "$lineno" "$GUARD_ID"; then
    continue
  fi

  rel_path="${file#$ROOT_DIR/}"
  record_violation "$rel_path" "$lineno" "Empty catch block — error silently discarded"
done < <(grep -rnE 'catch\s*\([^)]*\)\s*\{\s*\}' \
           "$ROOT_DIR/server" "$ROOT_DIR/client/src" \
           --include='*.ts' --include='*.tsx' 2>/dev/null || true)

# ── Pattern 4: .catch(() => { with multi-line empty body ────────────────────
# Catches the pattern where .catch(() => { appears on one line and }) on the
# next, with nothing in between.

while IFS=: read -r file lineno line_content; do
  [ -z "$file" ] && continue
  SEEN_FILES["$file"]=1

  # Check that the next line is just }) — if it has content, this is a real
  # handler body, not empty.
  next_lineno=$((lineno + 1))
  next_line=$(sed -n "${next_lineno}p" "$file" 2>/dev/null || true)
  if ! echo "$next_line" | grep -qE '^\s*\}\s*\)\s*;?\s*$'; then
    continue
  fi

  if is_file_suppressed "$file" || is_suppressed "$file" "$lineno" "$GUARD_ID"; then
    continue
  fi

  rel_path="${file#$ROOT_DIR/}"
  record_violation "$rel_path" "$lineno" "Swallowed promise error: .catch(() => { with empty body"
done < <(grep -rnE '\.catch\(\s*\(\)\s*=>\s*\{\s*$' \
           "$ROOT_DIR/server" "$ROOT_DIR/client/src" \
           --include='*.ts' --include='*.tsx' 2>/dev/null || true)

FILES_SCANNED=${#SEEN_FILES[@]}

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

exit_code=$(check_expiring_baseline "$GUARD_ID" "$VIOLATION_KEYS")
exit "$exit_code"
