# consolidation-operate — Phase 2 → Phase 3 Handoff

**Build slug:** `consolidation-operate`
**Branch:** `ui-consolidation-operate`
**Spec path:** `tasks/builds/consolidation-operate/spec.md` (status: accepted)
**Plan path:** `tasks/builds/consolidation-operate/plan.md` (v1.3, 9 chunks C1–C9)
**Phase 2 completed:** 2026-05-07
**Phase 2 status:** complete

## Table of contents

1. Branch state — read this first
2. Pipeline summary
3. Deferred items
4. Phase 3 next steps for finalisation-coordinator
5. Operator action callout
6. dual-reviewer status (no REVIEW_GAP this time)

---

## 1. Branch state — read this first

**The branch is 28 commits ahead of `origin/main` and HAS been pushed** (dual-reviewer + Phase 2 close commits pushed at end of this Phase 2 session per the explicit operator opt-in for review-agent and Phase 2 boundary auto-pushes).

Branch HEAD at handoff: `d0db0152` (Phase 2 close commit — handoff + progress + current-focus REVIEWING). The full commit chain is in `tasks/builds/consolidation-operate/progress.md § 2 Per-chunk commit map`. The dual-reviewer commit `ad6c498d` precedes it (App.tsx scope-preserving redirect + log).

**No remote PR exists yet.** finalisation-coordinator opens the PR via `gh pr create` as the first PR-mutating step of Phase 3 — the branch is already on origin and ready. S2 sync (merge of latest `origin/main`) still runs first per the Phase 3 contract.

Working tree is clean. `npm run lint` is at 0 errors / 865 pre-existing warnings (matches `main` baseline). `npm run typecheck` is clean. Build artefacts (lint/typecheck) are deterministic on the integrated branch state.

---

## 2. Pipeline summary

| Gate | Verdict | Log |
|---|---|---|
| **G2** (lint + typecheck on integrated branch state) | PASS | n/a (gate output) |
| **spec-conformance** | CONFORMANT_AFTER_FIXES (29/31 PASS, 2 DIRECTIONAL_GAP deferred) | `tasks/review-logs/spec-conformance-log-consolidation-operate-2026-05-07T20-31-55Z.md` |
| **adversarial-reviewer** | NO_HOLES_FOUND (3 worth-confirming defense-in-depth notes — non-blocking) | `tasks/review-logs/adversarial-review-log-consolidation-operate-2026-05-07T20-36-46Z.md` |
| **pr-reviewer** | APPROVED (0 blocking; 4 strong + 6 non-blocking deferred or documented) | `tasks/review-logs/pr-review-log-consolidation-operate-2026-05-07T20-38-48Z.md` |
| **dual-reviewer** | APPROVED (2 iterations; 1 fix applied — App.tsx scope-preserving redirect; 2 deferred to OPER-DEF-3 / OPER-DEF-4) | `tasks/review-logs/dual-review-log-consolidation-operate-2026-05-07T20-58-57Z.md` |
| **Doc-sync gate** | PASS (C9 sweep complete; verdicts table in progress.md § 4) | n/a |
| **chatgpt-pr-review** | PENDING — Phase 3 step | n/a yet |

---

## 3. Deferred items

| ID | Severity | Owner | Summary |
|---|---|---|---|
| **OPER-DEF-1** | low (cosmetic) | next operate-stream sprint | InboxBand per-band color treatment (red/amber/slate left borders per spec §4.6) |
| **OPER-DEF-2** | medium (UX/discoverability) | next operate-stream sprint | Sidebar Inbox + Activity nav rows for workspace/org users (routes deep-link reachable but missing from `client/src/config/sidebar.ts`) |
| **OPER-DEF-3** | medium (data completeness) | future inbox sprint | Banded inbox does not surface `kind:'approval'` rows — `getUnifiedInbox` union excludes `actions` rows; `inbox_read_states` has no canonical entityId mapping for approval-kind yet |
| **OPER-DEF-4** | medium (UX scope-loss) | next operate-stream sprint | InboxPage and ActivityPage do not consume `?subaccountId=` URL param — redirect now preserves the scope per locked C8 grammar, page-level `useSearchParams` wiring still owed |

