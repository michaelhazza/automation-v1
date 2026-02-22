#!/usr/bin/env bash
set -euo pipefail

# Validates JWT authentication readiness across spec artifacts for Automation OS

classify_and_exit() {
  local severity=$1
  local message=$2
  case $severity in
    OK|PASS) echo "$message"; exit 0 ;;
    BLOCKING) echo "[BLOCKING] $message"; exit 1 ;;
    WARNING|WARN) echo "[WARNING] $message"; exit 2 ;;
    INFO) echo "[INFO] $message"; exit 3 ;;
    *) echo "[ERROR] Unknown severity: $severity"; exit 1 ;;
  esac
}

SERVICE="docs/service-contracts.json"
ENV="docs/env-manifest.json"

for f in "$SERVICE" "$ENV"; do
  if [ ! -f "$f" ]; then
    classify_and_exit BLOCKING "Required spec file not found: $f"
  fi
done

# All protected endpoints must list 'authenticate' in middleware
PROTECTED_MISSING_MIDDLEWARE=$(jq '
  [.endpoints[] |
    select(.authentication == "required" and
           ((.middleware // []) | index("authenticate") == null))
  ] | length' "$SERVICE")
if [ "$PROTECTED_MISSING_MIDDLEWARE" -gt 0 ]; then
  classify_and_exit BLOCKING "$PROTECTED_MISSING_MIDDLEWARE protected endpoints missing 'authenticate' in middleware array"
fi

# All public endpoints must NOT have 'authenticate' in middleware
PUBLIC_HAS_MIDDLEWARE=$(jq '
  [.endpoints[] |
    select(.authentication == "public" and
           ((.middleware // []) | index("authenticate") != null))
  ] | length' "$SERVICE")
if [ "$PUBLIC_HAS_MIDDLEWARE" -gt 0 ]; then
  classify_and_exit BLOCKING "$PUBLIC_HAS_MIDDLEWARE public endpoints incorrectly have 'authenticate' middleware"
fi

# Verify login endpoint exists and is public
LOGIN_COUNT=$(jq '[.endpoints[] | select(.path == "/api/auth/login" and .method == "POST" and .authentication == "public")] | length' "$SERVICE")
if [ "$LOGIN_COUNT" -eq 0 ]; then
  classify_and_exit BLOCKING "POST /api/auth/login with authentication:public not found in service-contracts"
fi

# Verify invite/accept endpoint exists for invite-only onboarding
ACCEPT_COUNT=$(jq '[.endpoints[] | select(.path == "/api/auth/invite/accept" and .method == "POST")] | length' "$SERVICE")
if [ "$ACCEPT_COUNT" -eq 0 ]; then
  classify_and_exit BLOCKING "POST /api/auth/invite/accept not found (required for invite_only onboarding)"
fi

# Verify JWT_SECRET in env-manifest
JWT_COUNT=$(jq '[.variables[] | select(.name == "JWT_SECRET" and .required == true)] | length' "$ENV")
if [ "$JWT_COUNT" -eq 0 ]; then
  classify_and_exit BLOCKING "JWT_SECRET with required:true not found in env-manifest"
fi

PROTECTED_COUNT=$(jq '[.endpoints[] | select(.authentication == "required")] | length' "$SERVICE")
PUBLIC_COUNT=$(jq '[.endpoints[] | select(.authentication == "public")] | length' "$SERVICE")

classify_and_exit OK "Authentication readiness confirmed. $PROTECTED_COUNT protected, $PUBLIC_COUNT public endpoints. Login + invite/accept present. JWT_SECRET declared."
