# Spec Review HITL Checkpoint — Iteration 5

**Spec:** `docs/clientpulse-dev-spec.md`
**Spec commit:** `ccb6d68e401feca01bfcce276225503a551769e3`
**Spec-context commit:** `7cc51443210f4dab6a7b407f7605a151980d2efc`
**Iteration:** 5 of 5
**Timestamp:** 2026-04-12T07:00:00Z

This checkpoint blocks the review loop. This is the final allowed iteration (MAX_ITERATIONS = 5). After you resolve the finding below, the spec-reviewer will write the final report. There will be no further Codex/rubric iteration.

Mechanical fixes for this iteration (3 findings) have already been applied to `docs/clientpulse-dev-spec.md` without blocking:
1. §9.2 — Updated `signup()` pseudocode to add `agencyName` parameter, replaced auto-generated org name with `agencyName.trim()`
2. §9.2 — Added welcome email as step 5 in the signup handler (fire-and-forget), renumbered old step 5 → step 6
3. §15.9 — Added missing "Email me when ready" verification item to the checklist

---

## Finding 5.1 — ClientPulse dashboard route: `/dashboard` vs `/clientpulse`

**Classification:** ambiguous
**Signal matched:** Could be "Contradictions" (mechanical — pick one, align all references) or "Change the interface of X" (directional — route path is a UX/product call affecting the app's navigation structure)
**Source:** Rubric-contradictions
**Spec section:** §8.2.1 (primary declaration), also §8.4, §9.3 Step 3, §9.4, §10.2, §14 design decisions, §15.5, §15 App.tsx additions table

### Spec's current state (the contradiction)

Eight locations in the spec say `/dashboard` for the ClientPulse Dashboard route:

1. **§8.2.1** — `**Route:** /dashboard (top-level, first thing users see after onboarding)`
2. **§8.4** — `- [ ] ClientPulse org lands on /dashboard after login`
3. **§9.3 Step 3** — `then redirect to /dashboard when the first Reporting Agent run completes`
4. **§9.4** — `After the first report is generated, redirect to /dashboard`
5. **§10.2** — `success redirects to /dashboard`
6. **§14 design decisions** — `Keep existing dashboard; /dashboard only for ClientPulse module orgs`
7. **§15.5** — `Instead of silently redirecting to /dashboard, show a brief celebration interstitial`

One location says `/clientpulse`:

8. **§15 App.tsx additions table** — `routes for ... /clientpulse, /reports, /reports/:id, /system/modules`

The **actual App.tsx implementation** (`ccb6d68`) mounts `ClientPulseDashboardPage` at `/clientpulse`, not `/dashboard`.

### Tentative recommendation (non-authoritative)

**Option A — Confirm `/clientpulse` as the intended route:** Update all 7 `/dashboard` references in §§8.2.1, 8.4, 9.3, 9.4, 10.2, 14, and 15.5 to say `/clientpulse`. The rationale for `/clientpulse` is that the existing `DashboardPage` is already mounted at `/` and `/dashboard` would conflict with nav conventions for the full-access tier.

**Option B — Reclaim `/dashboard` as the route:** Update the App.tsx implementation to mount `ClientPulseDashboardPage` at `/dashboard` (or add a redirect from `/dashboard` → `/clientpulse`, or rename). Then update §15's App.tsx table to say `/dashboard`. This matches the original spec intent and keeps the URL user-friendly.

**Option C — Keep `/clientpulse` for now, add a redirect from `/dashboard`:** Mount at `/clientpulse` and add `<Route path="/dashboard" element={<Navigate to="/clientpulse" replace />} />` to App.tsx. Update the spec to say the canonical route is `/clientpulse` with a redirect from `/dashboard`. This is the safest migration path if `/dashboard` was shared in any early docs or bookmarks.

### Reasoning

The route path discrepancy spans 8 spec locations and reflects a real implementation choice that diverged from the original spec intent. The original §8.2.1 design said `/dashboard` — presumably because "dashboard" is the most natural URL for this page. The implementation chose `/clientpulse` — presumably to avoid conflict with the existing operator `DashboardPage` at `/`.

Neither choice is obviously wrong. `/clientpulse` is more specific (avoids future conflicts, makes the page purpose explicit in the URL). `/dashboard` is simpler for users to remember. The full-access tier uses `/` as its landing page (not `/dashboard`), so `/dashboard` is actually available for ClientPulse.

This is classified as ambiguous because: fixing a spec-vs-spec contradiction looks mechanical (just pick one), but the route path itself is a UX/product decision with downstream consequences (user bookmarks, internal links, Stripe redirect URLs, future onboarding instructions).

### Decision

Edit the line below to one of: `apply`, `apply-with-modification`, `reject`, `stop-loop`. If `apply-with-modification`, add the modification inline. If `reject`, add a one-sentence reason.

```
Decision: apply-with-modification
Modification (if apply-with-modification): Option A — update all 7 `/dashboard` references in the spec (§§8.2.1, 8.4, 9.3, 9.4, 10.2, 14, 15.5) to `/clientpulse`. Rationale: ClientPulse is an agency-specific product and `/clientpulse` is the honest route name. The existing `/` is already the reusable Synthetos dashboard. A generic `/dashboard` hub would not be meaningful for non-agency orgs and is not worth the complexity.
Reject reason (if reject): 
```

---

## How to resume the loop

After editing the `Decision:` line above:

1. Save this file.
2. Re-invoke the spec-reviewer agent with the same spec path.
3. The agent will read this checkpoint file, honour the decision, and write the **final report** (no further iterations — this was iteration 5 of 5).

**Note:** If you choose `apply` or `apply-with-modification` for Option A (update spec to `/clientpulse`), the agent will update all 7 `/dashboard` references in the spec. If you choose Option B (update implementation to `/dashboard`), write that as `apply-with-modification` with the instruction to update §15's App.tsx table to say `/dashboard` instead of `/clientpulse` — the implementation changes to App.tsx are out of scope for spec review (do that separately).
