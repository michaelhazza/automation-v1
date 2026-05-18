# Dual Review Log — deterministic-validators

**Files reviewed:** entire claude/deterministic-validators-3Xjcb branch vs main; focus area = deterministic-validators only (browser-vision-grounding files explicitly excluded from prompt)
**Iterations run:** 3/3
**Timestamp:** 2026-05-18T23:42:46Z
**HEAD at start:** d53daef1 chore(deterministic-validators): persist G2 evidence
**Branch:** claude/deterministic-validators-3Xjcb
**Codex version:** codex-cli 0.125.0

---

## Iteration 1

Codex flagged three findings. All against the deterministic-validators build.

[ACCEPT] **[P1] server/lib/scorecardValidators/registry.ts:61** — `.registry-meta.json` not copied into `dist/server/lib/scorecardValidators/` by `tsc`; `loadRegistryMeta()` calls `readFileSync` with a path computed from `import.meta.url`, which after `npm run build:server && npm start` resolves to `dist/server/lib/scorecardValidators/.registry-meta.json` — a path that does not exist. Codex verified empirically: ran `npm run build:server` in its sandbox, `Test-Path` returned False, `node -e "import('./dist/.../registry.js')"` errored with ENOENT.
  Reason: confirmed production-startup blocker. Fix is small and self-contained. Plan: extend `loadRegistryMeta()` to try a small ordered set of candidate paths (next-to-module + source-tree fallback + cwd-based fallback) before throwing a clear error.

[ACCEPT] **[P2] server/schemas/scorecards.ts:17-22** — `kind`, `validatorSlug`, `validatorParameters`, `preconditionSlugs`, `preconditionParameters`, `safetyClass` are accepted on `createScorecardBody` / `updateScorecardBody` for any caller with `SCORECARDS_MANAGE`; spec §1 / §10.1 says these are "admin-gated (Synthetos staff only)" and the UI hides the editor for non-staff. `/api/validators` correctly uses `requireSystemAdmin`, but the scorecard routes use `requireOrgPermission(SCORECARDS_MANAGE)` and persist these fields verbatim through `scorecardService.create/update`. An org_admin can submit JSON directly and configure deterministic validators or safety-class flags.
  Reason: confirmed real spec gap. UI hides ≠ server enforces. Fix is a small route-layer guard. Plan: add a helper that detects/strips staff-only fields, applied in the three handlers (POST /api/scorecards, PATCH /api/scorecards/:id, POST /api/subaccounts/:subaccountId/scorecards).

