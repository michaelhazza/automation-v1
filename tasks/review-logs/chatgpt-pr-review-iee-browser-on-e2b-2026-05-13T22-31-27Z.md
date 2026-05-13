# chatgpt-pr-review — iee-browser-on-e2b — 2026-05-13T22:31:27Z

PR: #297 — https://github.com/michaelhazza/2026-05-13/pull/297
Branch: `claude/migrate-browser-e2b-snI99`
Build slug: `iee-browser-on-e2b`
Mode: MANUAL (operator pastes ChatGPT-web responses)
Started by: finalisation-coordinator (inline, main session)

## Round 1

**Diff sent:** `.chatgpt-diffs/pr297-round1-code-diff.diff` (256K, 71 files)

**ChatGPT verdict:** Do not merge yet — 7 blocking + 4 should-fix findings.

### Findings table

| ID | Severity | Description (paraphrased) | Verified? | Recommendation | Triage |
|---|---|---|---|---|---|
| F1 | Blocking | Sandbox template Dockerfile not buildable: missing package.json/lockfile, no build step, fake FROM digest | YES — placeholder digest + no harness package files | Document deferred-build state in Dockerfile + CI gate; do NOT add fake package files | technical |
| F2 | Blocking | input.json injection race: writeFile after createSandbox, harness reads on start | YES — e2bSandbox.ts:295 writes after :256 createSandbox | Add wait-loop to entrypoint.sh for /workspace/input.json with hard timeout | technical |
| F3 | Blocking | Harness is success placeholder, not executor — writes status:'completed' unconditionally | YES — harness/index.ts:59 | Change placeholder to write status:'failed' with explicit reason (loud-failure pattern) | technical |
| F4 | Blocking | PUBLISHED_VERSION all-zero digest passes assertNotLatestTemplateVersion | YES — assertNotLatestTemplateVersion only rejects 'latest' literal | Extend rejection to all-zero sha256 + check at parser layer | technical |
| F5 | Blocking | RLS-protected sweeps (evictStale, gcSweep) without withAdminConnection | YES but already documented as deferred dead-code in progress.md | Re-affirm pr-reviewer + reality-checker consensus; document in progress.md/handoff.md the deferred-until-wired posture | technical (operator-accepted) |
| F6 | Blocking | UI removed Per-task budget cap field; brief locks 3 kept fields | YES — UI ships 2 fields, brief says 3 | Restore perTaskBudgetCapMinutes NumberField to OperatorSettingsTab | technical |
| F7 | Blocking | architecture.md still describes worker as Playwright executor after chunk 17 retired it | YES — lines 1145, 1157, 3231-3243 stale | Rewrite Worker service section + clean stale references | technical |
| T1 | Should-fix | Migration header comments off by one after rename | YES — all 5 migration headers say old number | Update headers to match filenames | technical |
| T2 | Should-fix | runIeeBrowserDailyRollup uses `void recordIncident(...)` | YES — line 108 | Change to `await` | technical |
| T3 | Should-fix | CurrencyField uses toFixed(1) and step=0.1 (1.0 not 1.00) | YES — _fields.tsx:76,79 | Change to toFixed(2) and step=0.01 | technical |
| T4 | Should-fix | refillIfEligible bypasses RLS / stubs sandbox IDs | YES but already documented as deferred dead-code | Same as F5 — re-affirm operator-accepted deferral | technical (operator-accepted) |

### Decisions

All 11 findings classified as **technical** per coordinator auto-decide rule (memory: feedback_auto-decide-technical.md). No findings classified as user-facing — F6 is a regression of an existing field (not a new UX policy decision), and all others are correctness/safety fixes.

Round 1 applies 9 of 11 fixes inline (F1, F2, F3, F4, F6, F7, T1, T2, T3). F5 and T4 are re-affirmed as operator-accepted deferrals (pr-reviewer + reality-checker already approved with these as dead-code TODOs); the re-affirmation is documented in progress.md / handoff.md, not in code.