All entries live in `tasks/todo.md` with full rationale, source citation, and suggested approach. Phase 3 chatgpt-pr-review may surface additional deferrals during the merge-ready pass.

---

## 4. Phase 3 next steps for finalisation-coordinator

When `launch finalisation` is invoked in a fresh session, the finalisation-coordinator runs the standard Phase 3 pipeline against this handoff:

1. **Context loading + handoff read** — load CLAUDE.md, architecture.md, DEVELOPMENT_GUIDELINES.md, this handoff, and the spec.
2. **S2 sync** — `git fetch origin`, rebase / merge `main` into `ui-consolidation-operate`. Resolve conflicts; pause for operator on non-trivial code-area conflicts. The auto-resolve rules from PR #270 apply (append-only artefact files take HEAD or union; tasks/todo.md union-merge; spec.md/plan.md HEAD).
3. **G4 regression guard** — `npm run lint && npm run typecheck` after merge. Cap 3 fix attempts; escalate if regressions surface from main.
4. **Push merged state** — `git push` (branch is already tracked at origin/ui-consolidation-operate from Phase 2 close; this push delivers the post-S2-sync state).
5. **Open PR** — `gh pr create` against `main`. Title and body cite the spec, the chunks built, the deferred items, and the dual-reviewer outcome. Use the `feat(consolidation):` prefix consistent with PR #270.
6. **Launch chatgpt-pr-review** — operator invocation, NOT inline (see § 5 callout below).
7. **Apply chatgpt-pr-review verdicts** — each round's `[ACCEPT]` decisions get applied, deferrals routed to `tasks/todo.md` with `CHATGPT-` prefix. Loop until CLOSED or 3 rounds.
8. **Full doc-sync sweep** — re-run the procedure in `docs/doc-sync.md` against the post-merge + post-chatgpt-review state. C9 already ran the sweep against the pre-merge branch; the sweep at finalisation must re-verify against the final diff.
9. **KNOWLEDGE.md pattern extraction** — surface any non-obvious lessons from chatgpt-pr-review rounds.
10. **Add `ready-to-merge` label + update current-focus.md** — status `MERGE_READY`, `last_updated: <date>`. Leave `branch:` and `build_slug:` set so the merge step finds them.
11. **Verify CI green** — branch-protection required checks pass before label is added. Polling cadence 90-120s per CLAUDE.md.

---

## 5. Operator action callout — chatgpt-pr-review must launch in a fresh Claude Code session

**`chatgpt-pr-review` is NOT inline-invokable from feature-coordinator.** Per its caller contract (`.claude/agents/chatgpt-pr-review.md`), the agent runs in a dedicated new Claude Code session — it carries an interactive ChatGPT-web manual-review loop that pauses for operator paste-back across multiple rounds. Invoking it inline from the current session violates the contract and breaks the manual-review handoff.

**Operator step:** open a fresh Claude Code session and type:

```
launch finalisation
```

The `final-review` skill (or the `chatgpt-pr-review` agent invoked from `finalisation-coordinator`) handles the manual ChatGPT-web rounds, applies accepted fixes, and routes deferrals.

---

## 6. dual-reviewer status

**dual-reviewer ran successfully in this Phase 2 close.** Codex CLI (codex-cli 0.125.0) was authenticated and available. 2 iterations executed against the full branch diff vs `main`:

- **Iteration 1:** 3 [P2] findings raised. 1 ACCEPT (App.tsx:506 scope-preserving redirect — applied), 2 REJECT-with-deferral (inboxService approval-kind union gap → OPER-DEF-3; api.ts subaccountId forwarding without page-side wiring → OPER-DEF-4).
- **Iteration 2:** Codex review of the applied fix returned no findings. Loop terminated cleanly.

Verdict: **APPROVED** (1 redirect fix applied; 2 directional gaps deferred to Phase 3 backlog).

Log: `tasks/review-logs/dual-review-log-consolidation-operate-2026-05-07T20-58-57Z.md`.

**No REVIEW_GAP banner needed** — dual-reviewer covered the second-opinion pass before chatgpt-pr-review. This is the standard two-pass review state, the same as PR #263 (`subaccount-artefacts`).

---

**Phase 2 (BUILD) — complete.** Operator: open a fresh session and type `launch finalisation`.
