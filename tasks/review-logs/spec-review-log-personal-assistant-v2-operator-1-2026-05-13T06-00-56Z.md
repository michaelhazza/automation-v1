# Spec Review Log — personal-assistant-v2-operator — Iteration 1

**Date:** 2026-05-13
**Spec:** `docs/superpowers/specs/2026-05-13-personal-assistant-v2-operator-spec.md`
**Codex output:** `tasks/review-logs/.codex-iter1-personal-assistant-v2-operator-2026-05-13T06-00-56Z.txt`
**Codex model:** gpt-5.4 (Codex CLI 0.118.0, ChatGPT auth)
**Codex session id:** 019e1fee-63e3-7a80-9d42-41abb9b34559
**Note:** Codex returned the same review block twice. Findings deduplicated below.

## Findings & decisions

### Codex findings

**C1 — §3 ranked-source coverage incomplete (important)** — mechanical, auto-applied. Extended §3 with three new ranked entries (user-owned-agents brief, operator-backend / Spec D brief, personal-assistant-v1 brief); promoted `docs/spec-authoring-checklist.md` to ranked entry #6.

**C2 — §4.3 TBD row breaks file inventory lock (important)** — mechanical, auto-applied. Replaced the TBD row with `server/tools/capabilities/capabilityDiscoveryHandlers.ts` (entry point `executeCheckCapabilityGap`, dispatched by `skillExecutor.ts:1767-1770`, verified by grep before edit). Added sibling no-op row for `skillExecutor.ts`.

**C3 — Writer for `cross_owner_approval_timeout_policy` unnamed (important)** — mechanical, auto-applied jointly with C7. Added `crossOwnerDelegationRequestAssembler.ts` + `*Pure.ts` rows to §4.2 with explicit ownership of the timeout-policy column write.

**C4 — `cross_owner_substep.completed` event type not in §4.6 (important)** — mechanical, auto-applied. §4.6 `shared/types/operatorEvents.ts` row now lists all three new event variants and references `AGENT_EXECUTION_EVENT_CRITICALITY` registry.

**C5 — Several contracts missing example payloads (important)** — mechanical, auto-applied. Softened §5 intro to "example where copy-paste clarity is the point". Avoided opportunistic expansion (4 worked examples = 200+ lines).

**C6 — Matcher score scale source-of-truth unnamed (important)** — mechanical, auto-applied. §5.3 now cites `capabilityMapService.matchCapability` as the [0,1] scale owner; adds an implementation acceptance criterion + Chunk-2 recalibration plan.

**C7 — `crossOwnerDelegationAuthorisation` return shape conflicts with §5.4 producer (CRITICAL)** — mechanical, auto-applied jointly with C3 via new assembler service rows. Authorisation-service row narrowed; assembler owns the full `CROSS_OWNER_DELEGATION_REQUEST`.

**C8 — `ask_initiator` pause-reason constant not in §4.6 (important)** — mechanical, auto-applied. §4.6 `shared/types/crossOwnerApproval.ts` row now lists both pause-reason constants.

**C9 — File-event `version` allocator source unnamed (important)** — ambiguous → reclassified into R3. The defect surfaces R3 (entire `execution_files` table mismatch). Allocator depends on §13 #1 resolution. Handled jointly with R3.

**C10 — Universal OpenTaskView invariant not operationalised (important)** — mechanical, auto-applied. §1 framing now states explicitly that badge/chain-link/budget events come from operator-backend (Spec D §3.13 + r1-r17 prototypes); the only new V2 event types are the three inventoried in §4.6.

**C11 — `docs/spec-authoring-checklist.md` self-reference not in §4 (minor)** — mechanical, auto-applied. Promoted to §3 ranked source + listed in new §4.8.

**C12 — §6 file refs not in §4 (minor)** — mechanical, auto-applied. Created §4.8 "Referenced existing primitives" sub-table.

**C13 — §8 Chunk 9 refs (`docs/doc-sync.md`, `chatgpt-pr-review`) not in §4 (minor)** — mechanical, auto-applied. Covered by §4.8.