### Round 1 commit

`8259da5c` — fix(iee-browser): chatgpt-pr-review Round 1 — 9 findings applied

17 files / +171 -25. G3: lint 0 errors, typecheck clean.

### Round 1 outcome

- F1: doc-only fix (Dockerfile + README + tasks/todo.md IEE-DEF-4)
- F2: defensive — entrypoint.sh wait-loop
- F3: defensive — harness fail-loud
- F4: tightened — `assertNotLatestTemplateVersion` rejects all-zero sha256
- F5: re-affirmed pr-reviewer/reality-checker deferral; IEE-DEF-1, IEE-DEF-3 in todo
- F6: regression fix — Per-task budget cap restored
- F7: rewrite — Worker service section in architecture.md
- T1: header comments aligned to filenames
- T2: `void recordIncident` → `await recordIncident`
- T3: CurrencyField 2 decimals + step 0.01
- T4: re-affirmed deferral; IEE-DEF-2 in todo

### Round 2

**Diff sent:** `.chatgpt-diffs/pr297-round2-code-diff.diff` (244K, 71 files).

**ChatGPT verdict:** Still do not merge — 7 new blockers (F8-F14) + 3 should-fix (T5-T7).

| ID | Severity | Description | Verified | Action |
|---|---|---|---|---|
| F8 | Blocking | `resolveBrowserDispatch(settings!, warmCheckout)` uses TS non-null assertion; race risk if settings changed | YES — _ieeShared.ts:178 | Use `settings ?? null`; if launch_disabled mid-dispatch, release warm session, throw |
| F9 | Blocking | Cold-start doesn't create browser_warm_sessions row → rollout doc smoke criteria wrong | YES — only warm_leased path writes | Doc-only fix to rollout doc; behaviour is by design |
| F10 | Blocking | inputFiles:[] means harness gets empty taskPayload | YES — _ieeShared.ts:236, e2bSandbox.ts:297 | Add browserTaskPayload to SandboxRunTaskInput; thread ieeTask through |
| F11 | Blocking | network.mode='none' incompatible with browser tasks | YES — _ieeShared.ts:220 | Annotate as V1 stub; track IEE-DEF-7; guarded today by SDK-not-installed + placeholder-digest rejection |
| F12 | Blocking | UI can set status='on' without seeing that rolloutApproved=false blocks dispatch | YES — UI exposes status but not rollout state | Read-only banner showing rollout state (pending/approved) |
| F13 | Blocking | patchBodySchema silently strips rolloutApproved | YES — z.object without .strict() | Make schema .strict() so unknown keys return 400 |
| F14 | Blocking | Named CI gate test is describe.skip | YES — ieeBrowserProfileManager.serialization.test.ts:7 | Replace with `describeIfE2E` env-gated pattern |
| T5 | Should-fix | callSite:'worker' stale after substrate retirement | YES | Extend enum to include 'iee-browser-warm-pool'; update warm-pool cost row to use new tag |
| T6 | Should-fix | Daily rollup filters only by subaccount_id | YES — ieeBrowserDailyRollupJob.ts:80 | Add `AND organisation_id = ${setting.organisation_id}` |
| T7 | Should-fix | 3 schema-export comments still reference old migration numbers | YES — llmRequests.ts:170,173,220 | Aligned 0347→0348 + 0349→0350 (×2) |

### Round 2 commit

`10e20212` — fix(iee-browser): chatgpt-pr-review Round 2 — 10 findings applied

12 files / +101 -22. G3: lint 0 errors, typecheck clean.

### Round 3

**Diff sent:** `.chatgpt-diffs/pr297-round3-code-diff.diff` (250K, 71 files).

**ChatGPT verdict:** Still do not merge — 4 blockers (F15-F18) + 2 should-fix (T8-T9).

