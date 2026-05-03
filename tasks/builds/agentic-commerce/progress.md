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
| Phase 1 — SPEC (spec-coordinator) | IN PROGRESS | 2026-05-03 | — | S0 clean (0 commits behind, 5 ahead). Conflict scan complete; no unresolved conflicts. |
| Phase 2 — BUILD (feature-coordinator) | NOT STARTED | — | — | Awaits Phase 1 handoff. |
| Phase 3 — FINALISATION (finalisation-coordinator) | NOT STARTED | — | — | Awaits Phase 2. |

---

## Phase 1 sub-step status

| Step | Status | Notes |
|---|---|---|
| Context loading | DONE | CLAUDE.md, architecture index, spec-context, spec-authoring-checklist, todo, lessons, current-focus, frontend-design-principles, all three input docs read. |
| S0 sync + freshness check | DONE | 0 commits behind origin/main; 5 ahead. No merge needed. |
| Brief intake + conflict scan | DONE | Major + UI-touching. No unresolved conflicts across the three input docs; addendum (v3) cleanly resolves every conflict raised by exploration. |
| Build slug + directory | DONE | `tasks/builds/agentic-commerce/` created. |
| Mockup loop | NOT STARTED | Eight UI surfaces to cover. |
| Spec authoring | NOT STARTED | Target: `docs/superpowers/specs/2026-05-03-agentic-commerce-spec.md`. |
| spec-reviewer | NOT STARTED | — |
| chatgpt-spec-review | NOT STARTED | — |
| handoff.md | NOT STARTED | — |
| current-focus.md → BUILDING | NOT STARTED | — |

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
- Settlement-currency translation in reporting.

---

## Open questions for Phase 2

To be filled in by handoff.md once Phase 1 completes.
