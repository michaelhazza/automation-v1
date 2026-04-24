# Spec Review Plan — clientpulse-ui-simplification-spec

**Spec:** `docs/superpowers/specs/2026-04-24-clientpulse-ui-simplification-spec.md`
**Spec commit at start:** untracked new file (worktree-only)
**Spec-context commit:** 03cf81883b6c420567c30cfc509760020d325949
**Expected iteration count cap:** 5 (MAX_ITERATIONS)
**Stopping heuristic:** two consecutive mechanical-only rounds = stop before cap
**Pre-loop context check:**
- `docs/spec-context.md` present. Framing: pre-production, rapid-evolution, static gates primary, no feature flags, no staged rollout, commit_and_revert rollout, prefer existing primitives.
- Spec framing cross-reference: spec states "surgical code fixes", "deferred" gates for follow-on work, no feature flags, no staged rollout language. Consistent with spec-context.
- No mismatches found.
- No prior review logs for this spec slug `clientpulse-ui-simplification-spec`. Next iteration number = 1.

**Cross-reference findings from codebase inspection (will feed rubric):**
- App.tsx currently redirects `/` to `/admin/pulse` — spec claims DashboardPage is at `/`. Either route exists but is routed away, or spec mis-identifies the current state.
- `server/routes/activity.ts` already exists and exports `GET /api/activity` (org-scoped) and `GET /api/subaccounts/:id/activity`. Spec's "To create" inventory lists `server/routes/activity.ts` — contradicts the "if not already present" hedge in §4.2.
- `AdminAgentTemplatesPage.tsx` not present under client/src/pages — spec references it in §6.5.
- `CreateOrgPage.tsx` not present — spec references it in §6.8.
- `ClientPulseSettingsPage.tsx` exists, takes `user` prop in App.tsx.
- `AgentRunLivePage.tsx` route is NOT `/agent-runs/:runId` in the router based on what we saw — need to verify what route serves AgentRunLivePage.
