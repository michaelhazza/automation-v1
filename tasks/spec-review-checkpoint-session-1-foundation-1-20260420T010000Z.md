# Spec Review HITL Checkpoint — Iteration 1

**Spec:** `tasks/builds/clientpulse/session-1-foundation-spec.md`
**Spec commit:** `a08433bf328712c0abc49d738f18f797959d300d` (at start of iteration 1)
**Spec-context commit:** `00a67e9bec29554f6ca9cb10d1387e7f5eeca73f`
**Iteration:** 1 of 5
**Timestamp:** 2026-04-20T01:00:00Z

This checkpoint blocks the review loop. The loop will not proceed to iteration 2 until every finding below is resolved. Resolve by editing the `Decision:` line for each finding, then re-invoking the spec-reviewer agent.

Context: iteration 1 also applied 7 mechanical findings directly to the spec (Codex #1, #3, #4, #5, #6, #7 plus a rubric catch on §8.3 stale filenames). The two findings below are directional — they pick which existing primitive the spec wires into, and those choices invalidate decisions the spec currently asserts as given. Both need a human call before the loop proceeds.

---

## Summary

| # | Finding | Question | Recommendation | Why |
|---|---------|----------|----------------|-----|
| 1.1 | Config Assistant popup session primitive | Should §5 use the existing `/api/agents/:id/conversations` contract (as the full-page assistant does today) or a new `/api/agent-runs` surface that §5.4 invents? | Rewrite §5.4, §5.9 to use the existing `/api/agents/:id/conversations/...` API surface (keyed on `conversationId`), with a server-side filter for "most recent conversation for this agent + user within N minutes" layered on top | The spec's §5.2 promises "same server-side agent loop" as the full-page assistant. The full-page assistant uses conversations. If the popup invents a different primitive, "same loop" is aspirational, not mechanical. Inventing a new endpoint family is a scope expansion, not a popup build. |
| 1.2 | Onboarding service reconciliation | Does the new wizard gate column `onboarding_completed_at` replace, extend, or sit alongside the existing `onboardingService.getOnboardingStatus` derivation (GHL connected + subaccounts + reports)? | Option A — extend the existing service: add a `needsOnboarding` boolean to the response shape; the wizard uses the new column as its gate; the existing derivation fields stay untouched and continue to drive the sync-progress screen and dashboard empty states independently | The existing service is live and consumed. The new gate column is a hard flag from the wizard. The spec doesn't say which one is load-bearing for "should I show the wizard?". If both are, the derivation fields can become stale vs the flag. |

---

## Finding 1.1 — Config Assistant popup session primitive

**Classification:** directional
**Signal matched:** Architecture signals — "Introduce a new abstraction / service / pattern" and "Change the interface of X"
**Source:** Codex
**Spec section:** §5.4 (session lifecycle), §5.9 (hook responsibilities), §5.10 (files to create)

### Finding (verbatim)

> **§5.4, §5.9, §5.10, §9** — The popup/session-resume design depends on `GET /api/agent-runs?...` and `POST /api/agent-runs/start`, but those endpoints are neither specified in detail nor inventoried anywhere, and the existing full-page assistant already uses `/api/agents/:id/conversations`, so §5 points at a different primitive than the one it claims to share.
>
> **Fix:** Pick one contract and make it explicit: either rewrite §5.4/§5.9 to use the existing conversation APIs and a `conversationId`, or add concrete `agent-runs` list/start endpoint contracts plus the corresponding `server/routes/...` / service file entries to §9.

Verified by spec-reviewer:
- `server/routes/agentRuns.ts` exists but exposes only `/api/agent-runs/:id`, `/api/agent-runs/:id/chain`, `/api/agent-runs/:id/clarify` — no list endpoint with `agentSlug` + `userId` filters, and no `POST /api/agent-runs/start`.
- `client/src/pages/ConfigAssistantPage.tsx` uses `/api/agents/:agentId/conversations/:convId/messages` — the conversation API.
- §5.2 locks "same server-side agent loop, same tools, same plan-preview-execute flow, same session lifecycle" as the full-page assistant. Using a different primitive breaks that promise mechanically.

### Recommendation

**Apply Option A — rewrite §5.4 / §5.9 to use the existing conversation primitive.** Concrete edits:

- In §5.4, replace `GET /api/agent-runs?agentSlug=configuration-assistant&userId=<me>&createdAfter=<15min-ago>&order=desc&limit=1` with: "Resolve the Configuration Assistant agent's `agentId` once on mount; call `GET /api/agents/<agentId>/conversations?userId=<me>&updatedAfter=<15min-ago>&order=updated_desc&limit=1` (adding the `userId` + `updatedAfter` + `order` + `limit` query params to the existing conversations list endpoint as a §5-owned server change). If a conversation returns, resume it by loading messages via the existing message-read endpoint. Otherwise `POST /api/agents/<agentId>/conversations` (existing) to create a fresh one, then `POST /api/agents/<agentId>/conversations/<convId>/messages` (existing) to seed the initial prompt if present."
- In §5.9, rename the stored session identifier from `configAssistant.activeSessionId` to `configAssistant.activeConversationId`; rename the hook return type to expose `conversationId: string | null` rather than `sessionId: string | null`.
- In §5.7, rename the `sessionId` prop on `<ConfigAssistantPanel>` to `conversationId`, and the `onSessionReady` callback to `onConversationReady(conversationId: string)`.
- In §5.10 / §9.3, add one new row: `server/routes/agents.ts` — Extend `GET /api/agents/:agentId/conversations` with optional query params `userId`, `updatedAfter`, `order`, `limit` to support the recent-conversation resume query.
- In §5.4, update the 15-minute resume-window constant name from `SESSION_RESUME_WINDOW_MIN` to `CONVERSATION_RESUME_WINDOW_MIN`.

Alternative: Option B — add new `POST /api/agent-runs/start` + `GET /api/agent-runs` (list) endpoints. Higher scope; adds a parallel primitive to conversations; risks diverging the popup and full-page surfaces rather than sharing. Not recommended.

### Why

The full-page Configuration Assistant already runs against `/api/agents/:id/conversations/...`. §5.2 locks "same loop, same tools, same session lifecycle." The spec's current §5.4 text points the popup at a different primitive that doesn't exist on the server, and if it did, would make the popup and full-page surfaces diverge structurally — breaking the §5.4 "real-time + concurrency" contract that both surfaces share a session.

The existing conversations endpoint is one parameter extension away from supporting the resume query (add `userId` + `updatedAfter` filters to the list endpoint). That's a much smaller server-side delta than introducing a new endpoint family.

The user-locked context for iteration 1 said "OAuth + invite email: reuse existing infrastructure" — the same principle applies here: reuse the existing conversation primitive rather than inventing a parallel one.

Option B's cost: two parallel session primitives live in the codebase for the lifetime of the popup. Higher confusion surface for future agents reading the spec or the code. No payoff — the conversation primitive already has message streaming, WebSocket updates, plan-preview-execute, and lifecycle management.

### Classification reasoning

This matches the "Architecture signals: Change the interface of X" signal and the "Introduce a new abstraction / service / pattern" signal. Picking which primitive the popup is built on top of is not a mechanical cleanup — it's a foundational architecture choice that determines how the §5 work relates to existing code. The spec asserts shared-loop behaviour but relies on a primitive that would require building a parallel run-management surface to deliver it. A human has to pick.

### Decision

Edit the line below to one of: `apply`, `apply-with-modification`, `reject`, `stop-loop`.

```
Decision: apply
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): <edit here>
```

---

## Finding 1.2 — Onboarding service reconciliation

**Classification:** directional
**Signal matched:** Architecture signals — "Change the interface of X" and "Deprecate primitive Y and replace with Z" (potential)
**Source:** spec-reviewer rubric (invariants stated in one place but not enforced in another)
**Spec section:** §7.3 (wizard gate + completion), §7.4 (onboarding endpoints), §7.5 (migration)

### Finding (verbatim)

> §7 introduces `organisations.onboarding_completed_at` as a hard gate column and redefines `GET /api/onboarding/status` to return "whether current user's org needs the wizard." The existing `server/services/onboardingService.ts` already exposes `getOnboardingStatus(orgId)` returning `{ ghlConnected, agentsProvisioned, firstRunComplete }` derived from live DB state — and the existing `server/routes/onboarding.ts` exposes this plus `getSyncStatus`, `confirm-locations`, and `notify-on-complete` endpoints. The spec does not reconcile the two: does the new column replace the derivation, extend it, or sit alongside it? Which one is load-bearing for "should I show the wizard on first sign-in?" The backfill `UPDATE ... SET onboarding_completed_at = created_at` marks every existing org as onboarded regardless of their actual derived state — which means the existing derivation becomes decorative the moment the column exists if both are consulted.

### Recommendation

**Apply Option A — extend, don't replace.** Concrete edits to the spec:

- In §7.3, add this paragraph after "Null → wizard shown; set → wizard skipped": *"`onboarding_completed_at` is the sole gate for 'should the wizard auto-open?' — the existing derivation fields (`ghlConnected`, `agentsProvisioned`, `firstRunComplete`) remain part of the response shape and continue to drive the sync-progress screen and the dashboard's empty-state messages, but they do NOT gate wizard display. The derivation and the gate are orthogonal: an org can be `onboarding_completed_at = <timestamp>` (wizard dismissed) while `ghlConnected = false` (GHL skipped), and the dashboard will correctly show the 'connect GHL' empty state even though the wizard is permanently dismissed."*
- In §7.4, extend the `GET /api/onboarding/status` response-shape description to: *"Returns `{ needsOnboarding: boolean, ghlConnected: boolean, agentsProvisioned: boolean, firstRunComplete: boolean }` — `needsOnboarding = (organisations.onboarding_completed_at IS NULL)`, and the remaining three fields carry through from the existing derivation unchanged."*
- In §7.5 (migration), change the backfill comment from `-- Backfill: existing orgs are considered onboarded (they're live)` to `-- Backfill: every existing org is marked onboarded by default. These orgs pre-date the wizard and have already completed onboarding through the old flow. Derivation fields (ghlConnected, agentsProvisioned, firstRunComplete) are independent and continue to reflect live DB state.`
- In §9.3 (already edited this iteration): keep the `server/services/onboardingService.ts` row; specifically note that the service adds the `needsOnboarding` field to the response and leaves the derivation fields unchanged.

Alternative: Option B — replace the derivation entirely. Drop `getOnboardingStatus`'s derivation fields; `GET /api/onboarding/status` returns only `{ needsOnboarding }`. Risk: dashboard empty-state messages and sync-progress screen currently consume the derivation fields; replacing would require auditing every consumer. Higher scope than Session 1 needs.

Alternative: Option C — the new column *shadows* the derivation (i.e. if column is set, trust it; if null, fall back to derivation). Risk: hybrid semantics are fragile; "onboarded" means two different things depending on which branch ran. Not recommended.

### Why

The existing service is already live. Existing consumers (dashboard, sync screen) depend on the derivation fields. The wizard only needs a hard gate for "did the user dismiss the 4-screen flow?" — that's a new concept, cleanly separable from the existing derivation.

Option A preserves the existing contract for existing consumers, adds one new field for the new consumer (the wizard redirect logic in `App.tsx`), and leaves the backfill backward-compatible. It is the minimum-viable change.

The user's locked context for iteration 1 said "reuse existing infrastructure" re: OAuth + invite email. The same principle extends: reuse the existing service, extend its response shape, don't rewrite the service's semantics.

The spec's current §7.5 backfill `UPDATE ... SET onboarding_completed_at = created_at` is correct under Option A (every existing org IS onboarded from the wizard's perspective — they predate it) but becomes misleading under Option B/C where the column is meant to be the single source of truth.

