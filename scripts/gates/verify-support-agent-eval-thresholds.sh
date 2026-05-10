#!/usr/bin/env bash
# CI-only gate. Fetches last 2 support_eval_runs for a target org, calls
# evaluateGateDecision via a tiny Node entry, exits with its code.
#
# Decision logic lives in supportEvalHarnessPure.ts — NOT in this script.
# This script is the thin transport layer only.
#
# Exit codes:
#   0 — pass or fail_open (both are non-blocking; fail_open is logged)
#   1 — fail (both consecutive runs below threshold for the same metric)
#
# Environment:
#   DATABASE_URL   — Postgres connection string (required)
#   EVAL_ORG_ID    — Organisation ID to query (required)

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set" >&2
  exit 1
fi

if [[ -z "${EVAL_ORG_ID:-}" ]]; then
  echo "ERROR: EVAL_ORG_ID is not set" >&2
  exit 1
fi

# Use tsx to run the entry point that fetches rows and calls the pure function
node --import tsx/esm "$(dirname "$0")/../../server/scripts/evalGateRunner.ts"
