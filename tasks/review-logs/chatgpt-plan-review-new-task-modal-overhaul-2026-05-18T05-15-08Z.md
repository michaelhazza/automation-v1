# chatgpt-plan-review — new-task-modal-overhaul

**Date:** 2026-05-18
**Plan:** tasks/builds/new-task-modal-overhaul/plan.md
**Mode:** manual

---

## Session Info

- **Build slug:** new-task-modal-overhaul
- **Plan author:** architect (single iteration, 2026-05-18)
- **Spec:** docs/superpowers/specs/2026-05-18-new-task-modal-overhaul-spec.md (Status: accepted, 3 chatgpt-spec-review rounds APPROVED)
- **Scope class:** Major
- **Total chunks:** 10
- **Total migrations:** 6 (A, B, C, D, E + F) — D relocated from Chunk 1 to Chunk 4 in Round 3 per F1/F2
- **Key plan facts:**
  - OQ1 (permission DB storage) resolved to path (b) DB-persisted; Migration F authored
  - Chunks 3 (27 files) and 6 (~45 files) exceed ≤5 file guideline; justified as single-responsibility rename atomicity
  - Single-PR deploy convention (per spec §12); mid-PR un-buildable windows accepted
  - Permission cutover atomicity (Migration F + constant rename + route rename in one commit) is a critical risk

---

## Round 3

**Operator feedback summary:** ChatGPT-web identified 17 findings (10 actionable, 7 positive). Main blockers: re-sequence Migration D, harden Migration F SQL/down, reconcile source enum, complete-or-block insert-site audit before Migration E.

**Findings:** 17 total (10 actionable: 9 technical + 1 user-facing; 7 positive/no-action)

### Decisions

| # | Finding | Triage | Decision | Rationale |
|---|---------|--------|----------|-----------|
| F1 | Chunk 1 too early for Migration D | technical (phase sequencing) | ACCEPT | Migration D is behavioural/data-contract cutover, belongs with writer-cutover commit (Chunk 4) — moved. |
| F2 | Chunk 1 → 4 dependency overstated | technical (improvement) | ACCEPT | Resolved alongside F1 — A–C ship in Chunk 1, D in Chunk 4. |
| F3 | Migration F SQL directionally correct but underspecified | technical (bug) | ACCEPT | Added pre-authoring `\d permissions` verification step; tightened DELETE with `NOT EXISTS` guard for partial-completion safety; added pre-existing-state tolerance note (clean / partial / already-complete). |
| F4 | Migration F down may delete legitimate org.tasks.write row | technical (bug) | ACCEPT | Added explicit `NOT EXISTS` guard on down DELETE; added prominent DOWN SAFETY CAVEAT marking it PRE-PRODUCTION-ONLY; required migration file header comment. |
| F5 | parseDueDate contract incomplete | technical (improvement) | ACCEPT | Added full behavioural contract table (8 cases incl. DST spring/fall, invalid IANA, invalid format/date); chose `Intl.DateTimeFormat` (project standard — `scheduledTaskService.ts:42` precedent, no new dep); defined `DueDateParseError` with three codes; defined route-handler error mapping (400 vs 500). |
| F6 | POST /api/task-intake source enum inconsistent | technical (bug) | ACCEPT | Plan said `'slash_remember'` in two places; spec line 557 says canonical enum is `'new_task_modal' \| 'global_ask_bar' \| 'programmatic'`. Removed `'slash_remember'` from both occurrences; added explicit "NOT in scope" guard in validation note. |
| F7 | Chunk 2 type contract is solid | positive | NO-ACTION | Acknowledged. |
| F8 | TaskAttachmentDropZone network ownership blurry | technical (architecture) | ACCEPT | Made network ownership explicit: parent injects `uploadAttachment` and `deleteAttachment` callbacks; component owns only state and UI. |
| F9 | Attachment state machine invalid-transition policy gap | technical (improvement) | ACCEPT | Added full transition table (11 allowed transitions, 5 disallowed including terminal-state rules); added `'cancelled'` as terminal state; expanded test scope from 6 cases to 17. |
| F10 | TaskAgentPicker extraction boundary sound | positive | NO-ACTION | Acknowledged. |
| F11 | TaskAttachmentDropZone extraction boundary sound | positive | NO-ACTION | Acknowledged. |
| F12 | taskCreationService.createTask vs taskService.createTask risky | technical (architecture) | ACCEPT | Renamed at source: `createBrief` → `createTaskIntake` (not `createTask`). Propagated through Chunk 3 file list, Chunk 3 contract, Chunk 4 file list, Chunk 4 acceptance criteria, §1.3 service contracts, §4 module shape, §8 self-consistency, audit table. `TaskInput` → `TaskIntakeInput` for matched naming. |
| F13 | Chunk 3 size justified | positive | NO-ACTION | Acknowledged. |
| F14 | Chunk 6 size justified | positive | NO-ACTION | Acknowledged. |
| F15 | Chunk 5 may be too small / artificially separated | user-facing (chunk-readability decision) | DEFER TO OPERATOR | Surfaced below — operator decides whether to merge Chunk 5 into Chunk 3 or 4, or keep separate for review-load reasons. |
| F16 | Chunk 8 well placed | positive | NO-ACTION | Acknowledged. |
| F17 | Pre-Migration-E audit still contains TO VERIFY rows | technical (implementation readiness) | ACCEPT | Promoted to a third HARD pre-Chunk-4 blocker gate with explicit grep commands; coordinator MUST resolve every TO VERIFY row to (a) or (c) with live `file:line` citations before Migration E commits; if undecidable, STOP and escalate. Mirrored in §6.4 and §9. |

