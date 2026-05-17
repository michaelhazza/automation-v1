---
status: DRAFT
date: 2026-05-15
author: main-session (claude opus 4.7)
scope_class: Significant
source_branch: main
build_slug: wave-4-pa-v2-completion
output_location: tasks/builds/wave-4-pa-v2-completion/spec.md
parent_plan: tasks/builds/personal-assistant-v2-operator/plan.md
---

# Wave 4 Session I — PA-V2 completion + chunk-4 carry-forwards

Single coordinated PR completing the PA-V2 build that paused at the plan-gate after chunks 1a-4 partly landed. Also closes the PA-V2-C4-* items deferred from the chunk-4 builder.

This build resumes from the existing PA-V2 plan at `tasks/builds/personal-assistant-v2-operator/plan.md`. The architect's chunk 0 audits which chunks are actually landed (services / migrations / tests present) vs which remain open, then drives the remaining chunks to completion.

---

## 1. Scope

Closes the following items + chunks:

- **PA-V2 plan chunks 5-9** (open per `tasks/builds/personal-assistant-v2-operator/progress.md`):
  - Chunk 5 — Operator-mode EA enablement verification
  - Chunk 6 — Operator-session initial-context bundling
  - Chunk 7 — Live-file events: tool-call interceptor + bridge + UPSERT writer
  - Chunk 8 — Live-file events: sandbox-side filesystem watcher + path-safety
  - Chunk 9 — Doc-sync + KNOWLEDGE + ADR consideration
- **PA-V2-C4-* carry-forward bugs from prior chunk-4 work**:
  - PA-V2-C4-1 — `cross_owner.ask_initiator_decision` action type missing from `server/config/actionRegistry/`
  - PA-V2-C4-2 — `agentExecutionEventServicePure.ts` missing validator cases for `cross_owner_substep.awaiting_initiator_decision` and `cross_owner_substep.completed`
  - PA-V2-C4-4 — Spec note re `actions.deletedAt` is incorrect (no such column); resolve in spec or remove the note

PA-V2-C4-3 (dead `createHash` import) lands in Session E per the original plan — out of scope here.

## 2. Goals

1. Audit chunk landings against the original PA-V2 plan during chunk 0.
2. Complete every chunk 5-9 deliverable per the existing plan.md spec.
3. Close PA-V2-C4-1, -2, -4.
4. Re-validate any chunk that the plan says is landed but reality contradicts (defensive — protects against the plan being out of sync with code).
5. Final doc-sync + KNOWLEDGE entry (Chunk 9 already includes this).

## 3. Non-Goals

- No changes to the PA-V2 spec at `tasks/builds/personal-assistant-v2-operator/spec.md` (or the canonical superpowers spec).
- No changes to chunks 1a, 1b, 2, 3, 4 if the chunk-0 audit confirms they landed correctly.
- No drive-by lint cleanup outside chunks 5-9.
- No LAEL integration with PA-V2 (Wave 5 sequential scope).
- No PA-V3 design exploration.

## 4. Framing Assumptions

- Repo is pre-production. Testing posture is `static_gates_primary`.
- The PA-V2 plan (`tasks/builds/personal-assistant-v2-operator/plan.md`) is the authoritative chunk decomposition. This spec sits on top of it as a "resume" spec.
- Chunks 1a / 1b appear landed (`shared/types/routingContext.ts`, `shared/types/delegation.ts` exist).
- Chunks 2-4 appear partially landed (cross-owner delegation services exist; chunk-4 carry-forwards in PA-V2-C4-* indicate chunk 4 reached "merged-with-gaps" state).
- Chunks 5-9 are open. The progress.md "Per-chunk loop" step is marked `pending`.
- `tasks/builds/personal-assistant-v2-operator/progress.md` must be updated by the architect at chunk 0 to reflect the post-Wave-2 state.
- Migration numbers in the original PA-V2 plan (0345-0348) collided with browser-session work and were never reused. The architect's chunk 0 confirms migration numbering for any new chunks 5-9 migrations.
- TypeScript strict mode is on. The existing tsconfig path mapping is immutable.

## 5. Chunk-0 audit deliverables

Before any new work, the architect produces an audit covering:

1. **Chunk 1a status** — verify migrations / Drizzle schema / RLS manifest entries listed in the original plan are present. Flag any missing.
2. **Chunk 1b status** — verify `shared/types/routingContext.ts`, `shared/types/delegation.ts`, CI gate `verify-capability-map-shape.sh`, and the capability-map extension are present.
3. **Chunk 2 status** — verify routing-context matcher + addressing parser.
4. **Chunk 3 status** — verify cross-owner delegation authorisation + request assembly + run-trace projection.
5. **Chunk 4 status** — verify approval-owner routing + stall job + timeout-policy decision tree. PA-V2-C4-* are known gaps; verify nothing else is missing.
6. **Chunks 5-9 audit** — confirm they are NOT landed. If any of them are, surface as a "plan-out-of-sync" finding and re-plan.

Audit output lives at `tasks/builds/wave-4-pa-v2-completion/chunk-0-audit.md`.

