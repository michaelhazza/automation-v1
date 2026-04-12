# Spec Review Log — clientpulse-dev-spec — Iteration 5

**Spec:** `docs/clientpulse-dev-spec.md`
**Spec commit at start:** `ccb6d68e401feca01bfcce276225503a551769e3`
**Spec-context commit:** `7cc51443210f4dab6a7b407f7605a151980d2efc`
**Codex status:** Not available (Codex review CLI is designed for code diffs, not document review — rubric-only review)
**Timestamp:** 2026-04-12T07:00:00Z
**Focus:** §15 (new content added after iteration 4 exit) + cross-section consistency

## Context

Iterations 1–4 were completed in a prior session and exited via two-consecutive-mechanical-only heuristic.
The spec was subsequently updated with §15 (UX polish) in commits `bb2fe1d` and `ccb6d68`.
This is iteration 5 (the final allowed iteration under MAX_ITERATIONS = 5).

Finding 2.1 from iteration 2 (onboarding wizard state tracking) was already applied in commit `6e8a675` — confirmed in current spec §9.3.

## Finding classifications

---

FINDING #1
  Source: Rubric-contradictions
  Section: §9.2 signup handler pseudocode vs §15.1
  Description: §9.2's `signup` pseudocode signature is `signup(email, password)` and auto-generates the org name as `${email.split('@')[0]}'s Agency`, but §15.1 updates the signature to `signup(email, password, agencyName)` and removes the auto-generation — §9.2 was not updated when §15.1 was added.
  Codex's suggested fix: N/A (rubric finding)
  Classification: mechanical
  Reasoning: Direct internal contradiction between two spec sections — §9.2 specifies the old signature and §15.1 specifies the new one. The implementation (confirmed in `authService.ts`) uses the §15.1 version with `agencyName`. Updating §9.2 to match §15.1 is a pure consistency fix.
  Disposition: auto-apply

---

FINDING #2
  Source: Rubric-load-bearing-claims-without-contracts
  Section: §9.2 signup steps / §15.1 welcome email
  Description: §9.2's 5-step signup handler does not include sending a welcome email, but §15.1 specifies that a welcome email is sent "immediately after signup (before the user even starts the wizard)".
  Codex's suggested fix: N/A (rubric finding)
  Classification: mechanical
  Reasoning: Load-bearing claim in §15.1 (welcome email as part of signup) is not reflected in §9.2's signup steps. The implementation (`authService.signup`) confirms the welcome email is sent. Fixing §9.2 to include the welcome email step is a completeness fix — no scope change.
  Disposition: auto-apply (combined with Finding #1 in single edit to §9.2)

---

FINDING #3
  Source: Rubric-contradictions
  Section: §8.2.1, §8.4, §9.3 Step 3, §9.4, §10.2, §15 App.tsx additions table
  Description: §8.2.1 declares the ClientPulse Dashboard route as `/dashboard`, and this path appears in 8 locations across the spec (§§8.2.1, 8.4, 9.3, 9.4, 10.2, 14, 15.5), but §15's App.tsx additions table and the actual App.tsx implementation use `/clientpulse`.
  Classification: ambiguous
  Reasoning: The route path discrepancy is cross-cutting (8 locations) and touches a UX/product-level decision: should the ClientPulse dashboard live at `/dashboard` (the originally intended route) or `/clientpulse` (the implemented route)? The implementation chose `/clientpulse` likely to avoid conflicting with the existing `DashboardPage` mounted at `/`. This may be intentional or may be a deviation from spec intent. Cannot auto-apply — the human must confirm whether `/clientpulse` is the intended final route or whether `/dashboard` should be reclaimed (requiring either a redirect or renaming the route in App.tsx).
  Disposition: HITL-checkpoint

---

FINDING #4
  Source: Rubric-load-bearing-claims-without-contracts
  Section: §15.9 verification checklist / §15.4 "Email me when ready"
  Description: §15.4 specifies an "Email me when ready" opt-in on the sync progress screen, but §15.9's verification checklist has no corresponding item to verify this feature.
  Classification: mechanical
  Reasoning: Load-bearing feature in §15.4 without verification coverage in the same section's checklist. The checklist covers all other §15 features. Adding a verification item is a pure completeness fix with no scope change.
  Disposition: auto-apply

---

## Adjudication log

[ACCEPT] §9.2 — Signup function signature stale (missing `agencyName` parameter, using auto-generated org name)
  Fix applied: Updated §9.2 pseudocode to `signup(email, password, agencyName)`, replaced `${email.split('@')[0]}'s Agency` with `agencyName.trim()`, added welcome email as step 5 (with step 6 for JWT generation).

[ACCEPT] §9.2 — Signup steps missing welcome email
  Fix applied: Added "5. Send welcome email async (see §15.1) — fire-and-forget" to the signup handler pseudocode, renumbered existing step 5 to step 6.

[HITL] §8.2.1 / §9.3 / §9.4 / §15 — Route path /dashboard vs /clientpulse
  Written to checkpoint: `tasks/spec-review-checkpoint-clientpulse-dev-spec-5-2026-04-12T07-00-00Z.md`

[ACCEPT] §15.9 — Missing "Email me when ready" verification item
  Fix applied: Added `- [ ] "Email me when ready" option shown on sync progress screen; toast confirms opt-in` to §15.9 verification checklist.

---

## Iteration counts

- mechanical_accepted: 3 (Findings #1, #2 combined into one edit, #4 separate)
- mechanical_rejected: 0
- directional_or_ambiguous: 1 (Finding #3 → HITL)

## Iteration 5 Summary

- Mechanical findings accepted:  3
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            1
- Reclassified to directional:   0
- HITL checkpoint path:          tasks/spec-review-checkpoint-clientpulse-dev-spec-5-2026-04-12T07-00-00Z.md
- HITL status:                   pending
- Spec commit after iteration:   ccb6d68e401feca01bfcce276225503a551769e3 (changes applied in-session, not yet committed)

## Note on iteration cap

This is iteration 5 of MAX_ITERATIONS = 5. After HITL resolution, no further Codex/rubric iterations are permitted. The final report will be written after HITL resolution of Finding #3.
