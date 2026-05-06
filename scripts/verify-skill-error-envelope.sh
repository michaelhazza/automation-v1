#!/usr/bin/env bash
# verify-skill-error-envelope.sh
# Phase 3 E.6 — REQ #15 skill error-envelope gate.
#
# Hunts any return path within in-scope skill/tool files that returns a plain
# object literal WITHOUT an `ok:` field. Every skill/tool handler return path
# MUST use the canonical envelope: { ok: true, ... } | { ok: false, error: string, ... }
#
# In-scope paths:
#   server/skills/**/*.ts
#   server/tools/**/*.ts
#
# Allowlisted (event-payload services or provider-call builders — do NOT use the
# ok-envelope by design, declared inline per spec):
#   connectorConfigService.ts
#   ghlAgencyOauthService.ts
#   locationTokenService.ts
#   askClarifyingQuestionsHandlerPure.ts   (validation helper, returns { valid: boolean })
#   challengeAssumptionsHandlerPure.ts     (validation helper, returns { valid: boolean })
#   capabilityDiscoveryHandlers.ts         (discovery helper, mixed return shapes)
#   requestFeatureHandler.ts               (internal feature-request helper, mixed shapes)
#   configSkillHandlers.ts                 (config skill, uses { success: boolean })
#   configSkillHandlersPure.ts             (config skill pure, uses { success: boolean })
#   workflowSkillHandlers.ts               (workflow skill, uses { success: boolean })
#   askClarifyingQuestion.ts               (internal tool, non-envelope return)
#   assignTask.ts                          (internal tool, non-envelope return)
#   requestClarification.ts                (internal tool, non-envelope return)
#   weeklyDigestGather.ts                  (internal tool, non-envelope return)
#   searchTools.ts                         (meta tool, non-envelope return)
#   clientPulseOperatorAlertServicePure.ts (event-payload service, returns { fanOut, skipped })
#   crmCreateTaskServicePure.ts            (provider-call builder, returns ProviderCall)
#   crmFireAutomationServicePure.ts        (provider-call builder, returns ProviderCall)
#   crmSendEmailServicePure.ts             (provider-call builder, returns ProviderCall)
#   crmSendSmsServicePure.ts               (provider-call builder, returns ProviderCall)
#
# Exit 0 on clean; exit 1 on first violation.
# Error format: verify-skill-error-envelope.sh: return shape missing ok: field at <file:line>

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Files to skip (basename match — applies to both allowlisted services and __tests__)
ALLOWLIST=(
  "connectorConfigService.ts"
  "ghlAgencyOauthService.ts"
  "locationTokenService.ts"
  "askClarifyingQuestionsHandlerPure.ts"
  "challengeAssumptionsHandlerPure.ts"
  "capabilityDiscoveryHandlers.ts"
  "requestFeatureHandler.ts"
  "configSkillHandlers.ts"
  "configSkillHandlersPure.ts"
  "workflowSkillHandlers.ts"
  "askClarifyingQuestion.ts"
  "assignTask.ts"
  "requestClarification.ts"
  "weeklyDigestGather.ts"
  "searchTools.ts"
  "clientPulseOperatorAlertServicePure.ts"
  "crmCreateTaskServicePure.ts"
  "crmFireAutomationServicePure.ts"
  "crmSendEmailServicePure.ts"
  "crmSendSmsServicePure.ts"
)

VIOLATIONS=0

# Collect in-scope .ts files (skills + tools, excluding __tests__ directories)
mapfile -t SKILL_FILES < <(
  find "$REPO_ROOT/server/skills" -name "*.ts" -not -path "*/__tests__/*" 2>/dev/null || true
)
mapfile -t TOOL_FILES < <(
  find "$REPO_ROOT/server/tools" -name "*.ts" -not -path "*/__tests__/*" 2>/dev/null || true
)
ALL_FILES=("${SKILL_FILES[@]}" "${TOOL_FILES[@]}")

is_allowlisted() {
  local file_basename
  file_basename="$(basename "$1")"
  for allowed in "${ALLOWLIST[@]}"; do
    if [[ "$file_basename" == "$allowed" ]]; then
      return 0
    fi
  done
  return 1
}

# scan_file FILE — prints one violation line per offending return { site.
# A `return {` passes if `ok:` appears in the same line or the next 5 lines.
scan_file() {
  local FILE="$1"
  local RELPATH="${FILE#"$REPO_ROOT/"}"

  # Read all lines into an array so we can do random-access windowing.
  mapfile -t LINES < "$FILE"
  local TOTAL="${#LINES[@]}"

  for ((i = 0; i < TOTAL; i++)); do
    line="${LINES[$i]}"
    # Check if this line contains `return {`
    if [[ "$line" =~ return[[:space:]]*\{ ]]; then
      LINENO=$((i + 1))
      # Check window: this line + next 5 lines for `ok:` token
      found_ok=0
      for ((j = i; j <= i + 5 && j < TOTAL; j++)); do
        if [[ "${LINES[$j]}" =~ [[:space:],\{]ok:[[:space:]] ]] || \
           [[ "${LINES[$j]}" =~ ^[[:space:]]*ok:[[:space:]] ]] || \
           [[ "${LINES[$j]}" =~ [[:space:],\{]ok:$'\t' ]] || \
           [[ "${LINES[$j]}" =~ [[:space:]]ok:[[:space:],\}] ]]; then
          found_ok=1
          break
        fi
      done
      if [[ $found_ok -eq 0 ]]; then
        echo "verify-skill-error-envelope.sh: return shape missing ok: field at ${RELPATH}:${LINENO}"
      fi
    fi
  done
}

for FILE in "${ALL_FILES[@]}"; do
  [[ -f "$FILE" ]] || continue
  is_allowlisted "$FILE" && continue

  while IFS= read -r violation; do
    echo "$violation"
    VIOLATIONS=$((VIOLATIONS + 1))
  done < <(scan_file "$FILE")
done

# Also run the gate against the known-bad fixture to confirm it would trip
FIXTURE="$REPO_ROOT/scripts/fixtures/verify-skill-error-envelope-bad.txt"
if [[ -f "$FIXTURE" ]]; then
  FIXTURE_HITS=0
  while IFS= read -r violation; do
    FIXTURE_HITS=$((FIXTURE_HITS + 1))
  done < <(scan_file "$FIXTURE")
  if [[ $FIXTURE_HITS -eq 0 ]]; then
    echo "verify-skill-error-envelope.sh: INTERNAL ERROR — known-bad fixture did not trip the gate" >&2
    exit 1
  fi
fi

if [[ $VIOLATIONS -gt 0 ]]; then
  echo "verify-skill-error-envelope.sh: $VIOLATIONS violation(s) found — see output above" >&2
  exit 1
fi

echo "verify-skill-error-envelope.sh: OK — all in-scope skill/tool return paths include ok: field"
exit 0