### Classification reasoning

This is an architecture signal: the spec is introducing a new gate without reconciling it with an existing primitive that covers an overlapping concept. The reconciliation decision determines whether the spec implies a small extension or a larger replacement. "Extend vs replace vs shadow" is the kind of call the human has to own — the wrong choice cascades into which consumers need updating, which tests cover the new behaviour, and what the onboarding status endpoint's semantics actually are.

### Decision

Edit the line below to one of: `apply`, `apply-with-modification`, `reject`, `stop-loop`.

```
Decision: apply
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): <edit here>
```

---

## How to resume the loop

After editing both `Decision:` lines above:

1. Save this file.
2. Re-invoke the spec-reviewer agent with the same spec path.
3. The agent will read this checkpoint file as its first action, honour each decision (apply / apply-with-modification / reject / stop-loop), and continue to iteration 2.

If you want to stop the loop entirely without resolving findings, set any decision to `stop-loop` and the loop will exit immediately after honouring the findings that have been marked `apply` or `apply-with-modification`.

---

## Iteration 1 Summary (for context)

- Mechanical findings accepted:  7 (Codex #1, #3, #4, #5, #6, #7 + rubric §8.3 stale filename)
- Mechanical findings rejected:  0
- Directional findings:          2 (this checkpoint)
- Ambiguous findings:            0
- Reclassified → directional:    0
- HITL checkpoint path:          this file
- HITL status:                   pending