### Changes applied

- **F1/F2:** Migration D relocated from Chunk 1 to Chunk 4. Updated ToC, Chunk 1 heading, Chunk 4 heading, spec_sections references, file lists, Migration plan bodies, acceptance criteria, dependency-graph migration-ordering paragraph. Added "Sequencing note" in Chunk 1 explaining the move and the runtime-correctness argument.
- **F3:** Added "Pre-authoring step" requiring implementer verification of `permissions` column shape via `\d permissions` (or schema file read) before authoring INSERT column list. Added "Pre-existing-state safety" requirement: SQL must tolerate clean / partial / already-complete pre-states.
- **F4:** Hardened Migration F UP DELETE with `NOT EXISTS` guard. Hardened Migration F DOWN with mirror `NOT EXISTS` guard. Added DOWN SAFETY CAVEAT block marking the down as PRE-PRODUCTION-ONLY, naming the failure mode (post-cutover UPDATE rewrites legitimate grants), referencing spec §6.3/§14, and requiring a header comment on the migration file.
- **F5:** Replaced one-paragraph parseDueDate description with a structured contract block: TypeScript signature + `DueDateParseError` class + library choice rationale (`Intl.DateTimeFormat`, project precedent) + 8-row behavioural contract table covering EDT, UTC, null, invalid format, empty, invalid IANA, invalid calendar date, and both DST transition days + route-handler error mapping. Updated Chunk 4 test scope to enumerate all 8 contract cases.
- **F6:** Removed `'slash_remember'` from two source-enum occurrences (lines 378, 492 of old plan). Added explicit "NOT a permitted source value" guard in the route validation note; added comment pointing back to spec line 557.
- **F8:** Added `uploadAttachment` and `deleteAttachment` callback props to `<TaskAttachmentDropZone>` interface with explicit doc comment naming the network-ownership boundary.
- **F9:** Added 11-row "Full transition table" (all allowed transitions) plus 5-row "Disallowed transitions" list (terminal states + no-retry-for-unrecoverable). Added `'cancelled'` as a terminal state in the discriminated union. Expanded Chunk 7 test scope from 6 cases to 17 (10 allowed + 5 disallowed + unknown-localId + summariseRows).
- **F12:** Renamed source function `createTask` → `createTaskIntake` and `TaskInput` → `TaskIntakeInput`. Propagated through: §1.3 service contracts paragraph; §4 module-shape public-interface example; Chunk 3 file list (`briefCreationService.ts` rename); Chunk 3 contracts block (function signature); Chunk 4 file list note; Chunk 4 acceptance criteria; §8 self-consistency single-source-of-truth claim.
- **F17:** Added pre-Chunk-4 gate #3 (BLOCKING) with three explicit `git grep` commands; coordinator MUST resolve every TO VERIFY row with `file:line` citations before Migration E SQL commits; STOP-and-escalate clause for undecidable rows. Updated §6.4 audit-completion-gate language to "HARD BLOCKER" with cross-reference. Updated §9 open-items language to reflect the hardened gate.

