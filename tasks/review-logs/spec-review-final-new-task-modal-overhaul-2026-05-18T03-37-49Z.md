# Spec Review Final Report

**Spec:** `docs/superpowers/specs/2026-05-18-new-task-modal-overhaul-spec.md`
**Spec commit at start:** `771a0da9` (HEAD of `builds/new-task-modal-overhaul` before review; spec file was untracked and landed as part of iteration-1 commit `3cc591a6`)
**Spec commit at finish:** `60eaa4fc`
**Spec-context commit:** `62497257`
**Iterations run:** 3 of 5 (MAX_ITERATIONS = 5)
**Exit condition:** two-consecutive-mechanical-only (iter2 and iter3 both mechanical-only)
**Verdict:** READY_FOR_BUILD

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Auto-decided (framing) | Auto-decided (convention) | AUTO-DECIDED (best-judgment) |
|---|---|---|---|---|---|---|---|
| 1 | 45 | 5 | 44 | 1 (Codex false-positive: mojibake) | 0 | 0 | 3 (routed to `tasks/todo.md` as NTMO-D1 / NTMO-D2 / NTMO-D3) |
| 2 | 22 | 0 | 21 | 1 (Codex false-positive: mojibake, again) | 0 | 0 | 0 |
| 3 | 7 | 0 | 7 | 0 | 0 | 0 | 0 |

**Total findings processed:** 79 (74 Codex + 5 rubric). **Applied:** 72. **Rejected (false positives):** 2. **Routed to tasks/todo.md:** 3.

---

## Mechanical changes applied (summary)

Grouped by spec section. Per-section detail captured in the per-iteration logs (`spec-review-log-new-task-modal-overhaul-{1,2,3}-*.md`).

- **Lifecycle / ABCd:** Build sizing note updated to "5 schema/data migrations"
- **§3 / §4.3:** portalBriefs uniqueness key reconciled (`(runId, subaccountId, workflowSlug)`)
- **§5.2 / §6.1 / §6.6 / §14:** rename surface contracts tightened — `brief_chat` exhaustive sweep; conditional Migration F documented; `'brief'` enum cleanup deferred to separate build
- **§6.3:** five migrations (A–E); Migration E adds `tasks.description NOT NULL`; Migration D down is intentional no-op; FK-ordering rationale removed; constraint rename SQL added; authorship boundary (A–D in Chunk 1, E in Chunk 4)
- **§7.1:** Title-required-by-UX vs API-optional reconciled per-endpoint; "same field set" softened to "same core field set" with layout-only override carveout
- **§7.2:** NOT NULL claim backed by Migration E
- **§7.3 / §7.4 / §11:** orchestrator behaviour unified — always-enqueue + handler eligibility check; 1-char Instructions floor vs 10-char routing threshold disentangled
- **§7.4:** cancel/remove semantics enumerated per row state; Remove endpoint corrected to existing `DELETE /api/attachments/:attachmentId`
- **§7.7:** date conversion rule + named helper (architect-confirms)
- **§8.1 / §8.2 / §8.3:** Migration E row added; `priority` added to taskIntake + taskCreationService; pure helper modules (`*Pure.ts`) added; agent-listing hook documented
- **§8.5:** frontend rendering tests removed; tests point at `*Pure.ts` modules
- **§8.6 + §8.7:** KNOWLEDGE.md condition tightened; new Supporting Documents subsection lists 6 read-only deps
- **§9.1:** source enum strict mapping + strict post-build enum (no pass-through); `assignedAgentId` vs `assignedAgentIds` clarified; `dueDate` conversion noted
- **§9.2:** overstated FK claim corrected (`conversations.scope_id` is polymorphic; transactional write in §11 is the consistency mechanism)
- **§9.3:** **critical fix** — closing `}` and ``` added; unbroke §§10–18 from being swallowed into a code block
- **§10:** per-route middleware enumerated; system-admin guard named; RLS policy preservation clarified
- **§11:** Migrations A–E declared; initial fast-path decision synchronous, second-look async; migration-runner tracking idempotency
- **§12:** single-PR convention; buildable invariant at PR boundary; permission migration in Chunk 4; Chunk 2 owns type rename, Chunk 5 owns value sweep; Migration E in Chunk 4
- **§13:** automated vs manual gates split; concrete `git grep` commands with `:(exclude)` pathspecs; "each PR" → "the implementation PR"
- **§14:** `brief_chat` deferral removed; `'brief'` enum cleanup deferred; Migration D rollback note refreshed
- **§16.2:** idempotencyKey per file row, not per attempt
- **§16.3:** PG DDL auto-commit claim removed; migration-runner tracking language used; Migration E shape added
- **§17:** numeric reconciliation corrected (5 migrations); file-inventory reconciliation aligned with §6.2

---

## Rejected findings

| Iter | Finding | Section | Reason for rejection |
|---|---|---|---|
| 1 | #2 — Mojibake | whole doc | Verified clean UTF-8 via direct file grep — Codex's terminal locale couldn't render arrows/dashes; the file is fine. |
| 2 | #21 — Mojibake (repeat) | whole doc | Same as iter1 #2 — confirmed clean UTF-8 a second time. Codex repeated the same false positive. |

Both rejections are safe — verified directly that the spec contains valid UTF-8 unicode arrows and em-dashes.

---

## Directional and ambiguous findings (autonomously decided)

| Iter | Finding | Classification | Decision | Rationale |
|---|---|---|---|---|
| 1 | #8 — Enumerate per-file symbol renames in §6.2 | directional (architecture: "change the interface of X") | AUTO-DECIDED (reject) → `tasks/todo.md` NTMO-D1 | Project convention: spec locks rename strategy + categories; plan locks per-file symbol lists. |
| 1 | #26 — Enumerate exact file list in §8 (no broad categories) | directional (scope: "change scope of file inventory") | AUTO-DECIDED (reject) → `tasks/todo.md` NTMO-D2 | Project convention: 300+ file rename sweeps use category + counts in spec; architect locks the exact list at plan authoring. |
| 1 | #33 — Chunk 1 "migrations run first" sequencing | reclassified as mechanical (clarification) | AUTO-DECIDED (accept-partial) → `tasks/todo.md` NTMO-D3 | Clarified inline that chunks ship as one PR; buildable invariant holds at PR boundary. |

Iterations 2 and 3 produced no directional or ambiguous findings.

---

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and against three rounds of Codex review. The human has adjudicated every directional finding that surfaced (three in iteration 1; all autonomously resolved against project conventions and routed to `tasks/todo.md` for deferred review). However:

- The review did not re-verify the framing assumptions at the top of `docs/spec-context.md`. If the product context has shifted since the spec was written (stage of app, testing posture, rollout model), re-read the spec's Framing Assumptions (§3) one more time.
- The review did not catch directional findings that Codex and the rubric did not see. Automated review converges on known classes of problem; it does not generate insight from product judgement.
- The review did not prescribe what to build next. Sprint sequencing, scope trade-offs, and priority decisions are still the human's job — though §12 now lays out a complete chunk plan that an architect can pick up directly.

**Recommended next step:** read §1–§7 one more time, confirm the headline decisions match your current intent, then run `architect` to break the spec into builder-grade chunks.