| ID | Severity | Description | Verified | Action |
|---|---|---|---|---|
| F15 | Blocking | Warm-pool lease's `sandboxId` not threaded to e2bSandbox; createSandbox called even for warm dispatch | YES — _ieeShared.ts had warmSessionCheckoutId only | Added `leasedProviderSandboxId` field to SandboxRunTaskInput + e2bSandbox skip-createSandbox path |
| F16 | Blocking | browserPublishedVersionPath always loaded; placeholder digest fails synthetos provider construction | YES — registerSandboxProvider always set it | Gated behind `E2B_BROWSER_TEMPLATE_ENABLED=true` env flag |
| F17 | Blocking | evictStale / refillIfEligible / gcSweep still exported; RLS-bypass risk | YES — all three reachable | All three now throw `sandbox_provider_unavailable` at runtime — fail-loud scaffold |
| F18 | Blocking | E2B serialization gate test trivially passes with E2B_E2E=true | YES — placeholder expect(true).toBe(true) | Honest scaffold language; queued IEE-DEF-8 |
| T8 | Should-fix | Test still asserted rolloutApproved silently stripped (old passthrough behaviour) | YES — line 155-163 | Updated to assert success===false + `code: unrecognized_keys` with `keys: ['rolloutApproved']` |
| T9 | Should-fix | server/db/schema/index.ts line 346 says "migrations 0345–0349" | YES | Updated to "0346–0350" |

### Round 3 commit

`f2341dfb` — fix(iee-browser): chatgpt-pr-review Round 3 — 6 findings applied

9 files / +147 -166 (net -19 — RLS-unsafe scaffolds collapsed to throw bodies). G3: lint 0 errors, typecheck clean. Targeted vitest: 50/50 passing.

### Round 4

**Diff sent:** `.chatgpt-diffs/pr297-round4-code-diff.diff` (251K, 71 files).

**ChatGPT verdict:** **Mergeable after small comment/doc cleanup.** No new blockers. Round 3 blockers all materially addressed in the uploaded diff.

| ID | Severity | Description | Action |
|---|---|---|---|
| T10 | Should-fix | Two migration SQL header comments still drift by one (0348 says target in 0348, 0349 says FK in 0349) | Aligned to actual filenames (0349 / 0350) |
| T11 | Should-fix | checkout() should filter on template_name + compatible template_version before adoption once refill goes live | Added forward-looking TODO IEE-DEF-9 + invariant note; queued IEE-DEF-9 in tasks/todo.md |
| T12 | Should-fix | Rollout doc reads slightly ahead of implementation | Added "Blocked today" callout pointing to IEE-DEF-4/5/7 + SDK install |

### Round 4 commit

(Will be filled in after commit.)

### Final verdict

**APPROVED for merge** — chatgpt-pr-review session closed.

Operator-explicit "Mergeable after the small comment/doc cleanup" + "no new blockers found" = done signal. Round 4 fixes were comment/doc cleanup only; no runtime logic touched. Per the iterative-loop discipline, no additional round needed.

Outstanding deferred items (queued in tasks/todo.md):
- IEE-DEF-1: browserWarmPool.evictStale withAdminConnection wiring
- IEE-DEF-2: browserWarmPool.refillIfEligible org-scoping + real provisioning
- IEE-DEF-3: ieeBrowserProfileManager.gcSweep withAdminConnection wiring
- IEE-DEF-4: CI sandbox-template build pipeline + real PUBLISHED_VERSION
- IEE-DEF-5: Real Playwright executor in harness/index.ts
- IEE-DEF-6: Pre-existing host-disk profile migration decision (revisit if needed)
- IEE-DEF-7: Production network policy in dispatch
- IEE-DEF-8: Real assertions in serialization gate test
- IEE-DEF-9: Template identity validation in browserWarmPool.checkout

All gated behind SDK-not-installed factory + placeholder-digest rejection — production cannot reach any of these code paths today.
