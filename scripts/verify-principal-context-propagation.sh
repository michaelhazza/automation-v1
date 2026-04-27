#!/usr/bin/env bash
set -euo pipefail

# Gate: Every `canonicalDataService.<method>(` invocation must pass a
# PrincipalContext-shaped first argument (call-site granularity, A1b).
#
# Accepted first-argument shapes (PASS):
#   - fromOrgId(...)               — explicit migration shim constructor
#   - withPrincipalContext(...)    — wrap helper called inline
#   - An identifier whose assignment / type annotation in the same file is:
#       const <ident> = fromOrgId(...)
#       const <ident> = withPrincipalContext(...)
#       const <ident>: PrincipalContext = ...
#       <ident>: PrincipalContext        (function-parameter annotation)
#
# Rejected (VIOLATION):
#   - Bare object literal `{ ... }`
#   - Spread expression `...`
#   - Identifier with no traceable PrincipalContext source in the file
#
# File-level exemption:
#   `// @principal-context-import-only — reason: <one-sentence>` at top of file.
#
# Tests in `__tests__/` are exempt. The service file itself
# (`canonicalDataService.ts`) is exempt.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="principal-context-propagation"
GUARD_NAME="Principal Context Propagation (call-site)"

source "$SCRIPT_DIR/lib/guard-utils.sh"

VIOLATIONS=0
FILES_SCANNED=0

emit_header "$GUARD_NAME"

# ── Identify candidate files ────────────────────────────────────────────────
# Files that import or reference canonicalDataService, excluding tests, the
# service file, and fixtures.
candidate_files=$(grep -rl 'canonicalDataService' "$ROOT_DIR/server/" --include="*.ts" 2>/dev/null \
  | grep -v "canonicalDataService.ts" \
  | grep -v "__tests__" \
  || true)

# Returns 0 if file declares the import-only annotation in its first 20 lines.
has_import_only_annotation() {
  local file="$1"
  head -n 20 "$file" 2>/dev/null \
    | grep -qE '@principal-context-import-only[[:space:]]*—[[:space:]]*reason:[[:space:]]*\S'
}

