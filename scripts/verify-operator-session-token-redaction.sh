#!/usr/bin/env bash
set -euo pipefail

# verify-operator-session-token-redaction.sh
#
# CI gate: prevents NEW files from reading .accessToken / .refreshToken outside
# the established baseline snapshot.
#
# Strategy: baseline snapshot (scripts/.token-read-allowlist.txt) was generated
# at the time the gate was introduced. The gate exits non-zero only when files
# that are NOT in the allowlist start reading these properties. Existing files
# in the allowlist are exempt — the gate does not penalise them.
#
# To add a legitimately new reader: append its path to the allowlist file and
# commit it alongside the code change.
#
# This is CI-only — do NOT run locally during development.
#
# Spec: docs/superpowers/specs/2026-05-11-operator-session-identity-spec.md §17.9

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ALLOWLIST="$ROOT_DIR/scripts/.token-read-allowlist.txt"

if [[ ! -f "$ALLOWLIST" ]]; then
  echo "ERROR: allowlist file not found at $ALLOWLIST" >&2
  echo "Regenerate it with:" >&2
  echo "  grep -rn '\\.accessToken\\b\\|\\.refreshToken\\b' server/ --include='*.ts' -l | sort > scripts/.token-read-allowlist.txt" >&2
  exit 1
fi

# Find all current files reading .accessToken or .refreshToken
# Normalise to relative paths (server/...) so we can compare against the allowlist,
# which is stored as repo-relative paths.
CURRENT_FILES=$(grep -rn "\.accessToken\b\|\.refreshToken\b" "$ROOT_DIR/server/" \
  --include="*.ts" --exclude-dir=node_modules -l 2>/dev/null \
  | sed "s#^$ROOT_DIR/##" \
  | sort || true)

if [[ -z "$CURRENT_FILES" ]]; then
  echo "OK: No accessToken/refreshToken readers found in server/."
  exit 0
fi

# Find files in CURRENT but NOT in allowlist (these are violations).
# Strip any CR characters from the allowlist defensively (allowlist file may be
# checked in with CRLF on Windows clones); grep output is always LF.
NEW_VIOLATIONS=$(comm -23 \
  <(echo "$CURRENT_FILES") \
  <(tr -d '\r' < "$ALLOWLIST" | sort) | \
  grep -v "^$" || true)

if [[ -n "$NEW_VIOLATIONS" ]]; then
  echo "ERROR: New files found reading .accessToken or .refreshToken that are not in the allowlist:" >&2
  echo "$NEW_VIOLATIONS" >&2
  echo "" >&2
  echo "If this is intentional, add the file(s) to scripts/.token-read-allowlist.txt" >&2
  exit 1
fi

echo "OK: No new accessToken/refreshToken readers found outside the established allowlist."
