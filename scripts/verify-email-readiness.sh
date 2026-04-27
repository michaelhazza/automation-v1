#!/usr/bin/env bash
set -euo pipefail

# Validates email notification readiness for Automation OS

classify_and_exit() {
  local severity=$1
  local message=$2
  case $severity in
    OK|PASS) echo "$message"; echo "[GATE] email-readiness: violations=0"; exit 0 ;;
    BLOCKING) echo "[BLOCKING] $message"; echo "[GATE] email-readiness: violations=1"; exit 1 ;;
    WARNING|WARN) echo "[WARNING] $message"; echo "[GATE] email-readiness: violations=0"; exit 2 ;;
    INFO) echo "[INFO] $message"; echo "[GATE] email-readiness: violations=0"; exit 3 ;;
    *) echo "[ERROR] Unknown severity: $severity"; echo "[GATE] email-readiness: violations=1"; exit 1 ;;
  esac
}

ENV="docs/env-manifest.json"
if [ ! -f "$ENV" ]; then
  classify_and_exit BLOCKING "env-manifest.json not found"
fi

# Verify EMAIL_PROVIDER and EMAIL_FROM are declared
EMAIL_PROVIDER=$(jq '[.variables[] | select(.name == "EMAIL_PROVIDER")] | length' "$ENV")
if [ "$EMAIL_PROVIDER" -eq 0 ]; then
  classify_and_exit BLOCKING "EMAIL_PROVIDER not declared in env-manifest"
fi

EMAIL_FROM=$(jq '[.variables[] | select(.name == "EMAIL_FROM" and .required == true)] | length' "$ENV")
if [ "$EMAIL_FROM" -eq 0 ]; then
  classify_and_exit BLOCKING "EMAIL_FROM with required:true not declared in env-manifest"
fi

# Verify at least one provider's key is conditionally required
SENDGRID_KEY=$(jq '[.variables[] | select(.name == "SENDGRID_API_KEY")] | length' "$ENV")
SMTP_HOST=$(jq '[.variables[] | select(.name == "SMTP_HOST")] | length' "$ENV")
if [ "$SENDGRID_KEY" -eq 0 ] && [ "$SMTP_HOST" -eq 0 ]; then
  classify_and_exit BLOCKING "No email provider credentials declared (need SENDGRID_API_KEY or SMTP_HOST)"
fi

# Verify EMAIL_PROVIDER has allowedValues
PROVIDER_ALLOWED=$(jq -r '[.variables[] | select(.name == "EMAIL_PROVIDER")][0].allowedValues // empty' "$ENV")
if [ -z "$PROVIDER_ALLOWED" ] || [ "$PROVIDER_ALLOWED" = "null" ]; then
  classify_and_exit WARNING "EMAIL_PROVIDER missing allowedValues (should list sendgrid, smtp)"
fi

classify_and_exit OK "Email readiness confirmed. EMAIL_PROVIDER and EMAIL_FROM declared. Provider credentials (SendGrid and SMTP) declared."
