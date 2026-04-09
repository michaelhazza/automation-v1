#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-no-silent-failures.sh
#
# Detects silent failure patterns in server TypeScript code:
#
#   1. .catch(() => {}) — promise errors silently swallowed with no logging
#   2. .catch(() => undefined/null) — promise errors returned as falsy values
#   3. catch(e){} — empty try/catch blocks (in .ts files, not inline JS)
#
# Patterns that are NOT flagged (legitimate):
#   - .catch(() => fallbackValue) where fallback is a string, statusText, etc.
#   - catch(err) { /* body with actual handling */ }
#   - Suppressed lines via guard-ignore / guard-ignore-next-line comments
#
# Suppression:
#   // guard-ignore-next-line: no-silent-failures reason="fire-and-forget cleanup"
#   // guard-ignore: no-silent-failures reason="best-effort flush"
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="no-silent-failures"
GUARD_NAME="No Silent Failures"

source "$SCRIPT_DIR/lib/guard-utils.sh"

VIOLATIONS=0
FILES_SCANNED=0

emit_header "$GUARD_NAME"

# ── Pattern 1: .catch(() => {}) — swallowed promise errors ──────────────────
# Matches .catch(() => {}) and .catch(() => { }) with optional whitespace.
# These discard errors silently. The fix is to either log or rethrow.

while IFS=: read -r file lineno line_content; do
  [ -z "$file" ] && continue
  FILES_SCANNED=$((FILES_SCANNED + 1))

  if is_suppressed "$file" "$lineno" "$GUARD_ID"; then
    continue
  fi

  rel_path="${file#$ROOT_DIR/}"
  emit_violation "$GUARD_ID" "warning" "$rel_path" "$lineno" \
    "Swallowed promise error: .catch(() => {})" \
    "Log the error or add a suppression comment with reason (e.g. fire-and-forget cleanup)."
  VIOLATIONS=$((VIOLATIONS + 1))
done < <(grep -rnE '\.catch\(\s*\(\)\s*=>\s*\{\s*\}\)' "$ROOT_DIR/server" --include='*.ts' 2>/dev/null || true)

# ── Pattern 2: .catch(() => undefined) or .catch(() => null) ────────────────
# Returns a falsy value, hiding the error from the caller.

while IFS=: read -r file lineno line_content; do
  [ -z "$file" ] && continue
  FILES_SCANNED=$((FILES_SCANNED + 1))

  if is_suppressed "$file" "$lineno" "$GUARD_ID"; then
    continue
  fi

  rel_path="${file#$ROOT_DIR/}"
  emit_violation "$GUARD_ID" "warning" "$rel_path" "$lineno" \
    "Swallowed promise error: .catch(() => undefined/null)" \
    "Log the error or add a suppression comment with reason."
  VIOLATIONS=$((VIOLATIONS + 1))
done < <(grep -rnE '\.catch\(\s*\(\)\s*=>\s*(undefined|null)\s*\)' "$ROOT_DIR/server" --include='*.ts' 2>/dev/null || true)

# ── Pattern 3: catch(e){} — empty try/catch ─────────────────────────────────
# Only in .ts files directly under server/ (not in template strings).
# We look for catch(<var>){} on a single line with nothing between braces.

while IFS=: read -r file lineno line_content; do
  [ -z "$file" ] && continue
  FILES_SCANNED=$((FILES_SCANNED + 1))

  if is_suppressed "$file" "$lineno" "$GUARD_ID"; then
    continue
  fi

  # Skip if this line is inside a template literal / inline <script> block.
  # Heuristic: look for an opening backtick on any line above (within 50 lines)
  # that hasn't been closed. This catches empty catches in inline browser JS
  # embedded in template literals (e.g. pageServing.ts tracking script).
  start_ctx=$((lineno > 50 ? lineno - 50 : 1))
  local_context=$(sed -n "${start_ctx},${lineno}p" "$file" 2>/dev/null || true)
  # Count backticks — odd count means we're inside a template literal.
  backtick_count=$(echo "$local_context" | tr -cd '`' | wc -c)
  if [ "$((backtick_count % 2))" -eq 1 ]; then
    # Inside a template literal — skip.
    continue
  fi

  rel_path="${file#$ROOT_DIR/}"
  emit_violation "$GUARD_ID" "warning" "$rel_path" "$lineno" \
    "Empty catch block — error silently discarded" \
    "Log the error, rethrow it, or add a suppression comment with reason."
  VIOLATIONS=$((VIOLATIONS + 1))
done < <(grep -rnE 'catch\s*\([^)]*\)\s*\{\s*\}' "$ROOT_DIR/server" --include='*.ts' 2>/dev/null || true)

# ── Pattern 4: .catch(() => { with multi-line empty body ────────────────────
# Catches the pattern where .catch(() => { appears on one line and }) on the
# next, with nothing in between. This is the multi-line variant of pattern 1.

while IFS=: read -r file lineno line_content; do
  [ -z "$file" ] && continue

  # Check if the NEXT line is just }) or });
  next_lineno=$((lineno + 1))
  next_line=$(sed -n "${next_lineno}p" "$file" 2>/dev/null || true)
  if ! echo "$next_line" | grep -qE '^\s*\}\s*\)\s*;?\s*$'; then
    # Next line has content — this is a real handler, not empty.
    continue
  fi

  # Check the line AFTER }) for content too — sometimes there's a comment
  # between .catch(() => { and }).
  FILES_SCANNED=$((FILES_SCANNED + 1))

  if is_suppressed "$file" "$lineno" "$GUARD_ID"; then
    continue
  fi

  rel_path="${file#$ROOT_DIR/}"
  emit_violation "$GUARD_ID" "warning" "$rel_path" "$lineno" \
    "Swallowed promise error: .catch(() => { with empty body" \
    "Log the error or add a suppression comment with reason."
  VIOLATIONS=$((VIOLATIONS + 1))
done < <(grep -rnE '\.catch\(\s*\(\)\s*=>\s*\{\s*$' "$ROOT_DIR/server" --include='*.ts' 2>/dev/null || true)

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

exit_code=$(check_baseline "$GUARD_ID" "$VIOLATIONS" 2)
exit "$exit_code"