## 6. Items — Chunk 5: Operator-mode EA enablement verification

Per original plan §Chunk 5. Architect's chunk 0 re-reads the plan and produces the implementation chunks.

Acceptance: per original plan acceptance criteria.

## 7. Items — Chunk 6: Operator-session initial-context bundling

Per original plan §Chunk 6.

`operatorSessionInitialContextBundler.ts` exists (referenced in PA-V1 cleanup deferrals) — confirm whether this is the chunk-6 deliverable or a precursor. If precursor, complete chunk 6 per plan; if the deliverable already landed, mark chunk 6 done and move on.

Acceptance: per original plan acceptance criteria.

## 8. Items — Chunks 7+8: Live-file events

Per original plan §Chunk 7 and §Chunk 8.

These two chunks introduce:
- Tool-call interceptor + bridge to live-file events (Chunk 7)
- UPSERT writer to `operator_run_files` table (Chunk 7)
- Sandbox-side filesystem watcher + path-safety guard (Chunk 8)

Likely the largest two chunks in this session. Architect's plan sizes them carefully.

Acceptance: per original plan acceptance criteria.

## 9. Items — Chunk 9: Doc-sync + KNOWLEDGE + ADR

Per original plan §Chunk 9.

Standard doc-sync per `docs/doc-sync.md`. KNOWLEDGE entry capturing PA-V2 lessons.

Acceptance: doc-sync gate passes; KNOWLEDGE entry appended.

## 10. Items — PA-V2-C4 carry-forwards

### 10.1. PA-V2-C4-1 — Add `cross_owner.ask_initiator_decision` to actionRegistry

Fix: add the action type to `server/config/actionRegistry/agents.ts` OR a new `server/config/actionRegistry/crossOwner.ts` (architect picks during chunk 0).

Acceptance: `crossOwnerApprovalTimeoutSweep`'s ask_initiator branch successfully lands the action in the approval queue. Targeted Vitest passes.

### 10.2. PA-V2-C4-2 — Add validator cases to `agentExecutionEventServicePure.ts`

Fix: add case branches for `cross_owner_substep.awaiting_initiator_decision` and `cross_owner_substep.completed` to `validateEventPayload`.

Acceptance: events are validated and persisted. Targeted Vitest passes.

### 10.3. PA-V2-C4-4 — Resolve spec/code mismatch

The original spec note says `listPendingApprovalsForUser` applies `isActive(actions)` but the `actions` table has no `deletedAt` column. Spec is incorrect.

Fix: remove the spec note OR add the `deletedAt` column if the original intent was real (operator confirms during chunk 0). Default: remove the spec note (less change).

Acceptance: spec note matches code reality; KNOWLEDGE entry captures the discrepancy as a pattern.

## 11. Acceptance Criteria

A build is complete when ALL of the following hold:

1. Chunks 5-9 are landed per the original PA-V2 plan acceptance criteria.
2. PA-V2-C4-1, -2, -4 closed.
3. `npm run build:server` exits 0.
4. `npm run build:client` exits 0.
5. `npm run lint` exits 0.
6. Targeted Vitest passes for each new pure helper.
7. `tasks/builds/personal-assistant-v2-operator/progress.md` updated: chunks 5-9 marked done.
8. `tasks/builds/personal-assistant-v2-operator/handoff.md` Phase 2 section appended.
9. `tasks/todo.md` items in §1 marked `[status:closed:pr:<num>]` in the merge commit.
10. doc-sync + KNOWLEDGE entry per Chunk 9.

## 12. Chunks (high-level)

Architect refines during plan phase. Expected shape:

- **Chunk 0**: audit + plan write (per §5)
- **Chunks 1-5**: original plan chunks 5-9 (1 build chunk per plan chunk, may split if oversized)
- **Chunk 6**: PA-V2-C4 carry-forwards (10.1, 10.2, 10.3)
- **Chunk 7**: spec-conformance + pr-reviewer + reality-checker + final review pass

## 13. Out of Scope

- LAEL integration with PA-V2 — Wave 5 scope.
- PA-V3 design.
- Cross-owner approver wiring beyond what chunks 5-9 already require.
- Any other PA-V1 follow-up not already in Session E or Session G.

## 14. File-overlap deconfliction

This session runs concurrently with Sessions E, G, H. File-overlap analysis:

- **Session E** touches `server/config/actionRegistry/` (PA-V2-C4-3 dead import in actionService.ts) — coordinate via chunk-0 file-set boundary. Session I owns the registry; Session E owns `actionService.ts` only.
- **Session E** touches `server/services/agentExecutionEventServicePure.ts` (Session E used to own PA-V2-C4-2, moved here per operator decision 2026-05-15). Session I owns this file.
- **Session E** touches `migrations/` for any WF1 RLS migration; Session I migrations land sequentially with numbering coordinated at chunk 0.
- **Session G** does NOT overlap (Session G touches handoff durability + tests + skill registry, not PA-V2 specifics).
- **Session H** does NOT overlap (Session H touches CD1 + duplication extractions + frontend complexity, not PA-V2 specifics).