### User-facing items deferred to operator

**F15 (Chunk 5 size).** The plan currently has Chunk 5 as a dedicated server-side sweep of the `'brief_chat'` literal (~5 call sites + ~3 fixture sites). ChatGPT observes this is small and tightly related to Chunks 3 (services) and 4 (routes), and could plausibly merge into either. The trade-off: keeping Chunk 5 separate makes the diff easy to review in isolation and gives the reviewer a clean "search-and-replace one literal" mental model; merging it into Chunk 3 or 4 saves a commit boundary but bloats those already-large chunks (Chunk 3 is 27 files, Chunk 4 ships D+E+F migrations and the route rename). I lean toward keeping Chunk 5 separate (the review-readability argument is strong given Chunks 3 and 4 are already at the top of the file-count budget), but this is the operator's call. Options:
- (a) Keep Chunk 5 separate — no change.
- (b) Merge Chunk 5 into Chunk 4 — server-side sweep happens in the same commit as the route + migration cutover; lowers commit count by 1.
- (c) Merge Chunk 5 into Chunk 3 — server-side sweep happens with the service-file renames; ties the literal cleanup to service rename atomicity.

**Operator decision (Round 1 close-out, 2026-05-18):** **Option (a) — keep Chunk 5 separate.** Rationale: review-readability argument carried. No plan change required. F15 resolved.

---

## Round 2

**Opening posture:** Operator re-uploaded the EDITED plan (after Round 1 auto-applies) and asked ChatGPT-web to verify the 9 technical fixes are coherent and did not introduce contradictions. Round 2 focus is coherence-after-edit, not fresh findings. Seven specific verification areas were specified by the operator.

**Operator feedback summary:** ChatGPT identified 7 follow-up issues — mostly consistency-cleanup fallout from the Round 1 Migration D relocation, plus one substantive concern (F4) about misleading migration-order wording. ChatGPT verdict: CHANGES_REQUESTED. Six findings are technical (auto-applied); one is user-facing (F6) and re-confirms a Round 1 operator decision.

**Findings:** 7 total (6 technical + 1 user-facing)

### Decisions

