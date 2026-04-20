# Spec Review Final Report — ClientPulse Session 2

**Spec:** `tasks/builds/clientpulse/session-2-spec.md`
**Spec commit at start:** `6705192`
**Spec commit at finish:** staged (uncommitted)
**Spec-context commit:** head of `docs/spec-context.md` (current as of 2026-04-16)
**Iterations run:** 1 successful of 5 lifetime cap (iteration 2 aborted — Codex rate-limit)
**Exit condition:** codex-unavailable-after-convergence (iteration 1 applied 16 mechanical historical-record corrections; iteration 2 could not run to confirm convergence)
**Caller override in effect:** HITL disabled — directional/ambiguous findings would be summarised for caller adjudication rather than checkpoint-paused. None triggered in this run.

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Directional | Ambiguous | HITL status |
|---|----|----|----|----|----|----|----|
| 1 | 15 | 1 | 16 | 0 | 0 | 0 | N/A (none triggered) |
| 2 | — | — | — | — | — | — | aborted (Codex rate-limit) |

---

## Mechanical changes applied

Grouped by spec section — all applied in iteration 1, all historical-record corrections.

### Framing + status
- **§0 header** — status "Draft. Pending spec-reviewer pass" → "Historical record"; linked to progress.md.
- **§0 scope statement** — rewrote with shipped-in-full / shipped-partial / deferred-within-session / long-term-deferred explicit lists.
- **§14.6** — replaced "Ready for spec-reviewer / architect pass / implement chunk-by-chunk" with archival pointer to progress.md, session-2-plan.md, commit range.

### Ship gates + contracts
- **§1.1** — added `Status` column (passed / partial / deferred per gate); replaced verification column with actual evidence (pure-test counts, committed artefacts); fixed drilldown evidence from "tier migration" to "band transitions (90-day)"; reshaped S2-8.2 as S2-8.2 / B6 dual-identity gate.

### Phase 6.1 (B.1)
- **§2.7** — added `Shipped` column; marked `apiAdapter.integration.test.ts` deferred (outside testing posture); marked `ghlOAuthService.ts` refresh-on-expire deferred.

### Phase 6.3 (B.3)
- **§4.1** — "Tier migration history" → "Band transitions (last 90 days)" cited against `BandTransitionsTable` + `client_pulse_churn_assessments`.
- **§14 Q5 decision log** — same fix.

### Phase 6.2 dual-path UX (C.4 / B6)
- **§6.4** — removed the "Wait —" contradiction-then-retraction; clean statement that client-side pure tests are out of posture; documented parser co-located with renderer in `ConfigUpdateToolResult.tsx`.

### Phase 8.3 (C.1) notify_operator
- **§7.4** — Slack webhook URL source corrected from `organisationSecrets` → `organisations.settings.slackWebhookUrl`.
- **§7.4 `getAvailableChannels` comment** — same fix + shipped-note paragraph about `availabilityPure.ts`.
- **§7.6 Q3** — on-call preset: role audit marked deferred; documented "all org members" fallback.

### Phase 8.4 (C.3) typed templates editor
- **§8.8** — merge-field vocabulary: static list documented as shipped; `/api/.../merge-field-vocabulary` endpoint marked deferred.

### Phase 8.6 (C.5) wizard
- **§10.1** — replaced conditional-on-schema framing with deferred-to-Session-3 note tied to Screen 3 structure drift; preserved §§10.2–10.5 as archived design intent.

### D.1 create-organisation (§11.1)
- **§11.1.1** — renamed `createFromTemplate` → `createOrganisationFromTemplate`; documented the minimal 4-step behaviour that shipped; moved steps 3–4 (hierarchy_templates + system-agent seeding) to deferred; integration test deferred.
- **§11.1.2** — marked modal rebuild deferred to Session 3; archived target state.
- **§11.1.3** — tier column marked deferred.
- **§11.1.4** — added `Shipped` column; replaced `server/routes/systemOrganisations.ts` with actual landed route `server/routes/organisations.ts`; noted historical-only reference to old name.

