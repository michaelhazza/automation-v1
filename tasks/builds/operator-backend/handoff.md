# Handoff — operator-backend

**phase_status:** PHASE_1_PAUSED
**Paused at step:** Step 8 (chatgpt-spec-review)
**Reason:** chatgpt-spec-review is a manual ChatGPT-web review loop. It runs in a dedicated new Claude Code session via `/final-spec`, not as a sub-agent dispatched from the spec-coordinator session. Operator chose to pause this session, run `/final-spec` in a new session, then resume.

**Phase complete:** SPEC (partial — Codex review done, ChatGPT-web review pending)
**Next phase (when resumed):** BUILD (run `feature-coordinator` in a new session)
**Spec path:** [docs/superpowers/specs/2026-05-12-operator-backend-spec.md](../../../docs/superpowers/specs/2026-05-12-operator-backend-spec.md)
**Branch:** `claude/sandbox-execution-provider-DLfjn`
**Build slug:** `operator-backend`
**Source brief:** [tasks/builds/operator-backend/brief.md](./brief.md) (LOCKED v2.2, 2026-05-12)
**UI-touching:** yes
**Mockup paths:** [prototypes/operator-backend/](../../../prototypes/operator-backend/) (round 3.2, 20 prototypes)
**Mockup log:** [mockup-log.md](./mockup-log.md)

---

## Pipeline state at pause

| Step | Status | Notes |
|---|---|---|
| Step 0 — Context load + PLANNING lock | done | current-focus.md status `PLANNING`, build_slug `operator-backend` |
| Step 1 — TodoWrite list | done | |
| Step 2 — S0 branch-sync + freshness check | done | 2 commits behind → merged; one conflict (`.claude/agents/mockup-designer.md`) resolved by taking main's version (PR #289 + #290 strict superset). Post-merge typecheck clean. |
| Step 3 — Brief intake + UI-touch detection | done | Brief was already LOCKED v2.2 with 4 iteration history; UI-touch detected (mockups present) |
| Step 4 — Build slug derivation + directory creation | done | slug `operator-backend` derived from brief; directory already existed |
| Step 5 — Mockup loop | done | Mockups already at round 3.2 ("brief v2/v2.2 alignment sync"); 20 prototypes complete; operator confirmed treating the mockup loop as closed |
| Step 6 — Spec authoring | done | `docs/superpowers/specs/2026-05-12-operator-backend-spec.md` authored (1644 lines initial; 1805 lines after Codex review) |
| Step 7 — spec-reviewer (Codex loop) | done | 5/5 iterations used (cap hit), NEEDS_REVISION. 89 mechanical fixes applied across 5 commits. 1 directional finding routed to `tasks/todo.md § operator-backend deferred items` (OP-BACKEND-SR1 — capability literal import surface). Spec is mechanically much tighter; Codex was still surfacing ripples on iter 5 (expected for a Major spec of this size). Final report: `tasks/review-logs/spec-review-final-operator-backend-2026-05-12T06-12-00Z.md` |
| Step 8 — chatgpt-spec-review (MANUAL ChatGPT-web) | **pending** | Runs in a new Claude Code session via `/final-spec`. The operator is opening a separate session to do this. |
| Step 9 — Handoff write | partial | This file. Will be re-written as `PHASE_1_COMPLETE` after Step 8 completes. |
| Step 10 — current-focus.md → BUILDING | not yet | Held at PLANNING during pause |
| Step 11 — End-of-phase prompt + auto-commit | not yet | Will fire when Step 8 + 9 close |

---

## Spec-reviewer (Codex) iteration summary

Spec file went from 1644 lines to 1805 lines across 5 iterations. Highlights of mechanical fixes:

- **Schema:** new columns `settings_snapshot`, `cancel_requested_at`/`_by`, `credential_start_mode` (immutable, distinct from mutable `credential_mode`), `operator_chain_failure_count`, `gc_started_at`. UNIQUE key on `operator_runs` widened to `(agent_run_id, attempt_number, chain_seq)` so fresh-profile restart can reuse `chain_seq=1`.
- **State machines:** hard-cap-unresumable transitions, paused-state pre-conditions, cancellation sequencing, finaliser-redelivery semantics all pinned.
- **Concurrency:** slot accounting moved to `pg_advisory_xact_lock` (resolves unsafe `FOR UPDATE` on a count query). Finaliser idempotency keyed on `event_emitted_at`, not terminal status. Dispatch-crash recovery via `sandbox_start_key + adoptOrStart` (additive extension to Spec B's sandbox primitive, documented in § 2 / § 5.3). Task-terminal-event guard via pg-boss singleton key. Progress handler is sole writer for `last_progress_at` / `step_count`.
- **Inventory + contracts:** 16+ files added to § 5.1 / § 5.3 (notifier, errors helper, encryption helper, conversation artefact, error handler, permissions, CI workflow, OpenTaskView family, sandbox primitive extension, LLM-request writer extension). New contracts for `cs.operator_session.suspended_detected` payload, `ApiKeyEnvelope` shape, conversation-artefact MIME, encryption-helper signatures. Both `OperatorSessionEnvelope` and `ApiKeyEnvelope` now carry `subaccountId` for the three-way subaccount-match.
- **Cost attribution:** pinned on immutable `credential_start_mode` (not the mutable `credential_mode`) so a mid-link fallback swap doesn't retroactively re-attribute the pre-swap rows.

**Codex's cap-hit means:** every round of edits surfaced a new wave of consistency ripples Codex caught in the next round. The cap exhausted the deterministic budget; chatgpt-spec-review (Step 8) provides fresh eyes with different blind spots.

---

## Decisions made in Phase 1

- **S0 conflict resolution (mockup-designer.md):** took main's version verbatim. Main's PR #289 + #290 is a strict superset of branch commit `538f101b` (same codebase-grounding rule; main also enforces per-screen filename enumeration). Round 3 mockups already followed the stricter convention.
- **Mockup loop closed at round 3.2** without an explicit "complete" message in the log. The brief header "ready for spec authoring" + the round-3.2 "brief v2/v2.2 alignment sync" were treated as the close signal. Operator confirmed.
- **Single-phase build.** No sub-phase split. D8 (chain-resume required) and D11 (persistent profile required) are honoured: the whole Operator Backend ships in one phase.
- **Storage choice for per-subaccount settings:** new `subaccount_operator_settings` table rather than six columns on `subaccounts` — keeps the operator concern isolated, mirrors the existing `subaccount_optimiser_settings` shape.
- **Hyphenated namespace** for lifecycle events (`operator-session.*`) and dotted namespace for incident/audit events (`operator.*`). CI gate enforces.
- **Vendor codename "OpenClaw" purged** from code, schema, UI, telemetry, customer-facing copy. The codename appears only in vendor-specific config files (`Dockerfile`, env manifest).
- **Polling stays the V1 visibility primitive.** WebSocket bridge is best-effort. Streaming progress is Phase 3.5.
- **No feature flag for the new adapter.** Registers unconditionally at boot.
- **`server/lib/orgScoping.ts` is the canonical path** (the brief referenced `server/middleware/orgScoping.ts`; corrected in § 2 footnote).
- **Migration numbers 0327–0331** reserved for this spec's 5 migrations (latest existing is 0326 from operator-session-identity).

---

## Open questions for Phase 2

These are flagged in spec § 16 (Open questions) and intentionally NOT blockers:

1. Vendor product name (pinned in `Dockerfile` only).
2. `per_token` row schema linkage to `operator_run_id` (Zod schema update if needed).
3. Conversation-history per-link artefact format (MIME / Zod shape).
4. `is_resumable_now` signal source from the vendor operator runtime.
5. Status-pill colour vs auto-extend banner colour clash — UI implementation disambiguates.
6. Plan-tier display in the suspended-state banner — should not name the vendor.

---

## What to do to resume

1. Open a new Claude Code session.
2. Run `/final-spec` (the chatgpt-spec-review skill shortcut). Follow its manual round-by-round prompts; paste ChatGPT-web responses as instructed. Each round auto-applies mechanical / technical findings; user-facing findings route to you for approval.
3. When `/final-spec` closes (operator says "done" / "approved"), close that session.
4. Return to a new spec-coordinator session: type `launch spec-coordinator` (or `spec-coordinator: resume operator-backend`). The Step 0 PLANNING-lock invariant will detect this PAUSED handoff and resume at Step 9 (handoff finalisation → BUILDING transition).
5. Alternative shortcut: if `/final-spec` writes a clean review log AND the operator wants to skip the spec-coordinator resume, the operator may instead open a `feature-coordinator` session directly — `feature-coordinator` reads this file and treats it as the SPEC handoff (with the note that chatgpt-spec-review review log path is recorded in the review-logs directory). Either path works.

---

## Files touched in Phase 1 (so far)

**Authored (added or substantially modified):**
- `docs/superpowers/specs/2026-05-12-operator-backend-spec.md` (1805 lines, 5 spec-reviewer iterations)
- `tasks/current-focus.md` (PLANNING lock + build_slug `operator-backend`)
- `tasks/builds/operator-backend/handoff.md` (this file)
- `tasks/review-logs/spec-review-final-operator-backend-2026-05-12T06-12-00Z.md` (spec-reviewer final report)
- `tasks/todo.md` (1 OP-BACKEND-SR1 entry routed by spec-reviewer)
- Various spec-reviewer per-iteration log files in `tasks/review-logs/`

**Touched by S0 sync (operator-confirmed):**
- `.claude/agents/mockup-designer.md` (took main's version)

**Pre-existing (read but not modified):**
- `tasks/builds/operator-backend/brief.md` (LOCKED v2.2)
- `tasks/builds/operator-backend/mockup-log.md`
- `prototypes/operator-backend/` (20 prototypes, round 3.2)
- Predecessor specs A / B / C

---

**Last updated:** 2026-05-12 (paused mid-Step-8)