[REJECT] **[P2] client/src/components/verdicts/QualityCheckValidatorSection.tsx:96-106** — Hybrid form uses a comma-separated text input for `preconditionSlugs` but captures no `preconditionParameters`. The dispatcher validates each precondition against its required `parameterSchema`; choosing `output_length_within_bounds`, `numeric_within_tolerance`, or `no_forbidden_phrase` would always produce `inconclusive parameter_mismatch`.
  Reason: this is a known directional gap routed to operator. Spec §10.1 calls for a full "ordered list of precondition entries (validator dropdown + parameter form per entry; add/remove/reorder)"; the comma-separated input is an explicit Phase 1 simplification documented in the spec-conformance log (REQ #10, REQ #14) and in tasks/todo.md lines 2348/2385. The form is staff-only — operators using it know to pick parameterless validators (output_non_empty, output_schema_valid) or to wait for the full Phase 2 editor. Building add/remove/reorder + per-slot parameter forms is a non-trivial feature, well beyond a dual-review-loop fix. The audit-log record (`inconclusive parameter_mismatch`) is the diagnostic surface a staff member sees when they pick an incompatible precondition. Defer to follow-up.

**Changes applied in iteration 1:**
- server/lib/scorecardValidators/registry.ts — `loadRegistryMeta()` now tries 3 candidate paths.
- server/routes/scorecards.ts — added `stripStaffOnlyQualityCheckFields()` helper + call in 3 handlers.

Lint + typecheck + registry tests passed.

## Iteration 2

Codex re-reviewed the diff and flagged one issue.

[ACCEPT] **[P2] server/lib/scorecardValidators/registry.ts:74** — Off-by-one in the dist-relative fallback. From `<root>/dist/server/lib/scorecardValidators`, five `..` segments overshoot to the parent of `<root>`. Should be four.
  Reason: correct catch — verified by walking the path manually. Fix: change `'..', '..', '..', '..', '..'` to four `..` segments. Also added a one-line comment explaining the count.

**Changes applied in iteration 2:**
- server/lib/scorecardValidators/registry.ts — fixed path-segment count from 5 to 4 `..` segments.

Also recognised a deeper concern: the original "strip" approach for staff-only fields silently overwrites prior values on PATCH. Considered an inline-data fallback for the registry meta, but rejected it because hardcoding `testsGreen: true` defeats the very CI-flag-driven safety this gate exists for. Replaced "throw bare error" with a remediation-rich error message and left the rest of the design intact.

Lint + typecheck + registry tests passed.

## Iteration 3

Codex re-reviewed and flagged one issue.

[ACCEPT] **[P1] server/routes/scorecards.ts:66-71** — `stripStaffOnlyQualityCheckFields` silently deletes staff-only fields from the body on PATCH. Since `scorecardService.update` REPLACES the stored `qualityChecks` array with whatever the body supplies, a non-staff PATCH that includes the full qualityChecks array (e.g. a routine name/passMark edit) would silently erase the existing validator config from every check.
  Reason: real regression. Even though no current UI flow PATCHes scorecards (verified: `updateScorecard` is exported but unused in the client), a direct API caller scripting against PATCH would lose data. Fix: switch from silent-strip to reject-with-403 when a non-staff caller submits any staff-only field with a meaningful (non-empty/non-undefined) value. The non-staff UI never sends these fields, so well-formed UI requests pass through trivially; only direct API users that include them trip the guard.

**Changes applied in iteration 3:**
- server/routes/scorecards.ts — replaced `stripStaffOnlyQualityCheckFields` with `findStaffOnlyFieldViolation` returning the first violating field name, and the three handlers now respond `403 { error: "Field \"<name>\" on quality checks is staff-only" }` instead of mutating the body.

Lint + typecheck + registry tests passed.

---

## Changes Made

- `server/lib/scorecardValidators/registry.ts` — `loadRegistryMeta()` tries 3 candidate paths (module-adjacent, source-tree fallback computed via 4 `..` segments, cwd-relative); throws a remediation-rich error when none match. Fixes production-startup ENOENT when `tsc` does not copy `.registry-meta.json` into `dist/`.
- `server/routes/scorecards.ts` — added `findStaffOnlyFieldViolation()` helper and `STAFF_ONLY_QC_FIELDS` constant; POST/PATCH/POST-subaccount handlers now reject with 403 when a non-staff caller submits any deterministic-validator field with a meaningful value on a quality check entry.

## Rejected Recommendations

- **Hybrid precondition parameter form (Codex iter-1, P2):** documented Phase 1 directional gap; full add/remove/reorder UI with per-slot parameter forms is operator-routed (todo.md lines 2348/2385). Staff-only surface — staff using it know to pick parameterless validators or to wait for the Phase 2 editor. The dispatcher's `inconclusive parameter_mismatch` audit-log entry is the diagnostic surface for a wrong choice. Building the full UI is well beyond a dual-review-loop adjudication.

- **Inline registry-meta fallback (considered iter-2, self-rejected):** would silently mask a CI-set `testsGreen: false` signal in production. Hardcoding `testsGreen: true` for every validator defeats the gate that the registry-meta system exists to enforce. Kept a remediation-rich error instead so a misconfigured deploy fails loudly.

- **Postbuild copy-assets script (considered iter-1, blocked by hook):** would have been the cleanest fix but requires editing package.json, which the project's config-protection hook gates behind explicit user approval. The dual-reviewer playbook runs autonomously and cannot pause for human input, so we used the in-source path-fallback approach instead. If a future build adopts this, the in-source fallback becomes unused but harmless.

---

**Verdict:** APPROVED (3 iterations, 2 P1 + 1 P2 fixes applied across 2 files; 1 finding deferred to documented operator-routed backlog; loop reached cap with no remaining accepted findings)
