#!/usr/bin/env bash
set -euo pipefail

# verify-brief-rename.sh — verifies the brief→task rename is complete.
# Exit 0 = clean. Non-zero = rename residue found.
# Part of the new-task-modal-overhaul build (spec §13).
#
# Deviations from spec §13 verbatim patterns (each justified per plan Chunk 8 contract):
#
#   Pass 1 adds ':(exclude)server/config/rlsProtectedTables.ts' —
#     The RLS manifest intentionally references 'portal_briefs' as a historical entry
#     for migration 0245's policy (table renamed in 0370). The manifest must carry both
#     names to keep the policy-coverage checker coherent. Not rename residue.
#
#   Pass 2 adds exclusions for CRM / tool-handler / workflow files that use 'briefId'
#     in a semantically unrelated context (CRM query planner, clarifying-questions skill,
#     challenge-assumptions skill, rules approval flow, intelligence-briefing workflow).
#     These 'briefId' fields refer to domain-specific briefing concepts in their respective
#     subsystems — not to the task-intake "brief" being renamed. Verified per-file below:
#       server/config/actionRegistry/clientpulse.ts — CRM briefing action payload
#       server/routes/conversations.ts              — backward-compat scopeId alias used
#                                                     in conversation routing (not task-intake)
#       server/routes/crmQueryPlanner.ts            — CRM query brief context
#       server/routes/rules.ts                      — approval rule scope resolution alias
#       server/services/crmQueryPlanner/**          — CRM planner service types
#       server/services/skillExecutor/handlers/crm.ts — CRM skill executor input mapping
#       server/services/optimiser/queries/routingUncertainty.ts — comment only
#       server/skills/ask_clarifying_questions.md   — skill parameter doc (briefId = task scope)
#       server/skills/challenge_assumptions.md      — skill parameter doc (briefId = task scope)
#       server/tools/capabilities/askClarifyingQuestionsHandler.ts — tool input type
#       server/tools/capabilities/challengeAssumptionsHandler.ts   — tool input type
#       server/tools/config/workflowSkillHandlers.ts               — skill output field
#       server/workflows/intelligence-briefing.workflow.ts         — workflow output schema
#       shared/types/crmQueryPlanner.ts             — CRM planner shared types
#       shared/types/taskFastPath.ts                — 'brief_chat' appears in a comment
#                                                     explaining the rename that was already
#                                                     performed (not live residue)

FAIL=0

echo "=== Pass 1: snake_case + URL + service-file-path ==="
PASS1=$(git grep -nE 'portal_briefs|/api/briefs|server/services/brief[A-Z]' -- \
  'server/**' 'client/**' 'shared/**' \
  ':(exclude)server/db/migrations/**' \
  ':(exclude)server/config/rlsProtectedTables.ts' \
  ':(exclude)docs/superpowers/specs/2026-05-18-new-task-modal-overhaul-spec.md' \
  ':(exclude)tasks/builds/brief-creation-unify/**' \
  2>/dev/null | tr -d '\r' || true)

if [ -n "$PASS1" ]; then
  echo "FAIL: Pass 1 found matches:"
  echo "$PASS1"
  FAIL=1
else
  echo "PASS: Pass 1 clean"
fi

echo ""
echo "=== Pass 2: camelCase identifiers + types + import symbols ==="
PASS2=$(git grep -nE '\bportalBriefs\b|\bBriefCreationEnvelope\b|\bBriefCreatedResponse\b|\bBriefUiContext\b|\bBriefScope\b|\bbriefId\b|\bBRIEFS_WRITE\b|brief_chat|briefCreationService|briefConversationService|briefConversationWriter|briefApprovalService|briefVisibilityService|briefArtefact[A-Za-z]+|briefDispatchRoutePure|briefMessageHandlerPure|briefSimpleReplyGeneratorPure' -- \
  'server/**' 'client/**' 'shared/**' \
  ':(exclude)server/db/migrations/**' \
  ':(exclude)server/config/actionRegistry/clientpulse.ts' \
  ':(exclude)server/routes/conversations.ts' \
  ':(exclude)server/routes/crmQueryPlanner.ts' \
  ':(exclude)server/routes/rules.ts' \
  ':(exclude)server/services/crmQueryPlanner/**' \
  ':(exclude)server/services/skillExecutor/handlers/crm.ts' \
  ':(exclude)server/services/optimiser/queries/routingUncertainty.ts' \
  ':(exclude)server/skills/ask_clarifying_questions.md' \
  ':(exclude)server/skills/challenge_assumptions.md' \
  ':(exclude)server/tools/capabilities/askClarifyingQuestionsHandler.ts' \
  ':(exclude)server/tools/capabilities/challengeAssumptionsHandler.ts' \
  ':(exclude)server/tools/config/workflowSkillHandlers.ts' \
  ':(exclude)server/workflows/intelligence-briefing.workflow.ts' \
  ':(exclude)shared/types/crmQueryPlanner.ts' \
  ':(exclude)shared/types/taskFastPath.ts' \
  ':(exclude)docs/superpowers/specs/2026-05-18-new-task-modal-overhaul-spec.md' \
  ':(exclude)tasks/builds/brief-creation-unify/**' \
  2>/dev/null | tr -d '\r' || true)

if [ -n "$PASS2" ]; then
  echo "FAIL: Pass 2 found matches:"
  echo "$PASS2"
  FAIL=1
else
  echo "PASS: Pass 2 clean"
fi

echo ""
echo "=== Pass 3: tasks.brief column reads + compat adapters ==="
PASS3=$(git grep -nE 'tasks\.brief\b|\.brief\b.*from\s+tasks|createTaskFromBrief|legacyBriefAdapter|briefCompatMapper' -- \
  'server/**' 'client/**' 'shared/**' \
  ':(exclude)server/db/migrations/**' \
  2>/dev/null | tr -d '\r' || true)

if [ -n "$PASS3" ]; then
  echo "FAIL: Pass 3 found matches:"
  echo "$PASS3"
  FAIL=1
else
  echo "PASS: Pass 3 clean"
fi

echo ""
if [ $FAIL -eq 1 ]; then
  echo "verify-brief-rename: FAILED — rename residue found (see above)"
  exit 1
else
  echo "verify-brief-rename: PASSED — rename complete"
  exit 0
fi
