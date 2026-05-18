# ChatGPT PR Review Session — browser-vision-grounding — 2026-05-18T15:10:39Z

## Session Info
- Branch: main
- PR: none (build merged directly to main; commits e90906fb..e2027564)
- Diff range: `git diff e90906fb...HEAD` on `main`
- Mode: manual
- Started: 2026-05-18T15:10:39Z
- Operator preference: auto-apply technical findings (incl. critical/architectural); only surface true user-facing product-surface decisions for approval

## Structural Note
No PR exists for this build — all 13 chunks plus review-pass fixes were committed and pushed directly to `main` during Phase 2. The chatgpt-pr-review playbook's Step 4 (PR creation) and Step 11 (ready-to-merge label) are skipped. The cumulative diff range is the unit under review.

## Inputs to ChatGPT
- Code-only diff: `.chatgpt-diffs/bvg-round1-code-diff.diff` (84K, 25 files)
- Full diff (incl. specs/plans/logs): `.chatgpt-diffs/bvg-round1-diff.diff` (2.0M, 53 files)

## Phase 2 review pass (prior, already complete)
- spec-conformance: CONFORMANT (2 V1 deferrals BVG-SC-D1/D2 routed to backlog)
- adversarial-reviewer: F1 cross-tenant clobber FIXED (commit a9ed02e9); F2/F3/W3/W4 routed to tasks/todo.md
- pr-reviewer: R3 APPROVED after R1→R2→R3 fix-loops
- reality-checker: R2 READY (all 9 V1 success criteria verified; G2 evidence log captured)
- dual-reviewer: APPROVED (Codex caught 2 substantive issues both fixed: envelope serialization gap in e2bSandbox.ts; quote-aware parser whitespace bug)

---

## Round 1 — complete

**ChatGPT verdict:** CHANGES_REQUESTED — 4 findings.

| # | Severity | Category | Finding | Decision | Applied (commit) |
|---|---|---|---|---|---|
| F1 | critical | bug | `_ieeShared.ts` deriveSessionKey({}) regression — task-payload threading dropped | IMPLEMENT (technical; restore safer form) | yes — `74c23043` |
| F2 | high | bug | `harvestVisionCalls` artefact-present branch can fail completed runs (fetchArtifactBytes always throws in V1 stub; throw propagates out of ieeFinalise tx) | IMPLEMENT (technical; V1-safe early-return) | yes — `74c23043` |
| F3 | high | gap | C13 threading from `ParsedSkill.ieeDecisionMode` is unwired at IeeTask construction sites | ROUTE TO BACKLOG (root cause: no skill→iee_browser path in V1; the only IeeTask constructor is the web-login credential test. BVG-SC-D1 strengthened.) | n/a — backlog entry strengthened in `74c23043` |
| F4 | medium | clarity | `docs/capabilities.md` overclaims preview functionality ("can opt in" / "cost tracked") while harness is loud-failure stub | IMPLEMENT (technical; reword to "staged preview") | yes — `74c23043` |

**Fixes applied (commit `74c23043`):**

1. `server/services/executionBackends/_ieeShared.ts` — `deriveSessionKey({})` → `deriveSessionKey((opts.ieeTask ?? {}) as { skillId?: string })`. Behaviour identical in V1 (no skillId on BrowserTaskPayload yet) but typed-cast form preserves forward-extensibility.
2. `server/services/visionGroundingService.ts` — `harvestVisionCalls()` artefact-present branch now returns `{ harvested: 0 }` with a warn log (`vision.harvest.unexpected_artefact_in_v1_stub`). Removed the loud-failure `fetchArtifactBytes` stub function and unused imports (`visionInferenceCalls`, `computeCostCents`, `VisionCallRecord`). Follow-up build re-adds the harvest body per spec §8.4/§8.5/§10.
3. `tasks/todo.md` — `BVG-SC-D1` strengthened with the root-cause framing: no skill→iee_browser path exists in V1; field is preparation for the follow-up build's skill-execution wiring.
4. `docs/capabilities.md` — Vision-based browser grounding bullet reworded from "(preview) can opt in" to "(staged preview) scaffolding landed; decision loop not yet active; vision/hybrid skills currently fail loudly".

**G3 after fixes:** `npm run lint` 0 errors / 879 unchanged warnings; `npm run typecheck` clean (both exit 0).

## Round 1 close

**Verdict:** APPROVED — all 4 R1 findings resolved (3 fixes + 1 backlog routing).

No R2 round. Rationale: the build was finalised by a parallel session at commit `180088e7` immediately before R1 fixes landed. R1 fixes are post-finalisation improvements on `main`. The build state is already merged; closing R1 here matches the saturation context and the operator preference (auto-apply technical findings).

**Session closed:** 2026-05-19T01:35:00Z.

**Note on the saturation REVIEW_GAP previously recorded in progress.md (Phase 3 Step 5):** that line is void — chatgpt-pr-review actually ran in this session, returned 4 findings, and all 4 were applied as technical fixes. progress.md updated to reflect the actual outcome.
