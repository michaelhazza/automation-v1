# Build progress — agentic-commerce

**Branch:** `claude/agentic-commerce-spending`
**Build slug:** `agentic-commerce`
**Scope class:** Major
**UI-touching:** yes (eight surfaces)
**Estimated wall-clock:** 4 weeks single-builder, 2.5-3 weeks if chunks 4-5 and 13-14 parallelise.

---

## Phase status

| Phase | Status | Started | Completed | Notes |
|---|---|---|---|---|
| Phase 1 — SPEC (spec-coordinator) | DONE | 2026-05-03 | 2026-05-03 | Spec locked Final, chatgpt-spec-review APPROVED 5 rounds. Plan locked, chatgpt-plan-review APPROVED 3 rounds. |
| Phase 2 — BUILD (feature-coordinator) | DONE | 2026-05-03 | 2026-05-04 | All 16 chunks built. spec-conformance CONFORMANT_AFTER_FIXES + re-verification (1 NON_CONFORMANT gap closed). pr-reviewer 5 blocking + 4 strong all closed. dual-reviewer skipped (Codex unavailable — allowed). adversarial-reviewer DONE (1 blocker fixed; 11 deferred to tasks/todo.md; 3 dissolved as false positives). doc-sync gate inline only — full sweep deferred to Phase 3. |
| Phase 3 — FINALISATION (finalisation-coordinator) | NOT STARTED | — | — | Awaits PR open + new session. |

---

## Phase 1 sub-step status

| Step | Status | Notes |
|---|---|---|
| Context loading | DONE | CLAUDE.md, architecture index, spec-context, spec-authoring-checklist, todo, lessons, current-focus, frontend-design-principles, all three input docs read. |
| S0 sync + freshness check | DONE | 0 commits behind origin/main; 5 ahead. No merge needed. |
| Brief intake + conflict scan | DONE | Major + UI-touching. No unresolved conflicts across the three input docs; addendum (v3) cleanly resolves every conflict raised by exploration. |
| Build slug + directory | DONE | `tasks/builds/agentic-commerce/` created. |
| Mockup loop | DONE | Eight UI surfaces covered (inline implementation, no separate prototypes/ directory). |
| Spec authoring | DONE | Locked Final at `tasks/builds/agentic-commerce/spec.md`. |
| spec-reviewer | DONE | 5 Codex iterations. Final report at `tasks/review-logs/spec-review-final-agentic-commerce-2026-05-03T06-08-30Z.md`. |
| chatgpt-spec-review | DONE | 5 rounds, APPROVED. Log at `tasks/review-logs/chatgpt-spec-review-agentic-commerce-2026-05-03T06-56-32Z.md`. |
| handoff.md (Phase 1 → 2) | SKIPPED (manual handoff) | Phase 2 was driven manually rather than via feature-coordinator; no Phase 1 → 2 handoff doc was written. Captured here in retrospect. |
| current-focus.md → BUILDING | SKIPPED | Pointer was not advanced during Phase 2; corrected at Phase 3 entry. |

---

## Phase 2 sub-step status

