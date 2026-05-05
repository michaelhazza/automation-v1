# Pre-Launch Phase 3 — Operator Runbook for Conditional Re-Evaluation Triggers

**Date:** 2026-05-05
**Purpose:** Capture deferred items that are correctly out of scope today but whose re-evaluation triggers will fire after launch. Each entry names the precondition and the action to take when it is met.

This file is read at three points:

1. After every PR merge that touches the listed surfaces (operator does a quick check against this list).
2. As part of the post-launch checklist when the first agency client is onboarded.
3. As input to the next pre-launch hardening pass (if one is needed) so triggered items roll forward.

---

## Conditional triggers

### AC-CGPT-R3-3 — Multi-channel display ambiguity

- **Source:** `tasks/todo.md:2758` (chatgpt-pr-review round 3 on agentic-commerce).
- **Trigger condition:** A second OAuth-style channel is added to the platform (e.g. another payment provider beyond Stripe SPT, or a second messaging connector beyond GHL).
- **Action when triggered:** Audit the channel-display surfaces (Spend Ledger filters, integration cards, audit-event filters) for ambiguity that only manifests with channel count > 1. Fix the surfaces that conflate channels.
- **Why it stays deferred today:** Single-channel display has no ambiguity to resolve.

### AR-CGPT-R3-1 — Multi-tab admin grant race

- **Source:** `tasks/todo.md:2752`.
- **Trigger condition:** Multi-tab admin work becomes a supported pattern, OR the first observed multi-tab admin behaviour produces a confusing audit trail or duplicate write.
- **Action when triggered:** Add a per-tab session token (or equivalent fence) to admin grant flows so two tabs cannot race. Re-test the agentic-commerce admin grant path under two-tab load.
- **Why it stays deferred today:** No customer-facing multi-tab admin flow exists yet.

### CHATGPT-R1-7 — OAuth state TTL revert decision

- **Source:** `tasks/todo.md:3098-3101`.
- **Trigger condition:** One full week of staging telemetry on `oauth_state_nonces` consumption. Specifically, segment-level data on `expired-on-callback` rate by:
  - device class (mobile vs desktop)
  - IdP type (consumer Google/Microsoft vs enterprise SSO vs MFA-required)
  - geographic latency band (if measurable)
- **Action when triggered:** Read the segment breakdown. If `expired-on-callback` rate exceeds ~2% in any segment that maps to a customer-relevant cohort (mobile, enterprise SSO, MFA), revert the TTL from 5 minutes to 10 minutes. Capture the decision in a KNOWLEDGE.md entry.
- **Why it stays deferred today:** Pre-launch has no telemetry. A blind revert would lose the security tightening from PR #264 without justification.

### F3 — `@rls-allowlist-bypass` runtime enforcement

- **Source:** `tasks/todo.md:1586` (PR #235 pre-prod-tenancy).
- **Trigger condition:** Any of the following — (a) a new admin-bypass call site is added without the `@rls-allowlist-bypass` annotation; (b) a discovered bypass abuse incident; (c) the first agency client request to audit cross-tenant access patterns.
- **Action when triggered:** Spec out audit-log vs hard-assert. Implement a runtime wrapper inside `withAdminConnectionGuarded` that either logs every bypass with caller + route or asserts the caller's authorisation. Prefer audit-log first; escalate to hard-assert only if abuse is observed.
- **Why it stays deferred today:** Annotation-based discipline has held; no observed abuse; the architectural decision needs more signal.

### DG-4 — Optimiser timezone scheduling

- **Source:** `tasks/todo.md:2402`.
- **Trigger condition:** The first customer feedback that 06:00 UTC stagger is wrong for them, OR the first agency operating in a single timezone where local 06:00 is materially different from UTC 06:00.
- **Action when triggered:** Add `timezone TEXT NOT NULL DEFAULT 'UTC'` to `subaccounts`. Update `registerOptimiserSchedule` to read it. Backfill existing rows.
- **Why it stays deferred today:** No customer to give feedback yet.

### CHATGPT-R1-4 — Audit-stream split lint rule

- **Source:** `tasks/todo.md:3090`.
- **Trigger condition:** The grep gate at `scripts/verify-audit-stream-split.sh` flags drift in a real PR — meaning a contributor wrote to the wrong stream and the grep caught it.
- **Action when triggered:** Decide between centralised audit API (mechanical enforcement) vs TypeScript ESLint rule (lint-time enforcement). Implement the chosen option. Refactor every audit call site.
- **Why it stays deferred today:** The grep gate has not yet drifted; structural enforcement is overkill for a stable surface.

---

## How to use this runbook

- After every PR merge that touches `server/routes/auth.ts`, `server/services/securityAudit*.ts`, `server/services/ghlAgencyOauthService.ts`, OAuth-related routes, agentic-commerce admin flows, the optimiser scheduler, or audit-stream writers — scan this list. Trigger conditions usually appear as small diffs that, taken alone, do not seem to warrant action.
- When a trigger is met, do NOT silently fix the deferred item. Open a small PR that names the trigger, applies the action, and updates this runbook to mark the item closed (struck through with a closure date and PR link).
- New conditional triggers added during pre-launch-phase-3 review should be appended to this file rather than buried in `tasks/todo.md`.