| # | Finding | Triage | Decision | Rationale |
|---|---------|--------|----------|-----------|
| F1 | §7 dependency graph still says Chunk 1 includes Migrations A-D | technical (consistency) | ACCEPT | Updated diagram: Chunk 1 box → "schema + migs A–C"; Chunk 4 box → "route + migs D,E,F + perms". |
| F2 | §4 module-shape item 1 still references A-D and conversations.scope_type | technical (consistency) | ACCEPT | Item 1 now reads "Migrations A–C" and drops the scope_type data-state from its public interface. Migration D + scope_type data state added to item 4 (route + writer cutover). |
| F3 | Chunk 1 Contracts still says conversations.scope_type rows-are-now-task | technical (bug) | ACCEPT | Replaced with: "no change in this chunk. Existing rows continue to hold value 'brief'; the data update to 'task' ships with Migration D in Chunk 4 alongside the writer cutover." |
| F4 | §7 deploy-time ordering wording is backwards (implies binary-live-before-F) | technical (architecture) | ACCEPT | Reworded the rationale. Safety property now correctly stated as: F SQL + renamed code constant land in the SAME deploy unit (atomicity), not any runtime binary-vs-migration interleaving. Added explicit clarification that the migration runner completes the full sequence before the new binary begins serving traffic. |
| F5 | Migration F down still rewrites all org.tasks.write grants — needs inline guard | technical (bug) | ACCEPT | Added a 6-line inline `-- PRE-PRODUCTION ONLY` comment block IMMEDIATELY above the down's UPDATE statement, naming the failure mode (post-cutover-inserted grants silently repointed) and pointing to the DOWN SAFETY CAVEAT and spec §6.3 / §14. Prose caveat retained as well. |
| F6 | Chunk 5 may now be redundant (could merge into Chunk 4) | user-facing (chunk sizing) | NO-ACTION — re-confirms Round 1 F15 operator decision | Operator already decided in Round 1 close-out (Option a — keep Chunk 5 separate, review-readability argument carried). Re-confirmed unchanged this round; no plan change. |
| F7 | §8 self-consistency says "Both cleared" but there are three pre-Chunk-4 gates now | technical (consistency) | ACCEPT | Updated §8 bullet to "All three cleared" and enumerated all three gates: (i) OQ1, (ii) external-consumer verification, (iii) §6 insert-site audit (HARD BLOCKER per F17). Also updated the §1.1 setup-bullet at line 48 from "two pre-Chunk-4 gates" to "three pre-Chunk-4 gates" with the same enumeration, for cross-doc consistency. |

### Changes applied

- **F1:** §7 ASCII dependency-graph diagram updated. Chunk 1 box: `Chunk 1 (schema + migs A–C)`. Chunk 4 box: `Chunk 4 (route + migs D,E,F + perms)`.
- **F2:** §4 module-shape item 1 rewritten — A–D → A–C, scope_type data-state removed from item-1 public interface, parenthetical pointer to item 4 added. Item 4 rewritten — title now reads "Migrations D + E + F", public interface adds scope_type data state, hidden adds Migration D body.
- **F3:** Chunk 1 Contracts block — `conversations.scope_type` line replaced with a "no change in this chunk" statement that explicitly points forward to Chunk 4 / Migration D.
- **F4:** §7 deploy-time ordering paragraph rewritten. Old rationale ("permissions rename F last so the new constant is live in the binary already") removed. New rationale: A–C are schema preconditions; D depends on post-rename shape; E's NOT NULL depends on D's backfill; F ships last in the sequence because it pairs atomically with the code-side `ORG_PERMISSIONS.TASKS_WRITE` rename in the same deploy unit (single-PR deploy per spec §12 Chunk 4). Explicit clarification added: migrations and the new binary deploy together; safety is from atomicity, not runtime interleaving; the migration runner completes the full sequence BEFORE the new binary begins serving traffic.
- **F5:** Migration F down SQL — added 6-line inline `-- PRE-PRODUCTION ONLY` comment block directly above the UPDATE statement. Comment names the failure mode, the post-cutover risk, the do-not-run rule, and the cross-reference to the DOWN SAFETY CAVEAT and spec §6.3 / §14.
- **F7:** §8 self-consistency bullet updated from "Both cleared" to "All three cleared" with full enumeration of three gates including the §6 insert-site audit HARD BLOCKER per F17. Same enumeration applied at the §1.1 setup-bullet (line 48) for cross-doc consistency.

### User-facing items deferred to operator

**F6 (Chunk 5 may now be redundant).** ChatGPT observed that since Chunk 4 owns route/writer cutover and Chunk 3 owns service renames, the server-side `'brief_chat'` sweep could reasonably merge into Chunk 4 — keeping Chunk 5 separate is acceptable for review clarity but it is a very small chunk. This is the same observation made in Round 1 (F15). Operator decision (Round 1 close-out, 2026-05-18): Option (a) — keep Chunk 5 separate. Re-confirmed unchanged this round. No plan change. F6 resolved.

---