| Step | Status | Notes |
|---|---|---|
| architect | DONE | Implementation plan at `tasks/builds/agentic-commerce/plan.md` — locked, chatgpt-plan-review APPROVED 3 rounds. |
| chatgpt-plan-review | DONE | 3 rounds, APPROVED. Plan locked at commit `48cd8b5c`. |
| Chunked build (16 chunks) | DONE | All chunks 1-16 implemented. Single squash-style implementation commit `be750ad2`. |
| Per-chunk G1 + integrated G2 | DONE | Static gates clean (typecheck 0 errors, lint 0 errors / 726 baseline warnings, build:server clean). |
| spec-conformance | DONE | 2 runs. Run 1 (2026-05-03T14:12:21Z) CONFORMANT_AFTER_FIXES (1 mechanical + 4 directional fixed; 4 additional DGs deferred). Run 2 (2026-05-03T20:51:25Z) re-verification — 4 prior DGs CLOSED, 1 new DG surfaced (`agentId: ''` empty-string drift) and closed in branch. Final verdict: CONFORMANT (re-verification scope). |
| pr-reviewer | DONE | Log `tasks/review-logs/pr-review-log-agentic-commerce-2026-05-03T21-16-46Z.md`. 5 blocking (B1-B5) + 4 strong (S1-S4) all closed in-branch. 3 of 4 nice-to-have (N1, N2, N3) deferred with rationale; N4 out of scope. |
| dual-reviewer | SKIPPED (Codex unavailable) | Allowed per CLAUDE.md (local-dev only; auto-skip permitted). Recorded in handoff. |
| adversarial-reviewer | DONE | Log `tasks/review-logs/adversarial-review-log-agentic-commerce-2026-05-03T22-07-50Z.md`. 1 blocker fixed in branch (Finding 2.2 — webhook `connectionStatus` allowlist at `server/routes/webhooks/stripeAgentWebhook.ts:155`). 11 items deferred to `tasks/todo.md § Deferred from adversarial-reviewer — agentic-commerce (2026-05-03)`. 3 reviewer findings dissolved against codebase contracts (1.1 set_config tx semantics, 1.2 cost_aggregates sentinel-org by-design, 2.1 SETTINGS_EDIT org-wide scope). |
| Doc-sync gate | PARTIAL | Inline-only updates in `architecture.md`, `docs/capabilities.md`. Full doc-sync sweep deferred to Phase 3. |
| handoff.md (Phase 2 → 3) | DONE | Written at Phase 3 entry — see `handoff.md`. |

---

## Inputs (authoritative)

1. `docs/agentic-commerce-brief.md` (v2) — strategic frame.
2. `docs/agentic-commerce-exploration-report.md` — codebase reconnaissance.
3. `docs/agentic-commerce-brief-addendum.md` (v3) — stakeholder-resolved decisions. **Authoritative on conflicts.**

Authority order on conflict: addendum > exploration > v2 brief.

---

## Decisions log (Phase 1)

- **No new product decisions invented.** The addendum locks every open question raised by v2 brief and exploration report.
- **Chunk 1 = Compute Budget rename.** Ships fully reviewed before any new spending code. Per addendum Section B.4 inventory.
- **Trigger-based append-only on `agent_charges`.** Documented deviation from precedent (`llm_requests`, `audit_events`, `mcp_tool_invocations` use app-layer); rationale per addendum Section M.
- **`cost_aggregates` RLS retrofit ships with new entityType values.** Same migration. Per addendum Section L.
- **Idempotency key shape:** `${CHARGE_KEY_VERSION}:${skillRunId}:${toolCallId}:${intent}:${sha256(canonicaliseJson(args))}`. Per addendum Section K.
- **Subaccount-as-first-class-tenant** (Section A) is a foundational tenet. Propagates into channel ownership, budget defaults, kill-switch scope, ledger visibility.
- **ApprovalChannel interface ships with one implementation (`InAppApprovalChannel`).** Slack / email / Telegram / SMS deferred to follow-up builds (single-file additions). Per addendum Section C.
- **Worker round-trip = pg-boss request-reply, 30s deadline.** Not sync HTTP. Not pre-minted permits. Per addendum Section D.
- **Pure/impure split mandatory** on chargeRouter, spendingBudget, approvalChannel services. Per addendum Section B.4 + exploration §8.14.
- **Vocabulary lock:** No bare `Budget` after the rename. Always qualified (Compute Budget or Spending Budget). Glossary section in spec.

## Out of scope (do not propose any of these)

- Machine Payments Protocol.
- Skills marketplace.
- Stripe Tempo / Metronome.
- Customer-facing SPT issuance.
- Multi-currency-within-a-policy.
- Auto-refund on workflow rollback.
- Sales Autopilot Playbook spending integration.
- Org-exclusive channel mode in v1 UI.
- Automatic FX.
- Settlement-currency translation in reserving in reporting.

---

## Open questions for Phase 3

See `handoff.md`. The deferred-items backlog in `tasks/todo.md § Deferred from adversarial-reviewer — agentic-commerce (2026-05-03)` plus the existing `Deferred from spec-conformance review — agentic-commerce (...)` and `Deferred from pr-review` sections constitute the post-merge backlog. Phase 3 finalisation does not need to address them.