**C14 — Terminal-state vocabulary inconsistent; `ask_initiator` path not closed (CRITICAL)** — mechanical, auto-applied. (1) §5.4 viewer row distinguishes lifecycle from terminal statuses. (2) §5.6 enumerates the exact terminal event each timeout-policy branch emits, including the `ask_initiator → completed` path with named reasons. (3) §9.4 closes the state machine: enumerates non-terminal lifecycle events sharing the correlation key; confirms `cross_owner_substep.completed` is the SOLE terminal event.

**C15 — §10 testing gates not in §4 (minor)** — mechanical, auto-applied. Covered by §4.8.

**C16 — Appendix A fixtures underspecified (important)** — mechanical, auto-applied (minimal-change form). Appendix A prose now states the descriptions are illustrative; code is source-of-truth for fixture shapes; prose is source-of-truth for outcomes.
### Rubric findings (independent pass)

**R1 — `executionFiles` (camelCase) vs `execution_files` (snake_case) mixed** — subsumed by R3. Dropped as separate finding.

**R2 — `substep_id` unnamed in §5.4 / §4.6** — mechanical, auto-applied. §9.4 now defines `substep_id` as `delegation_outcomes.id` and notes it's carried on every `cross_owner_substep.*` event.

**R3 — `execution_files` table has none of the columns the spec assumes (CRITICAL)**
- Description: actual `execution_files` schema (`server/db/schema/executionFiles.ts`) has `executionId → executions.id` (not `agent_runs.id`), `fileName`, `fileType ('input'|'output')`, `storagePath`, `mimeType`, `fileSizeBytes`, `expiresAt`. NO `agent_run_id`, `path`, `version`, `content_sha256`, NO UNIQUE on `(agent_run_id, path)`. Every file-event contract reference is fictitious against the current schema.
- Classification: **directional** — schema strategy decision (extend existing vs new table) has architectural consequences for RLS, FK direction, and the "no new tables" claim in §4.1.
- Decision criteria (Step 7):
  - Priority 1 framing: no clean rule. "Prefer existing primitives" cuts both ways — existing primitive is semantically wrong.
  - Priority 2 convention: CLAUDE.md / architecture.md don't directly address.
  - Priority 3 best judgment: most conservative = surface to operator. Do NOT silently pick a strategy.
- Disposition: **AUTO-DECIDED — route to tasks/todo.md AND flag in §13 as BLOCKS CHUNK 7**
- Fixes applied:
  1. Placeholder migration row `migrations/0346_*` in §4.1 documenting both candidate strategies (new table `operator_run_files` vs extend `execution_files`).
  2. §13 open question #1 explicitly flagging this as BLOCKS CHUNK 7.
  3. §9.3 clarification that the version allocator's concrete form pins when §13 #1 resolves.
  4. Routed to `tasks/todo.md` under `## Deferred spec decisions — personal-assistant-v2-operator` as `PA-V2-OP-S1`.

## Iteration 1 Summary

- Mechanical findings accepted:  16 (C1, C2, C3, C4, C5, C6, C7, C8, C10, C11, C12, C13, C14, C15, C16 from Codex + R2 from rubric)
- Mechanical findings rejected:  0
- Directional findings:          1 (R3 — `execution_files` schema mismatch)
- Ambiguous findings:            1 (C9 — reclassified into R3 during Step 6)
- Reclassified → directional:    1 (C9 absorbed into R3)
- Autonomous decisions (directional/ambiguous): 1 (R3)
  - AUTO-REJECT (framing):    0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED:             1 (PA-V2-OP-S1 in tasks/todo.md)

- Spec commit after iteration:   (recorded after Step 8b commit)

## Notes for iteration 2

- The §13 #1 schema decision (PA-V2-OP-S1) is OPERATOR-PENDING. Iteration 2 should NOT re-raise it; it's already routed. If Codex re-raises it, classify as duplicate/already-handled.
- Two genuinely critical findings (C7 + C14) resolved. The spec's main internal contradictions are gone.
- Watch for: contracts that now reference the new assembler service (§4.2) being orphaned in §8 chunk sequencing; the assembler should ship in Chunk 3 with the authorisation service.