### D.3 panel extraction (§11.3)
- **§11.3** — added deferred-to-Session-3 preamble; Session 1 URL-param plumbing documented as the resume-window enforcement path; kept §§11.3.1–11.3.5 as archived design intent.

### D.4 integration test + recordHistory (§11.4)
- **§11.4.1** — integration test deferred; standardised filename to `organisationConfig.integration.test.ts`; documented the §1.1 typo.
- **§11.4.3** — added `Shipped` column.

### Work sequence + migrations (§12)
- **§12.1 chunk table** — added `Landed` column with per-chunk status + commit hashes for all 14 rows.
- **§12.4** — documented Session 1 skipped `0183` (out-of-band re-slot); `0184` is a platform-side migration; Session 2 shipped only `0185`; conditional migrations 0186+ either "not needed" or "not shipped".

### File inventory (§13)
- **§13.1** (new server files) — added `Shipped` column; annotated every deferred migration with "not needed" / "deferred" reason.
- **§13.2** (server modifications) — added `Shipped` column; added landed route `server/routes/organisations.ts`; marked `ghlOAuthService.ts` deferred; marked `server/db/schema/organisations.ts` tier column deferred; added `server/services/orgConfigService.ts` + 4 `server/skills/crm.*.md` stubs landed in audit commit 6705192.
- **§13.3** (server test files) — added `Shipped` column; marked 2 deferred tests (adapter integration, org-config integration).
- **§13.4** (new client files) — added `Shipped` column; marked `ConfigAssistantPanel.tsx` deferred.
- **§13.5** (client modifications) — added `Shipped` column; marked `ConfigAssistantPopup.tsx`, `ConfigAssistantPage.tsx`, `useConfigAssistantPopup.tsx`, `OnboardingWizardPage.tsx`, `SystemOrganisationsPage.tsx` as deferred or partial.

---

## Rejected findings

None — all 16 findings were classified as mechanical and accepted in full.

---

## Directional and ambiguous findings (resolved via HITL)

None — iteration 1 produced no directional or ambiguous findings. All drift was historical-accuracy correction appropriate for mechanical auto-apply.

---

## Open questions deferred by `stop-loop`

None — the loop was not stopped by the human. Iteration 2 aborted due to Codex rate-limit; convergence not formally confirmed but self-rubric pass shows no new drift introduced by iteration 1 edits.

---

## Mechanically tight, but verify directionally

This spec is now mechanically tight — it accurately describes what Session 2 shipped and what deferred. However:

1. **Iteration 2 did not run.** Codex hit its usage limit before the convergence pass could fire. The self-rubric pass shows the iteration-1 edits are internally consistent, but a full second Codex review was not possible. If the spec enters another review cycle (after substantive edits or after the rate-limit window reopens), run iteration 2 then.

2. **Archived design intent preserved.** §§10.2–10.5 (C.5 wizard controls), §§11.1.2–11.1.4 (D.1 modal rebuild), §§11.3.1–11.3.5 (D.3 panel extraction) retain their original forward-looking prose under `deferred` markers. This is deliberate — Session 3 pickup will consume them. Do not be surprised when those sections read as if work is pending; they describe work that IS pending (in Session 3), framed by a deferred-marker preamble.

3. **Sessions-context pointer stable.** `docs/spec-context.md` was read; no mismatch detected against the spec's framing (both agree on pre-production, static-gates-primary testing, commit-and-revert rollout). No HITL was needed to reconcile context.

4. **Lifetime iteration count used: 1/5.** Four iterations remain in the spec's lifetime cap should future review be needed.

**Recommended next step:** if the user accepts these edits, commit them with a `docs(clientpulse)` prefix. A future spec-reviewer invocation after the Codex rate-limit resets could confirm convergence; if substantive edits happen before then, it should pick up at iteration 2.