# Returns 0 if the file contains a same-file declaration that types <ident>
# as PrincipalContext (or assigns it from fromOrgId / withPrincipalContext).
# Usage: ident_is_typed_principal <file> <ident>
ident_is_typed_principal() {
  local file="$1"
  local ident="$2"
  # Sanity: must be a plain JS identifier.
  if ! [[ "$ident" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    return 1
  fi
  # 1. Function-parameter annotation: `<ident>: PrincipalContext`
  if grep -qE "(^|[^A-Za-z0-9_])${ident}[[:space:]]*:[[:space:]]*PrincipalContext\b" "$file"; then
    return 0
  fi
  # 2. const-assignment from fromOrgId / withPrincipalContext.
  if grep -qE "(^|[^A-Za-z0-9_])(const|let|var)[[:space:]]+${ident}[[:space:]]*(:[[:space:]]*PrincipalContext)?[[:space:]]*=[[:space:]]*(fromOrgId|withPrincipalContext)\b" "$file"; then
    return 0
  fi
  return 1
}

# Classify a first-argument expression. Echoes 'pass' or 'violation:<reason>'.
# Usage: classify_first_arg <file> <first_arg_text>
classify_first_arg() {
  local file="$1"
  local first_arg="$2"
  # Trim leading/trailing whitespace.
  first_arg="${first_arg#"${first_arg%%[![:space:]]*}"}"
  first_arg="${first_arg%"${first_arg##*[![:space:]]}"}"

  # Empty arg list (e.g. countSomething()) — ignore.
  if [ -z "$first_arg" ]; then
    echo "pass"
    return
  fi

  # Spread expression: starts with '...'.
  if [[ "$first_arg" == ...* ]]; then
    echo "violation:spread expression"
    return
  fi

  # Object literal: starts with '{'.
  if [[ "$first_arg" == \{* ]]; then
    echo "violation:object literal"
    return
  fi

  # Inline constructor calls.
  if [[ "$first_arg" == fromOrgId\(* ]] \
     || [[ "$first_arg" == fromOrgId\<* ]] \
     || [[ "$first_arg" == withPrincipalContext\(* ]]; then
    echo "pass"
    return
  fi

  # Bare identifier — strip optional trailing punctuation (comma) and check.
  local ident="${first_arg%%,*}"
  ident="${ident%%[[:space:])]*}"
  if [[ "$ident" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    if ident_is_typed_principal "$file" "$ident"; then
      echo "pass"
      return
    fi
    echo "violation:identifier '$ident' has no PrincipalContext annotation or fromOrgId/withPrincipalContext assignment in same file"
    return
  fi

  echo "violation:unrecognised first-argument shape: ${first_arg:0:80}"
}

# Process one file: scan every canonicalDataService.<method>( invocation and
# classify the first argument.
scan_file() {
  local file="$1"
  FILES_SCANNED=$((FILES_SCANNED + 1))

  if has_import_only_annotation "$file"; then
    return
  fi

  # Concatenate the file into a single line (newlines -> space) so we can
  # capture the first argument even when the call spans multiple lines.
  # Then split back by call-site so we can locate the line number for each.
  local total_lines
  total_lines=$(wc -l < "$file")
  if [ "$total_lines" -eq 0 ]; then
    return
  fi

  # Find every occurrence (with line number) of `canonicalDataService.<method>(`
  # via grep -n. For each, read enough subsequent lines (until the matching
  # closing paren of the FIRST argument) to extract the first argument.
  while IFS= read -r match_line; do
    [ -z "$match_line" ] && continue
    local lineno="${match_line%%:*}"
    local _rest="${match_line#*:}"

    # Reassemble starting from the match line: read the file from $lineno to
    # $lineno+10 and join into a single string.
    local end_lineno=$((lineno + 10))
    local joined
    joined=$(sed -n "${lineno},${end_lineno}p" "$file" | tr '\n' ' ')

    # Strip everything up to and including the first `canonicalDataService.<method>(`.
    # Use sed to anchor on the first occurrence.
    local after
    after=$(printf '%s' "$joined" | sed -E 's/^.*canonicalDataService\.[A-Za-z_][A-Za-z0-9_]*\(//')

    # Now `after` begins with the first-argument expression. Read until the
    # depth-0 comma or closing paren. Track ( ) [ ] { } depth.
    local first_arg=""
    local depth=0
    local i=0
    local len=${#after}
    while [ "$i" -lt "$len" ]; do
      local ch="${after:$i:1}"
      if [ "$depth" -eq 0 ]; then
        if [ "$ch" = "," ] || [ "$ch" = ")" ]; then
          break
        fi
      fi
      case "$ch" in
        '(' | '[' | '{') depth=$((depth + 1)) ;;
        ')' | ']' | '}') depth=$((depth - 1)) ;;
      esac
      first_arg="${first_arg}${ch}"
      i=$((i + 1))
    done

    local verdict
    verdict=$(classify_first_arg "$file" "$first_arg")
    if [ "${verdict%%:*}" = "violation" ]; then
      local reason="${verdict#violation:}"
      is_suppressed "$file" "$lineno" "$GUARD_ID" && continue
      emit_violation "$GUARD_ID" "error" "$file" "$lineno" \
        "canonicalDataService call: $reason" \
        "Pass fromOrgId(orgId[, subaccountId]), withPrincipalContext(...), or a PrincipalContext-typed local"
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  done < <(grep -nE 'canonicalDataService\.[A-Za-z_][A-Za-z0-9_]*\(' "$file" || true)
}

if [ -n "$candidate_files" ]; then
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    scan_file "$f"
  done <<< "$candidate_files"
fi

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

exit_code=$(check_baseline "$GUARD_ID" "$VIOLATIONS" 1)
exit "$exit_code"
