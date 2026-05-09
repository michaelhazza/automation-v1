# Progress — support-desk-canonical

**Build slug:** support-desk-canonical
**Branch:** `claude/support-ticket-structure-xMcy8`
**Brief:** `tasks/builds/support-desk-canonical/brief.md` (LOCKED v5.3, commit `0e04cc0d`)
**Mockups:** `prototypes/support-desk-canonical/` (5 hi-fi screens, complete in commit `0a768abd`)

---

## Phase 1 (SPEC) — in flight

| Step | Status | Notes |
|---|---|---|
| 0 — Context loaded + PLANNING lock acquired | done | tasks/current-focus.md → status PLANNING, build_slug=support-desk-canonical |
| 1 — TodoWrite list emitted | done | 12 items |
| 2 — Branch-sync S0 + freshness | done | 0 commits behind main; no merge required |
| 3 — Brief intake + UI-touch detection | done | Major class; ui_touch=true; brief v5.3 LOCKED on disk |
| 4 — Build slug derivation + directory | done | slug existed; progress.md created here |
| 5 — Mockup loop | skipped | operator confirmed frozen — `prototypes/support-desk-canonical/` is design source of truth |
| 6 — Spec authoring | pending | Target: `docs/superpowers/specs/2026-05-09-support-desk-canonical-spec.md` |
| 7 — spec-reviewer (Codex) | pending | max 5 iterations lifetime |
| 8 — chatgpt-spec-review | pending | MANUAL mode — operator pastes ChatGPT-web responses |
| 9 — Handoff write | pending | `tasks/builds/support-desk-canonical/handoff.md` |
| 10 — current-focus.md → BUILDING | pending | After handoff written (abort-write-order invariant) |
| 11 — End-of-phase prompt + auto-commit | pending | Spec, handoff, progress, mockup-log, current-focus |

## Decisions made in Phase 1

- Brief committed at v5.3 (commit `0e04cc0d`) before spec authoring — clean audit trail per operator confirmation.
- Step 5 mockup loop skipped — five hi-fi screens (`integration-setup.html`, `tickets-list.html`, `ticket-detail.html`, `draft-review.html`, `inbox-config.html`) committed in `0a768abd` are the design source of truth for the spec's UI section. Brief v5.3 §5.12 (Operational state UI surface) and §6.1 (UI filter semantics) extensions confirmed in scope of existing mockups.
- Scope classified Major: new subsystem (5 canonical entities), 12 design invariants, cross-cutting RLS/services/jobs/webhooks/UI/agent skills, plus Teamwork v1 extension.

## Open questions for Phase 2

To be enumerated at Step 9 (handoff). Candidates being tracked through spec authoring:
- Status-mapping inventory for Teamwork (§10 #12 mandates the complete mapping table as a spec artefact — must be confirmed against live Teamwork API surface during spec authoring)
- Action idempotency mechanism choice (§10 #13 — Teamwork-native vs. local action-attempt ledger; depends on API audit)
- Attachment auth model (§10 #14 — URL-based vs. stream-based for `resolveAttachment`)