## Round 3

**Opening posture:** Operator re-opened review for a Round 3 second-pass verification of the 6 Round 2 cleanup fixes. Operator wants ChatGPT-web to confirm the Round 2 fixes are themselves coherent and did not introduce new contradictions. Seven specific verification areas specified by the operator.

**Operator feedback summary:** ChatGPT confirmed plan-gate readiness. The substantive risks have all been addressed (Migration D placement, Migration F safety, source enum consistency, parseDueDate, attachment state machine, service naming, insert-site audit blocking). One low-severity wording fix raised: §8 self-consistency bullet says "All three cleared during plan authoring", but gates (ii) and (iii) are coordinator-run before Chunk 4, not already cleared. Reword to "All three are wired as pre-Chunk-4 gates".

**Findings:** 1 total (1 technical, low severity, clarity category)

### Decisions

| # | Finding | Triage | Decision | Rationale |
|---|---------|--------|----------|-----------|
| F1 | §8 self-consistency overstates gate status — "All three cleared" misrepresents (ii) and (iii) which are coordinator-runtime, not plan-authored | technical (clarity) | ACCEPT | Reword to "All three are wired as pre-Chunk-4 gates" with an explicit note distinguishing the one plan-authored resolution (OQ1) from the two coordinator-runtime gates (external-consumer verification + insert-site audit). |

### Changes applied

- **F1:** Line 1124 (§8 Pre-Chunk-4 gates bullet) reworded. Old wording "All three cleared during plan authoring: (i) OQ1 = path (b)..." replaced with "All three are wired as pre-Chunk-4 gates: (i) OQ1 resolved during plan authoring to path (b) with Migration F (plan-authored, no coordinator runtime work); (ii) coordinator runs the four-check external-consumer verification before Chunk 4 starts...; (iii) §6 insert-site audit (HARD BLOCKER per F17) — coordinator MUST resolve every TO VERIFY row...". This preserves the distinction that OQ1 is genuinely closed in the plan, while (ii) and (iii) are coordinator runtime work.
- **Cross-doc consistency check:** Line 48 (§1 Executor-notes setup-bullet) already reads "Coordinator must clear three pre-Chunk-4 gates" — that wording correctly frames the three as gates to be cleared by the coordinator. No matching fix required.

### User-facing items deferred to operator

_None._

---

## Final Summary

**Verdict:** APPROVED — plan-gate ready
**Rounds:** 3 (plan-review)
**Auto-applied:** 16 findings total (9 in Round 1 + 6 in Round 2 + 1 in Round 3)
**Operator-approved:** 4 findings escalated in Round 1 (F1/F2/F4/F12); 0 escalations in Rounds 2 and 3
**Deferred to tasks/todo.md:** 0
**User-facing decisions:** 1 (F15 in Round 1 / F6 in Round 2 — Chunk 5 separate, operator confirmed both times; no recurrence in Round 3)

**Notes:**
- Round 1 (substantive): 9 technical fixes auto-applied (Migration D resequencing, Migration F SQL hardening, parseDueDate contract, source enum reconciliation, attachment state machine, service naming, insert-site audit hardened to BLOCKER) + 4 user-facing escalations approved by operator.
- Round 2 (verification-after-edit): 6 technical fixes — consistency cleanup from the Round 1 Migration D relocation (forward references in diagrams, module-shape items, and the gates-cleared bullet). F4 reworded the migration-vs-binary runtime-ordering rationale to state the atomicity argument correctly.
- Round 3 (second-pass verification of Round 2 fixes): 1 technical clarity fix — §8 self-consistency wording overstated gate status; reworded to distinguish plan-authored vs coordinator-runtime gates.
- ChatGPT explicitly confirmed plan-gate readiness in Round 3 with no substantive risks remaining. Operator has LOCKED the session. Proceed to plan-gate per CLAUDE.md model guidance: operator reviews `tasks/builds/new-task-modal-overhaul/plan.md` and switches to Sonnet for execution.

