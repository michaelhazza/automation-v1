# ChatGPT PR Review Session — memory-tiered-consolidation — 2026-05-18T06-59-51Z

## Session Info
- Branch: memory-tiered-consolidation
- PR: #351 — https://github.com/michaelhazza/automation-v1/pull/351
- Mode: manual
- Started: 2026-05-18T06:59:51Z

---

## Round 1

**ChatGPT verdict:** CHANGES_REQUESTED — 4 findings (2 red, 1 red, 1 yellow)

| # | Severity | Finding | Triage | Resolution |
|---|---|---|---|---|
| F1 | red | `memory.block.promoted` event not emitted from promotion paths | OPERATOR-APPROVED DEFERRAL — pre-documented in handoff.md OQ-2; needs runId-FK nullability + AgentExecutionSourceService union extension; spec already notes OQ-2 deviation; `workspace_memory_entry_tier_transitions` is canonical audit trail | No code change. Spec deviation already recorded. |
| F2 | red | Promotion signals use `access_count`/`cited_count` instead of `agent_run_prompts` JSONB join (spec §9.3) | OPERATOR-APPROVED DEFERRAL — pre-documented in handoff.md OQ-1; spec §9.3 join shape doesn't map to actual schema | No code change. Deviation documented in handoff. Note: spec §9.3 should be formally amended to record the deviation. |
| F3 | red | `rejectPromoteToProcedural` missing `item_type = 'promote_to_procedural'` validation — any pending item type bypasses guard | FIXED — added SELECT FOR UPDATE with item_type check, mirroring `approvePromoteToProcedural` pattern | `server/services/memoryReviewQueueService.ts` |
| F4 | yellow | Audit checks 1/2/4/5 use `admin_role` instead of per-tenant scoping (spec §10.6 violation) | FIXED — removed `SET LOCAL ROLE admin_role` from checks 1/2/4/5; added explicit `organisation_id = ANY($orgIds)` predicates; admin_role retained only for Check 6 (cross-tenant aggregate MV per §10.6(b)); single org-enumeration query uses admin_role for the one necessary cross-tenant read | `scripts/audit/audit-memory-consolidation.ts` |

**Round 1 diff:** `.chatgpt-diffs/pr351-round2-code-diff.diff`

**Verification:** lint 0 errors; typecheck 0 errors

---

## Round 2

*Awaiting ChatGPT response — diff at `.chatgpt-diffs/pr351-round2-code-diff.diff`*
