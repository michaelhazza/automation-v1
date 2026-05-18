# Framework preflight-diff report

> Generated: 2026-05-17T06:48:29.066Z
> Bundle:    `setup/portable/` (v2.4.0)
> Substitutions:
>   - `PROJECT_NAME` → `Automation OS`
>   - `PROJECT_DESCRIPTION` → `an AI agent orchestration platform`
>   - `STACK_DESCRIPTION` → `React, Express, Drizzle ORM (PostgreSQL), and pg-boss for job scheduling`
>   - `COMPANY_NAME` → `Synthetos`

## Counts

| Bucket | Count |
|---|---|
| CLEAN | 29 |
| MISSING-DEPLOYED | 1 |
| MISSING-BUNDLE | 2 |
| DIFFERS | 19 |
| MISSING-BOTH | 0 |

## CLEAN (no action — bundle + deployed match after substitution)

- `.claude/agents/adversarial-reviewer.md`
- `.claude/agents/chatgpt-plan-review.md`
- `.claude/agents/chatgpt-spec-review.md`
- `.claude/agents/codebase-explainer.md`
- `.claude/agents/context-pack-loader.md`
- `.claude/agents/feature-coordinator.md`
- `.claude/agents/finalisation-coordinator.md`
- `.claude/agents/incident-commander.md`
- `.claude/agents/mockup-designer.md`
- `.claude/agents/reality-checker.md`
- `.claude/agents/spec-coordinator.md`
- `.claude/agents/spec-reviewer.md`
- `.claude/agents/triage-agent.md`
- `.claude/agents/validate-setup.md`
- `.claude/hooks/code-graph-freshness-check.js`
- `.claude/hooks/config-protection.js`
- `.claude/hooks/correction-nudge.js`
- `.claude/hooks/long-doc-guard.js`
- `.claude/FRAMEWORK_VERSION`
- `docs/decisions/0001-mixed-mode-review-agents.md`
- `docs/decisions/0002-interactive-vs-walkaway-review-agents.md`
- `docs/decisions/0005-risk-class-split-rollout-pattern.md`
- `docs/decisions/_template.md`
- `docs/context-packs/debug.md`
- `docs/context-packs/minimal.md`
- `docs/context-packs/README.md`
- `docs/spec-authoring-checklist.md`
- `docs/incident-response.md`
- `docs/frontend-design-examples.md`

## MISSING-DEPLOYED (in bundle, NOT in repo — adopt will write fresh)

- `references/verification-commands.md`

## MISSING-BUNDLE (in repo, NOT in bundle — orphan or pre-existing)

- `.claude/hooks/arch-guard.sh`
- `.claude/hooks/rls-migration-guard.js`

## DIFFERS (deployed content does not match substituted bundle)

For each entry, classify into:
- **(a)** project customisation — accept; `.framework-new` discardable on adopt rebaseline
- **(b)** framework drift — backport to claude-code-framework + bump to v2.4.1
- **(c)** accidental drift — accept bundle version; overwrite locally before adopt

### `.claude/agents/architect.md`

```diff
@@ -171,10 +171,10 @@
 **What every chunk's "Verification commands" section IS allowed to contain:**
 - `npm run lint` and `npm run typecheck` (or `npx tsc --noEmit`).
 - `npm run build:server` / `npm run build:client` when the chunk touches the build surface.
-- **Targeted execution of unit tests authored in THIS chunk** — a single file via `npx tsx <path-to-test>`. Authoring new tests and new gate scripts is encouraged; running the rest of the suite is not.
+- **Targeted execution of unit tests authored in THIS chunk** — a single file via `npx vitest run <path-to-test>`. Tests must use Vitest (`import { test, expect } from 'vitest'`); never `node:test`, `node:assert`, or `npx tsx`-runnable harnesses. See `docs/testing-conventions.md`. Authoring new tests and new gate scripts is encouraged; running the rest of the suite is not.
 
 **If a chunk's correctness depends on a gate-level invariant**, write a targeted unit test for that invariant inside the chunk. The test runs locally on its own (single file). The chunk is responsible for the test passing; CI is responsible for proving nothing else regressed.
 
 ### What this means for the plan document
 
 - Each chunk's "Verification commands" section lists ONLY lint, typecheck, build:server/client (when relevant), and targeted unit tests for that chunk. No `scripts/verify-*.sh`, no `npm run test:*` umbrella commands.
```

### `.claude/agents/audit-runner.md`

```diff
@@ -142,10 +142,10 @@
    |---|---|
    | Server typecheck | `npm run build:server` |
    | Client build | `npm run build:client` (if `client/` or `shared/` changed) |
-   | Targeted unit tests | Only the test files authored or modified by this fix — `npx tsx <path-to-test>`. Skip if the fix touched no test file. |
+   | Targeted unit tests | Only the test files authored or modified by this fix — `npx vitest run <path-to-test>` (Vitest is the runner; never `npx tsx` or handwritten harnesses — see `docs/testing-conventions.md`). Skip if the fix touched no test file. |
    | Skill visibility | `npm run skills:verify-visibility` (only if skills changed AND this command is fast — single-file scope. If it scans the whole repo, defer to CI.) |
    | Playbooks | `npm run playbooks:validate` (only if `server/lib/workflow/` changed AND single-playbook scope is supported — full-repo validation defers to CI.) |
 
    If an audit pass identifies a missing static gate (a new `scripts/verify-*.sh` the codebase ought to have), authoring it is in scope for the audit. **Running the broader gate suite to "confirm" the new gate works is not** — write a targeted unit test for the gate's pure logic if you can; otherwise let CI run it.
 
 4. If any check fails, revert the area's commits (`git reset --hard <last-good-tag>`) and route findings to pass 3. **Do not retry the same fix twice** (CLAUDE.md Stuck Detection Protocol).
@@ -257,10 +257,10 @@
 When an audit produces findings that are resolved through a multi-chunk remediation programme, the plan you (or the architect) hand off must **not** schedule any gate run in any phase. Continuous integration runs the complete suite as a pre-merge gate when the remediation branch's PR is opened.
 
 - **Forbidden anywhere in a remediation plan:** `npm run test:gates`, `npm run test:qa`, `npm run test:unit`, the umbrella `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`. No "baseline gate sweep", no "Programme-end full gate set", no per-chunk gate hook.
-- **Per-chunk verification is limited to:** `npm run lint`, `npm run typecheck` (or `npx tsc --noEmit`), `npm run build:server` / `npm run build:client` when the build surface changes, and **targeted execution of unit tests authored in THAT chunk** (single file via `npx tsx <path-to-test>`). Document this in the remediation plan's Executor notes and in every per-chunk "Verification commands" section.
+- **Per-chunk verification is limited to:** `npm run lint`, `npm run typecheck` (or `npx tsc --noEmit`), `npm run build:server` / `npm run build:client` when the build surface changes, and **targeted execution of unit tests authored in THAT chunk** (single Vitest file via `npx vitest run <path-to-test>` — never `npx tsx` or handwritten harnesses; see `docs/testing-conventions.md`). Document this in the remediation plan's Executor notes and in every per-chunk "Verification commands" section.
 - If a remediation chunk depends on a gate-level invariant, write a targeted unit test for that invariant inside the chunk. Do not lean on the gate script — CI will run it.
 
 See also: `architect.md` § *Test gates are CI-only — never put them in a plan* — the architect enforces the same rule when producing implementation plans, and `CLAUDE.md` § *Test gates are CI-only — never run locally* for the canonical project-wide rule.
 
 ---
 
```

### `.claude/agents/builder.md`

```diff
@@ -76,69 +76,69 @@
 
 ### CI-gate pre-flight (apply WHILE writing — these gates are CI-only, not in G1)
 
-The G1 gate (lint + typecheck) does NOT exercise the static-gate scripts that run in CI. Before writing the chunk, scan `scripts/verify-*.sh` (or equivalent project gate scripts) so you can satisfy them while writing rather than retroactively after CI red. Common categories: test-file location + naming conventions, migration patterns, architecture-rule guards (e.g. "queries live in services"), foreign-key delete behaviours. The project's own `KNOWLEDGE.md` / `docs/` should enumerate the specific gates and their failure modes.
+The G1 gate (lint + typecheck) does NOT exercise the static-gate scripts that run in CI. The four most common Phase-3 failure modes that G1 misses — and that you must satisfy WHILE writing the chunk:
 
-## Step 4 — G1 gate
+1. **Test-file location AND `.js` extension on relative imports.** Every `*.test.ts` / `*.test.tsx` MUST live under a `__tests__/` directory next to the module being tested. Path-only inline locations (`server/services/foo.test.ts`) are silently invisible to Vitest's discovery glob and rejected by `verify-test-quality.sh`. Correct shape: `server/services/__tests__/foo.test.ts` AND the relative import must end in `.js` (e.g. `from '../fooPure.js'` — NOT `from '../fooPure'` and NOT `from './fooPure'`). The `.js` extension is required by both the project's TypeScript-ESM `nodenext` resolution AND `verify-pure-helper-convention.sh` (its regex is `from\s+'(\.\./|\./)[^']+\.js'`). Same rules for `client/src/**/*.test.ts`. See `docs/testing-conventions.md § Test discovery`.
 
-After implementation, run all applicable checks. Cap at 3 attempts per check.
+2. **CREATE POLICY one-liner in migrations.** `verify-rls-coverage.sh` is line-oriented grep. Write `CREATE POLICY <name> ON <table>` on a single line — never split `CREATE POLICY <name>\n  ON <table>` across two lines. The body (`USING (...)`/`WITH CHECK (...)`) can wrap normally; only the `CREATE POLICY ... ON <table>` opener must be on one line.
 
-```bash
+3. **No raw `db` import outside `server/services/**`.** `verify-rls-contract-compliance.sh` enforces "queries live in services". If a chunk needs a tiny lib helper (e.g. a route-side ownership check), either use `getOrgScopedDb` (allowed in `server/lib/orgScopedDb.ts` callers anywhere) OR add the helper to a `server/services/` file. New `server/lib/*.ts` files that import `db` directly are blocked unless added to the gate's `ALLOWLIST_DIRS` array — note the precedent (`resolveSubaccount.ts`, `resolveAgent.ts`) but extending the allowlist is a deliberate decision, not the default path.
-# Lint (always)
+
-npx eslint <touched files>
+4. **FK references to `agent_execution_events(id)` in new migrations.** Default `ON DELETE NO ACTION` blocks integration-test cleanup that deletes events. For pointer columns (nullable: "last seen", "current focus") use `ON DELETE SET NULL`. For dependent rows (NOT NULL: "this row was generated from this event") use `ON DELETE CASCADE` — but think about retention: if events are pruned by a job, do you want the dependent row pruned too? If yes, CASCADE; if no, design the row to outlive the event with a separate retention policy.
 
-# Typecheck (always — tsc cannot be scoped to individual files)
+These four are the gates that bit `agent-workspace` Phase 3 (PR #276) hardest. Each is mechanical: it costs ~30 seconds to comply while writing the chunk and ~30 minutes to fix retroactively after CI red.
-npm run typecheck
+
-
+## Step 4 — G1 gate
-# Build: server (if server/ files touched)
+
-npm run build:server
+After implementation, run all applicable checks. Cap at 3 attempts per check.
 
-# Build: client (if client/ files touched)
+```bash
-npm run build:client
+# Lint (always)
-
+npx eslint <touched files>
-# Targeted unit tests (ONLY for new pure functions with no DB/network/filesystem side effects)
+
-npx tsx <path-to-new-test-file>
+# Typecheck (always — tsc cannot be scoped to individual files)
-```
+npm run typecheck
 
-On each failure: read the diagnostic, fix the specific issue, re-run.
+# Build: server (if server/ files touched)
-On the fourth attempt of any check → STOP. Return:
+npm run build:server
 
-```
+# Build: client (if client/ files touched)
-Verdict: G1_FAILED
+npm run build:client
-G1 diagnostic: <exact error output>
+
-```
+# Targeted unit tests (ONLY for new pure functions with no DB/network/filesystem side effects)
-
+# Runner is Vitest — see docs/testing-conventions.md. Never `npx tsx`, `node:test`, or handwritten harnesses.
-**NEVER run:** `npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `bash scripts/run-all-*.sh`, or any `scripts/gates/*.sh` — CI-only per CLAUDE.md.
+npx vitest run <path-to-new-test-file>
-
+```
-## Step 5 — Return summary
+
-
+On each failure: read the diagnostic, fix the specific issue, re-run.
-Return to caller:
+On the fourth attempt of any check → STOP. Return:
 
 ```
-Verdict: SUCCESS | PLAN_GAP | G1_FAILED
+Verdict: G1_FAILED
-Files changed: [list of paths]
+G1 diagnostic: <exact error output>
-Spec sections: [list of §X.X numbers this chunk implements]
+```
-What was implemented: [one paragraph]
+
-Plan gap (if any): [description]
+**NEVER run:** `npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `bash scripts/run-all-*.sh`, or any `scripts/gates/*.sh` — CI-only per CLAUDE.md.
-G1 attempts (per check): {lint: N, typecheck: N, build:server: N, build:client: N, targeted tests: N}
+
-Notes for caller: [out-of-scope observations — dead code, smells, drift; do NOT fix in this chunk; route to tasks/todo.md]
+## Step 5 — Return summary
-```
+
-
+Return to caller:
-## Hard rules
+
-
+```
-- Never invoke other agents.
+Verdict: SUCCESS | PLAN_GAP | G1_FAILED
-- Never commit. The caller (feature-coordinator) commits at chunk boundaries.
+Files changed: [list of paths]
-- Never write to `tasks/current-focus.md` or `tasks/builds/{slug}/handoff.md` — coordinator-owned.
+Spec sections: [list of §X.X numbers this chunk implements]
-- Never run full test gates (see Step 4 forbidden list).
+What was implemented: [one paragraph]
-- Never `--no-verify`, never amend a commit.
+Plan gap (if any): [description]
-
+G1 attempts (per check): {lint: N, typecheck: N, build:server: N, build:client: N, targeted tests: N}
+Notes for caller: [out-of-scope observations — dead code, smells, drift; do NOT fix in this chunk; route to tasks/todo.md]
+```
+
+## Hard rules
+
+- Never invoke other agents.
+- Never commit. The caller (feature-coordinator) commits at chunk boundaries.
+- Never write to `tasks/current-focus.md` or `tasks/builds/{slug}/handoff.md` — coordinator-owned.
+- Never run full test gates (see Step 4 forbidden list).
+- Never `--no-verify`, never amend a commit.
+
```

### `.claude/agents/chatgpt-pr-review.md`

```diff
@@ -1004,10 +1004,10 @@
   `scripts/gates/*.sh`, or `scripts/run-all-*.sh` per round, between rounds,
   or at finalization. Continuous integration runs the complete suite as a
   pre-merge gate on the PR. If a round authored a single new test file,
-  running only that file via `npx tsx <path-to-test>` to confirm it passes
+  running only that file via `npx vitest run <path-to-test>` to confirm it passes
   is allowed; running the rest of the suite is not. If ChatGPT recommends
   running gates locally, classify the finding as `defer` with reason
   "test gates are CI-only per CLAUDE.md" and log accordingly. See
   `CLAUDE.md` § *Test gates are CI-only — never run locally*.
 - Never modify files outside this PR scope during a round.
 - When unsure: recommend `defer` and explain why. For a `technical` finding
```

### `.claude/agents/dual-reviewer.md`

```diff
@@ -190,5 +190,5 @@
 - Never implement more than what the accepted recommendation asks for.
 - If Codex output is empty or clearly truncated, retry the `codex review` command once. If it fails again, skip that iteration and note it in the output.
 - If the Codex CLI fails to run (non-zero exit, auth error), stop immediately and report the exact error to the caller.
-- **Test gates are CI-only — never run them and never accept a Codex recommendation that asks you to.** Continuous integration runs the complete suite as a pre-merge gate. If Codex recommends running `npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, or `scripts/run-all-*.sh` — or recommends running the broader test suite to "confirm no regression" / "verify the fix" — classify the recommendation as `[REJECT]` with reason "test gates are CI-only per CLAUDE.md § *Test gates are CI-only — never run locally*; CI will run the suite on the PR". Targeted execution of unit tests authored as part of an accepted fix is allowed (single file via `npx tsx <path-to-test>`). See `CLAUDE.md` § *Test gates are CI-only — never run locally*.
+- **Test gates are CI-only — never run them and never accept a Codex recommendation that asks you to.** Continuous integration runs the complete suite as a pre-merge gate. If Codex recommends running `npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, or `scripts/run-all-*.sh` — or recommends running the broader test suite to "confirm no regression" / "verify the fix" — classify the recommendation as `[REJECT]` with reason "test gates are CI-only per CLAUDE.md § *Test gates are CI-only — never run locally*; CI will run the suite on the PR". Targeted execution of unit tests authored as part of an accepted fix is allowed (single file via `npx vitest run <path-to-test>`). See `CLAUDE.md` § *Test gates are CI-only — never run locally*.
 
```

### `.claude/agents/hotfix.md`

```diff
@@ -70,10 +70,10 @@
 
 ### Step 6 — Author or update one targeted test
 
-The bug existed because no test caught it. Add the test that would have. One test, scoped to the failure mode. Use the project's targeted-test idiom (e.g. `npx tsx <path-to-test>`).
+The bug existed because no test caught it. Add the test that would have. One test, scoped to the failure mode. Use the project's Vitest convention — `**/__tests__/*.test.ts`, `import { test, expect } from 'vitest'`, run via `npx vitest run <path-to-test>`. Never `node:test`, `node:assert`, or `npx tsx`-runnable harnesses. See `docs/testing-conventions.md`.
 
 If the existing tests already covered the case, the gap is in fixture realism — note that in the KNOWLEDGE entry but don't author duplicate tests.
 
 ### Step 7 — Run targeted checks (only)
 
 Run, in order:
@@ -79,10 +79,10 @@
 Run, in order:
 1. `npm run lint`
 2. `npm run typecheck`
-3. The new / updated test file via `npx tsx <path>`
+3. The new / updated test file via `npx vitest run <path>`
 
 Do NOT run `npm test`, `npm run test:gates`, `scripts/verify-*.sh`, or any other gate / repo-wide verifier. See [`references/test-gate-policy.md`](../../references/test-gate-policy.md) — CI runs the full battery on the PR.
 
 If any of the three targeted checks fail, fix and re-run. After 2 failed fix attempts on the same check, STOP and escalate.
 
 ### Step 8 — pr-reviewer
```

### `.claude/agents/pr-reviewer.md`

```diff
@@ -34,10 +34,10 @@
 
 ### 🟡 Should-fix — non-blocking but expected to be addressed in-PR unless explicitly deferred
 
-- Missing test coverage for new behaviour — describe the missing test in Given/When/Then format so the main session has a clear spec to implement. The implementer authors and runs ONLY the new test file locally (`npx tsx <path-to-test>` or the project's targeted-test idiom); the broader suite runs in CI on the PR — never ask the implementer to run `npm test` or any test-gate command.
+- Missing test coverage for new behaviour — describe the missing test in Given/When/Then format so the main session has a clear spec to implement. The implementer authors a Vitest test (`**/__tests__/*.test.ts`, `import { test, expect } from 'vitest'`) and runs ONLY that file locally via `npx vitest run <path-to-test>`. Never recommend `npx tsx`, `node:test`, or handwritten harnesses — they are rejected by `scripts/verify-test-quality.sh`. The broader suite runs in CI on the PR; never ask the implementer to run `npm test` or any test-gate command.
 - Opportunities where a simpler approach exists — with concrete suggestion
 - Performance issues that will matter at scale — with evidence, not speculation
 - **Shallow modules** — for any new module, service, class, or non-trivial helper introduced by these changes, ask: is the public interface more complex than the implementation behind it? Smell signals: a wrapper that forwards arguments verbatim to a single underlying call; a service whose every method maps 1:1 to a table row; an exported type surface (options bag, return shape, error union) larger than the body it guards; a "manager" or "helper" file whose only job is re-exporting. When the smell is present, name it and propose either inlining at the call site or absorbing the surface into a neighbouring deep module. Do NOT flag established thin layers that exist for a documented reason (route → service → db tier separation, asyncHandler wrappers, the resolveSubaccount guard) — those are conventions, not shallow modules.
 
 ### 💭 Consider — taste / future-proofing / nice-to-have
 
@@ -147,5 +147,5 @@
 - Don't nitpick style unless it violates a documented convention
 - When flagging missing tests, write the test description in Given/When/Then so it's immediately actionable
 - You have read-only tools. You review, you do not fix. Return your findings and let the main session implement.
-- **Test gates are CI-only — never recommend running them locally.** Do not ask the implementer to run `npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, or `scripts/run-all-*.sh` as part of resolving a finding. Continuous integration runs the complete suite as a pre-merge gate. If you flag a missing test, the implementer authors it and runs only that single file (`npx tsx <path-to-test>`) — CI runs everything else. See `CLAUDE.md` § *Test gates are CI-only — never run locally*.
+- **Test gates are CI-only — never recommend running them locally.** Do not ask the implementer to run `npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, or `scripts/run-all-*.sh` as part of resolving a finding. Continuous integration runs the complete suite as a pre-merge gate. If you flag a missing test, the implementer authors it and runs only that single file (`npx vitest run <path-to-test>`) — CI runs everything else. See `CLAUDE.md` § *Test gates are CI-only — never run locally*.
 
```

### `.claude/agents/spec-conformance.md`

```diff
@@ -406,5 +406,5 @@
 - **You run once per invocation.** No iteration loop. If mechanical fixes pass verification in Step 5, you are done.
 - **If the spec is not detected, you stop and report — you do not guess.** Better to return "no spec detected" than to verify against the wrong document.
 - **If mechanical fixes modified any files, the caller should re-run `pr-reviewer` on the expanded changed-code set** before creating the PR. Flag this explicitly in the Next step section of the final log.
-- **Test gates are CI-only — never run them.** Do NOT run `npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, or `scripts/run-all-*.sh` — not as part of Step 5 re-verification, not as a "confirm the mechanical fix didn't regress anything" check, not in any framing. Continuous integration runs the complete suite as a pre-merge gate. Step 5 re-verification is limited to reading the affected file back to confirm the edit landed. If the spec named a specific test case and a mechanical fix authored that test, you may run only that single file via `npx tsx <path-to-test>` to confirm it passes. See `CLAUDE.md` § *Test gates are CI-only — never run locally*.
+- **Test gates are CI-only — never run them.** Do NOT run `npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, or `scripts/run-all-*.sh` — not as part of Step 5 re-verification, not as a "confirm the mechanical fix didn't regress anything" check, not in any framing. Continuous integration runs the complete suite as a pre-merge gate. Step 5 re-verification is limited to reading the affected file back to confirm the edit landed. If the spec named a specific test case and a mechanical fix authored that test, you may run only that single file via `npx vitest run <path-to-test>` to confirm it passes. See `CLAUDE.md` § *Test gates are CI-only — never run locally*.
 
```

### `.claude/settings.json`

```diff
@@ -43,27 +43,27 @@
         ]
       }
     ],
-    "SessionStart": [
+    "PostToolUse": [
       {
-        "hooks": [
+        "matcher": "Write|Edit|MultiEdit",
-          {
+        "hooks": [
-            "type": "command",
+          {
-            "command": "node ${CLAUDE_PROJECT_DIR}/.claude/hooks/code-graph-freshness-check.js"
+            "type": "command",
-          }
+            "command": "node ${CLAUDE_PROJECT_DIR}/.claude/hooks/rls-migration-guard.js"
-        ]
+          }
-      }
+        ]
-    ]
+      }
-  }
+    ],
-}
+    "SessionStart": [
-
+      {
+        "hooks": [
+          {
+            "type": "command",
+            "command": "node ${CLAUDE_PROJECT_DIR}/.claude/hooks/code-graph-freshness-check.js"
+          }
+        ]
+      }
+    ]
+  }
+}
+
```

### `.claude/CHANGELOG.md`

```diff
@@ -30,138 +30,138 @@
 
 Repos can stay on older versions intentionally. The framework is designed to be additive; older versions don't break.
 
----
+## Version authority — single source of truth
 
-## 2.4.0 — 2026-05-15
+**The portable bundle (`setup/portable/.claude/`) is the canonical framework. Root is a deployment.**
 
-**Highlights:** propagates v2.3 (incident-commander) and v2.4 (governance overlay) work from the in-repo deployment to the portable bundle. The portable bundle had drifted: v2.2.0 had shipped without `reality-checker` (added to deployment), v2.3 (`incident-commander`) was deployed-only, and v2.4 governance overlay (intent intake, duplication/strategy check, capability registration verdict, compound learning feedback, lifecycle/ABCd in spec authoring) lived only in `.claude/`. This release brings the portable bundle to parity. Bundle is now ready to ship to other dev environments.
+This repo carries two `FRAMEWORK_VERSION` files. They do NOT have equal authority:
 
-**Added:**
+- **Canonical** — `setup/portable/.claude/FRAMEWORK_VERSION` and `setup/portable/.claude/CHANGELOG.md`. This is the framework artifact that ships to consuming repos via the sync engine. All version decisions are made here. **`setup/portable/.claude/CHANGELOG.md` is the source of truth.**
-- `.claude/agents/reality-checker.md` — post-pr-reviewer evidence-demanding verifier (was deployed at 2.2 but never copied to portable).
+- **Deployment marker** — `.claude/FRAMEWORK_VERSION` and `.claude/CHANGELOG.md` (this file you are reading now). This file records which version of the framework is currently *deployed* in this repo's `.claude/` tree for our own Claude Code sessions. It is NOT a separate version authority — it can lag the canonical version transiently while portable advances ahead of self-adoption.
-- `.claude/agents/incident-commander.md` — production incident coordinator (inline playbook). SEV classification, timeline scribe, hotfix handoff, post-mortem drive. Distinct from hotfix.
+
-- `docs/incident-response.md` — SEV matrix (four levels), on-call expectations, timeline-log format, post-mortem template.
+The canonical version always advances first; deployments catch up via self-adoption (Phase C of the framework-standalone-repo build, or `node setup/portable/sync.js --adopt` in any other consumer).
 
-**Changed:**
+**Validate-setup and future drift-detection tooling read the file relevant to scope, not as competing authorities:**
-- `.claude/agents/feature-coordinator.md` — branch-level review pass §8.4 inserts `reality-checker` between `pr-reviewer` and `dual-reviewer`.
+- "What version of the framework is *deployed* here?" → root `FRAMEWORK_VERSION` (in this repo OR in any consuming repo's `.claude/`).
-- `.claude/agents/spec-coordinator.md` — Step 3 "Intent intake" with classification branching (Trivial → `brief.md`, Standard+ → `intent.md`); Step 3a "Duplication / Strategy Check" hard-gate inserted between Step 3 and Step 4.
+- "What version does the framework artifact ship?" → canonical `setup/portable/.claude/FRAMEWORK_VERSION` (only in the framework's source repo, eventually a standalone GitHub repo).
-- `.claude/agents/finalisation-coordinator.md` — Step 6 emits combined Capability Registration verdict (eight valid strings); Step 7a "Compound Learning Feedback" inserted between Step 7 and Step 8.
+
-- `docs/spec-authoring-checklist.md` — Section 12 (Lifecycle Declaration + ABCd Estimate templates) added.
+These answer different questions. They are not asserted equal.
-- `docs/doc-sync.md` — `docs/capabilities.md` row carries the combined eight-string Capability Registration verdict; new row added for `docs/incident-response.md`.
+
-- All other agent files refreshed from the deployed copy (placeholder substitutions applied; Vitest-specific test-runner references rolled back to the portable bundle's generic `npx tsx` idiom).
+Drift between them is expected and bounded: a deployment may lag the canonical version, but should never *exceed* it. Validate-setup should warn if the deployment file's version is greater than the canonical file's version (when both are present in the same repo, as they are here pre-Phase-C).
 
-**Notes:**
+---
-- This release closes drift accumulated over v2.2 → v2.3 → v2.4. The portable bundle is now ready to ship to consuming repos. Adoption flow (`ADAPT.md`) and sync flow (`SYNC.md`) are unchanged.
+
-- App-specific work (RLS migration guard, arch-guard, audit-prevention-gates baselines, `docs/capabilities.md` 10-cluster Asset Register content) is intentionally not portable and stays in the deployed tree only.
+## 2.4.0 — 2026-05-14
 
----
+**Highlights:** adds lightweight governance overlay to the dev pipeline — intent intake, duplication/strategy check, Lifecycle Declaration + ABCd sizing, Asset Register, Capability Registration verdict, and Compound Learning Feedback. All additions are operator-driven and markdown-only; no new runtime code paths. Pipeline is fully backwards-compatible: Trivial builds keep the existing `brief.md` flow; Standard, Significant, and Major builds produce `intent.md` with a structured schema.
 
-## 2.2.0 — 2026-05-04
+**Added:**
-
+- `spec-coordinator.md` — Step 3 renamed to "Intent intake"; branches on classification (Trivial → `brief.md` unchanged; Standard+ → produces `tasks/builds/<slug>/intent.md` per §7.1 schema with 9 required H2 sections + §7.1.1 Risk Surface vocabulary + provisional-slug rule + migration rule).
-**Highlights:** adds sync infrastructure for one-command framework upgrade across consuming repos. Introduces `manifest.json` (file ownership declaration), `sync.js` (deterministic sync engine, ~300 lines JS with JSDoc types), and `SYNC.md` (guided upgrade prompt for Claude sessions). Migrates placeholder format from `[PROJECT_NAME]` to canonical `{{PROJECT_NAME}}` (double-brace) across all agent files and docs. ADAPT.md Phase 6 now records adoption state in `.claude/.framework-state.json` for future syncs.
+- `spec-coordinator.md` — Step 3a "Duplication / Strategy Check" inserted between Step 3 and Step 4; 4-branch recommendation table (`proceed` / `revise` / `merge with existing capability` / `stop`); hard-gate and soft-gate behaviours; `**Operator decision:**` resume signal.
-
+- `finalisation-coordinator.md` — Step 7a "Compound Learning Feedback" inserted between Step 7 and Step 8; 8-value target enum; 6-agent shortlist for `agent-instruction`; auto-apply prohibition; never blocks `MERGE_READY`.
-**Breaking:** NONE (additive — old `[…]` placeholders are ignored by sync.js, but ADAPT.md authors must use `{{...}}` format from this version forward).
+- `docs/capabilities.md` — 10-cluster header (closed cluster list per §7.4.2); pinned 12-column Asset Register table header (§7.4.1); 47 existing capabilities backfilled as rows with spec-compliant placeholders per §7.4.3.
-
+- `docs/doc-sync.md` — Capability Registration trigger row for `docs/capabilities.md` with all 8 §6.2.1 valid verdict strings; `MERGE_READY` block clause.
-**Added:**
+
-- `setup/portable/manifest.json` — declares which files are framework-managed, their sync mode, and substitution behaviour.
+**Changed:**
-- `setup/portable/sync.js` — the sync engine: reads manifest, classifies per-file state (clean/customised/new), applies substitutions, writes framework updates or `.framework-new` siblings for manual merge. Atomic state write. Flags: `--adopt`, `--dry-run`, `--check`, `--strict`, `--doctor`, `--force`.
+- `spec-coordinator.md` Step 6 — required sections list now includes Lifecycle Declaration (§7.2: 5-field table) and ABCd Estimate (§7.3: 4-dimension S/M/L-only table); both templates reproduced inline.
-- `setup/portable/SYNC.md` — guided upgrade walkthrough prompt. Claude reads it to walk the operator through a framework upgrade (diff versions, dry-run, run sync, resolve merges, verify, commit).
+- `finalisation-coordinator.md` Step 6 — extended to emit §6.2.1 combined Capability Registration verdict (`yes: <outcome>` or `n/a: <reason>`); 8 valid strings enumerated; `MERGE_READY` blocked until valid verdict recorded.
-- `setup/portable/tests/` — unit and end-to-end tests for the sync engine (helpers, walk/classify, substitution, settings-merge, flags, e2e-adopt, e2e-sync, e2e-merge).
+- `docs/spec-authoring-checklist.md` — Section 12 added (Lifecycle Declaration + ABCd blocks); two new Appendix pre-review checklist boxes.
-
+- `CLAUDE.md` — `spec-coordinator` agent fleet row updated ("intent intake, duplication/strategy check, …"); Build lifecycle subsection added with corrected 9-step sequence.
-**Changed:**
+- `architecture.md` — Dev build lifecycle subsection added with corrected 9-step sequence and orchestrator mapping.
-- `setup/portable/ADAPT.md` — Phase 2 substitution table updated to `{{...}}` format; Phase 6 added (record adoption state with `sync.js --adopt`).
+- `docs/doc-sync.md` Final Summary fields — `capabilities.md updated` format updated to §6.2.1 combined eight-string format.
-- `setup/portable/README.md` — updated to describe submodule + sync model; mentions SYNC.md for upgrades; documents `{{...}}` placeholder format.
+- `tasks/review-logs/README.md` — `capabilities.md updated` field format updated to §6.2.1 combined format.
-- Placeholder format migrated across 14 source files in `setup/portable/` (agent files, docs, references).
+
-- `scripts/build-portable-framework.ts` — preflight scan now also detects legacy `[PROJECT_NAME]`-style placeholders as errors. `FORBIDDEN_STRINGS` blacklist expanded with `AutomationOS` (no-space variant) and case variants (`automation-os`, `automation_os`, `automation_v1`, `automationV1`, lowercase / uppercase Synthetos) to catch project-name leakage that the original list missed.
+---
-- `scripts/build-portable-framework.ts` — added `assertZipBinaryAvailable()` preflight before invoking `zip` on POSIX, with installation hints for apt / apk / brew so minimal containers fail with a clear error instead of cryptic ENOENT.
+
-- `package.json` — added `test:portable-framework` script (`node --import tsx --test setup/portable/tests/*.test.ts`) and `.github/workflows/ci.yml` `portable_framework_tests` unconditional CI gate that runs the same script on every PR.
+## 2.3.0 — 2026-05-12
 
-**Fixed:**
+**Highlights:** adds `incident-commander` coordinator agent and companion `docs/incident-response.md`. Provides a dedicated inline playbook for production incident coordination (SEV classification, scribe duties, post-mortem) that is distinct from `hotfix`, which focuses on shipping the fix.
-- Placeholder format consistency: all `[PROJECT_NAME]` occurrences in portable bundle migrated to `{{PROJECT_NAME}}`.
+
-- Two `AutomationOS` (no-space variant) leaks in `setup/portable/.claude/agents/audit-runner.md` replaced with `{{PROJECT_NAME}}`. The forbidden-string scanner only caught `Automation OS` (with space) before this release; both variants are now caught.
+**Added:**
-
+- `.claude/agents/incident-commander.md` — production incident coordinator (inline playbook). Handles SEV classification, scribe duties (timestamped timeline under `tasks/incidents/<YYYY-MM-DD-slug>/`), hotfix handoff, and post-mortem drive. Distinct from `hotfix`: incident-commander coordinates the response; hotfix fixes the fire.
-**Notes:**
+- `docs/incident-response.md` — SEV matrix (four levels), on-call expectations, timeline-log format, and post-mortem template.
-- Version authority is now explicit: `setup/portable/.claude/CHANGELOG.md` (this file) is canonical; `.claude/CHANGELOG.md` in any consuming repo is a deployment marker. See the deployment-marker file's § *Version authority — single source of truth* for the rules.
+
-
+**Changed:**
----
+- `CLAUDE.md` — added `incident-commander` row to agent fleet table; added `"incident-commander: prod is on fire"` invocation example.
 
-## 2.1.0 — 2026-05-04
+---
 
-**Highlights:** adds in-repo portable bundle infrastructure so the framework can be reproducibly exported to other repos. Adds the SessionStart hook for self-healing code-intelligence cache. Adds the `validate-setup` agent for ongoing framework health checks.
+## 2.2.0 — 2026-05-12
 
-**Added:**
+**Highlights:** adds `reality-checker` agent — a post-pr-reviewer evidence-demanding verifier that classifies the implementer's claimed success criteria against supplied evidence before a build is approved. Wires into `feature-coordinator`'s branch-level review pass (§8.4), Phase 2 branch-level sequence position is: `spec-conformance` → `adversarial-reviewer` (if §5.1.2 surface) → `pr-reviewer` → **`reality-checker`** → `dual-reviewer`. Mandatory for Significant/Major tasks.
-- `setup/portable/` — in-repo source of truth for the export bundle. Mirrors the agent fleet, hooks, and conventions with placeholders substituted at adoption time.
+
-- `setup/portable/ADAPT.md` — master prompt for adapting the framework to a target repo (5-phase walkthrough + profile selector MINIMAL/STANDARD/FULL).
+**Added:**
-- `setup/portable/README.md` — drop-in instructions for target repos.
+- `.claude/agents/reality-checker.md` — read-only (Read, Glob, Grep) evidence verifier. Verdict enum: `READY` / `NEEDS_WORK` / `NEEDS_DISCUSSION`. Logs to `tasks/review-logs/reality-check-log-{slug}-{timestamp}.md`.
-- `scripts/build-portable-framework.ts` — preflight-checks the bundle source (forbidden-string scan, conflict-marker scan, agent-count sanity, FRAMEWORK_VERSION ↔ CHANGELOG check) and produces a versioned zip at `dist/portable-claude-framework-v<VERSION>.zip`.
+
-- `.claude/hooks/code-graph-freshness-check.js` — SessionStart hook. Detects a dead code-intelligence watcher at session start and rebuilds the cache plus respawns the watcher in-process. Steady-state cost <200ms; degrades gracefully when the cache build script is absent (so target repos that haven't adopted the cache infra still work).
+**Changed:**
-- `.claude/agents/validate-setup.md` — read-only health-checker. Verifies every agent's referenced files exist, every context-pack anchor resolves in `architecture.md`, ADR index matches files on disk, FRAMEWORK_VERSION matches CHANGELOG, every hook is registered in settings.json. Use periodically to catch drift, or as a pre-merge gate for framework PRs.
+- `.claude/agents/feature-coordinator.md` — inserted §8.4 `reality-checker` step in branch-level review pass; renumbered old §8.4 fix-loop to §8.5 and old §8.5 dual-reviewer to §8.6; updated handoff template with `reality-checker verdict:` line; updated TodoWrite expansion line.
-
+- `CLAUDE.md` — added `reality-checker` row to agent fleet table; added invocation example; updated Review pipeline section to number reality-checker as step 3 (after pr-reviewer, before dual-reviewer).
-**Changed:**
+- `tasks/review-logs/README.md` — added `reality-check` agent slug, `reality-checker` verdict enum table row, and caller-contract section.
-- `.claude/settings.json` — added `SessionStart` hook block for `code-graph-freshness-check`.
+
-- `CLAUDE.md` § Code intelligence artifacts — three-tier refresh model (automatic via SessionStart hook / live during dev / manual). Adds explicit fallback for repos without the cache infra. Reframed as "(optional infra)" so target repos can adopt the cache later.
+---
 
-**Fixed:**
+## 2.1.0 — 2026-05-04
-- `.claude/agents/hotfix.md` (internal) — replaced leftover `[PROJECT_NAME]` placeholder with the project name in the internal copy. Portable bundle's copy uses the canonical `{{PROJECT_NAME}}` format.
+
-
+**Highlights:** adds in-repo portable bundle infrastructure so the framework can be reproducibly exported to other repos. Adds the SessionStart hook for self-healing code-intelligence cache. Adds the `validate-setup` agent for ongoing framework health checks.
----
+
-
+**Added:**
-## 2.0.0 — 2026-05-03
+- `setup/portable/` — in-repo source of truth for the export bundle. Mirrors the agent fleet, hooks, and conventions with placeholders substituted at adoption time.
-
+- `setup/portable/ADAPT.md` — master prompt for adapting the framework to a target repo (5-phase walkthrough + profile selector MINIMAL/STANDARD/FULL).
-**Highlights:** major refactor of the agent fleet for cross-repo portability. Adds ADR convention, mode-scoped context packs, hotfix path, and a stack-neutral templating layer (ADAPT.md). Extracts duplicated boilerplate to references/. Removes hardcoded JS-stack assumptions from the framework core.
+- `setup/portable/README.md` — drop-in instructions for target repos.
-
+- `scripts/build-portable-framework.ts` — preflight-checks the bundle source (forbidden-string scan, conflict-marker scan, agent-count sanity, FRAMEWORK_VERSION ↔ CHANGELOG check) and produces a versioned zip at `dist/portable-claude-framework-v<VERSION>.zip`.
-**Breaking:**
+- `.claude/hooks/code-graph-freshness-check.js` — SessionStart hook. Detects a dead code-intelligence watcher at session start and rebuilds the cache plus respawns the watcher in-process. Steady-state cost <200ms; degrades gracefully when the cache build script is absent (so target repos that haven't adopted the cache infra still work).
-- Agent file `Context Loading` blocks for `architect`, `pr-reviewer`, `spec-conformance`, `adversarial-reviewer` now reference architecture.md anchor IDs (e.g. `architecture.md#service-layer`) instead of section names. **If you renamed sections in your architecture.md, you must regenerate anchors via the script in tasks/builds/_example/ or run ADAPT.md again.**
+- `.claude/agents/validate-setup.md` — read-only health-checker. Verifies every agent's referenced files exist, every context-pack anchor resolves in `architecture.md`, ADR index matches files on disk, FRAMEWORK_VERSION matches CHANGELOG, every hook is registered in settings.json. Use periodically to catch drift, or as a pre-merge gate for framework PRs.
-- "Test gates are CI-only" boilerplate moved from individual agent files to `references/test-gate-policy.md`. Agents now reference the file. **No-op for operators**, but if you forked an agent file before this version, your fork still has the duplicated boilerplate.
+
-
+**Changed:**
-**Added:**
+- `.claude/settings.json` — added `SessionStart` hook block for `code-graph-freshness-check`.
-- `.claude/agents/hotfix.md` — fast-path coordinator for time-critical fixes.
+- `CLAUDE.md` § Code intelligence artifacts — three-tier refresh model (automatic via SessionStart hook / live during dev / manual). Adds explicit fallback for repos without the cache infra. Reframed as "(optional infra)" so target repos can adopt the cache later.
-- `.claude/agents/context-pack-loader.md` — inline playbook that loads a mode-scoped slice of architecture.md instead of the full file.
+
-- `.claude/agents/codebase-explainer.md` — produces human-facing onboarding tour at `docs/codebase-tour.md`.
+**Fixed:**
-- `docs/decisions/` — ADR convention with template + 5 inaugural ADRs.
+- `.claude/agents/hotfix.md` (internal) — replaced leftover `[PROJECT_NAME]` placeholder with the project name in the internal copy. Portable bundle's copy retains the placeholder.
-- `docs/context-packs/` — five mode-scoped packs (review / implement / debug / handover / minimal).
+
-- `references/test-gate-policy.md` — single source of truth for the "test gates are CI-only" rule.
+---
-- `references/spec-review-directional-signals.md` — extracted from spec-reviewer.md (was 70 lines of inline bullet lists).
+
-- `references/verification-commands.md` — stack-specific lint/typecheck/test commands template (portable zip only).
+## 2.0.0 — 2026-05-03
-- 54 HTML anchors in `architecture.md` so context-packs can splice precisely.
+
-- `Status:` header convention for specs (see `docs/spec-authoring-checklist.md` § 11) — enables future archive sweeps.
+**Highlights:** major refactor of the agent fleet for cross-repo portability. Adds ADR convention, mode-scoped context packs, hotfix path, and a stack-neutral templating layer (ADAPT.md). Extracts duplicated boilerplate to references/. Removes hardcoded JS-stack assumptions from the framework core.
-- `last_reviewed_at` / `stale_after_days` / `stale_blocks_at_days` staleness gate in `docs/spec-context.md`. `spec-reviewer` enforces it before iteration 1.
+
-- `.claude/FRAMEWORK_VERSION` + this CHANGELOG for cross-repo drift detection.
+**Breaking:**
-
+- Agent file `Context Loading` blocks for `architect`, `pr-reviewer`, `spec-conformance`, `adversarial-reviewer` now reference architecture.md anchor IDs (e.g. `architecture.md#service-layer`) instead of section names. **If you renamed sections in your architecture.md, you must regenerate anchors via the script in tasks/builds/_example/ or run ADAPT.md again.**
-**Changed:**
+- "Test gates are CI-only" boilerplate moved from individual agent files to `references/test-gate-policy.md`. Agents now reference the file. **No-op for operators**, but if you forked an agent file before this version, your fork still has the duplicated boilerplate.
-- `KNOWLEDGE.md` preamble now distinguishes observations / gotchas / corrections (KNOWLEDGE) from architectural decisions (ADRs in `docs/decisions/`).
+
-- `spec-reviewer.md` slimmed (575 → 509 lines) by extracting the directional-signals classifier.
+**Added:**
-- `architecture.md` cross-link from `references/project-map.md` softened to "optional infra" — no longer claims the cache always exists.
+- `.claude/agents/hotfix.md` — fast-path coordinator for time-critical fixes.
-
+- `.claude/agents/context-pack-loader.md` — inline playbook that loads a mode-scoped slice of architecture.md instead of the full file.
-**Deprecated:**
+- `.claude/agents/codebase-explainer.md` — produces human-facing onboarding tour at `docs/codebase-tour.md`.
-- "Decision" category in KNOWLEDGE.md — write an ADR in `docs/decisions/` instead. Existing entries stay; new entries should not use this category.
+- `docs/decisions/` — ADR convention with template + 5 inaugural ADRs.
-
+- `docs/context-packs/` — five mode-scoped packs (review / implement / debug / handover / minimal).
-**Removed:**
+- `references/test-gate-policy.md` — single source of truth for the "test gates are CI-only" rule.
-- `quality-checker-gpt.md` (legacy GPT pipeline doc) — moved to `docs/_archive/`.
+- `references/spec-review-directional-signals.md` — extracted from spec-reviewer.md (was 70 lines of inline bullet lists).
-
+- `references/verification-commands.md` — stack-specific lint/typecheck/test commands template (portable zip only).
-**Fixed:**
+- 54 HTML anchors in `architecture.md` so context-packs can splice precisely.
-- 9 fully-resolved sections in `tasks/todo.md` archived to `tasks/todo-archive/2026-Q2.md`.
+- `Status:` header convention for specs (see `docs/spec-authoring-checklist.md` § 11) — enables future archive sweeps.
-- `replit.md` is now cross-linked from `CLAUDE.md` (was load-bearing but undocumented).
+- `last_reviewed_at` / `stale_after_days` / `stale_blocks_at_days` staleness gate in `docs/spec-context.md`. `spec-reviewer` enforces it before iteration 1.
-- `references/` directory presence treated as optional in `CLAUDE.md` and `architect.md` (was previously assumed always-present).
+- `.claude/FRAMEWORK_VERSION` + this CHANGELOG for cross-repo drift detection.
 
----
+**Changed:**
-
+- `KNOWLEDGE.md` preamble now distinguishes observations / gotchas / corrections (KNOWLEDGE) from architectural decisions (ADRs in `docs/decisions/`).
-## 1.0.0 — predates this changelog
+- `spec-reviewer.md` slimmed (575 → 509 lines) by extracting the directional-signals classifier.
-
+- `architecture.md` cross-link from `references/project-map.md` softened to "optional infra" — no longer claims the cache always exists.
-The original {{PROJECT_NAME}} internal setup. Agent fleet of 16, three-coordinator pipeline, ChatGPT review agents, doc-sync sweep, audit framework. No formal version tracking.
+
-
+**Deprecated:**
+- "Decision" category in KNOWLEDGE.md — write an ADR in `docs/decisions/` instead. Existing entries stay; new entries should not use this category.
+
+**Removed:**
+- `quality-checker-gpt.md` (legacy GPT pipeline doc) — moved to `docs/_archive/`.
+
+**Fixed:**
+- 9 fully-resolved sections in `tasks/todo.md` archived to `tasks/todo-archive/2026-Q2.md`.
+- `replit.md` is now cross-linked from `CLAUDE.md` (was load-bearing but undocumented).
+- `references/` directory presence treated as optional in `CLAUDE.md` and `architect.md` (was previously assumed always-present).
+
+---
+
+## 1.0.0 — predates this changelog
+
+The original Automation OS internal setup. Agent fleet of 16, three-coordinator pipeline, ChatGPT review agents, doc-sync sweep, audit framework. No formal version tracking.
+
```

### `docs/decisions/README.md`

```diff
@@ -36,12 +36,12 @@
 ## Discoverability
 
 Future sessions retrieve ADRs by:
-1. **Index.** Below table — keep it current.
+1. **Index.** [`README.md`](./README.md) below lists every ADR by domain.
-2. **Grep by slug.** ADR slugs follow the same kebab-case convention as build slugs.
+2. **Grep by slug.** ADR slugs follow the same kebab-case convention as build slugs and review-log slugs.
-3. **Cross-link from architecture.md.** When an architecture rule has an ADR backing it, link to the ADR file inline.
+3. **Cross-link from architecture.md.** When an architecture rule has an ADR backing it, link to the ADR file inline in `architecture.md`.
 
 ---
 
 ## Index
 
 Update when adding ADRs.
@@ -50,27 +50,27 @@
 |-----|-------|--------|--------|
 | [0001](./0001-mixed-mode-review-agents.md) | Mixed-mode review agents (auto-fix mechanical, route directional) | accepted | review fleet |
 | [0002](./0002-interactive-vs-walkaway-review-agents.md) | Interactive vs walk-away review agent classification | accepted | review fleet |
-| [0005](./0005-risk-class-split-rollout-pattern.md) | Risk-class split rollout for read-vs-write enforcement gaps | accepted | rollout / enforcement |
+| [0003](./0003-workspace-identity-canonical-pattern.md) | Workspace identity uses canonical pattern, one workspace per subaccount | accepted | workspace identity |
-
+| [0004](./0004-geo-skills-as-methodology-skills.md) | GEO skills implemented as methodology skills, not intelligence skills | accepted | skill system |
-ADRs 0001, 0002, 0005 ship as part of the framework — they are durable patterns that apply across projects. The numbering gap (no 0003 / 0004 in this bundle) reflects origin-project-specific ADRs that did NOT propagate. Start your project's local ADRs at 0006 to preserve the gap as a marker.
+| [0005](./0005-risk-class-split-rollout-pattern.md) | Risk-class split rollout for read-vs-write enforcement gaps | accepted | rollout / enforcement |
-
+| [0006](./0006-ghl-oauth-nonce-single-instance-constraint.md) | GHL OAuth nonce verifier — single-instance constraint | accepted | auth |
+| [0007](./0007-consolidation-build-page-retirement.md) | Consolidation build page retirement | accepted | UI consolidation |
+| [0008](./0008-sse-stream-token-auth.md) | SSE auth via short-lived signed stream-token (not long-lived JWT in URL) | accepted | auth |
+| [0009](./0009-support-desk-canonical-not-conversations.md) | Support tickets use dedicated canonical tables, not `canonical_conversations` | accepted | support desk, data model |
+| [0011](./0011-operator-backend-chain-resume-model.md) | Operator Backend — chain-resume and persistent profile required in V1 | accepted | operator backend, execution infrastructure |
+| [0012](./0012-tagged-log-as-metric-convention.md) | Tagged-log-as-metric is the project's metrics convention | accepted | observability, metrics, logging |
+| [0013](./0013-suppression-is-success.md) | Suppression is success under single-writer invariants | accepted | routes, services, single-writer invariants, observability |
+| [0014](./0014-coordinators-run-inline.md) | Coordinators run INLINE in the main session, never dispatched as sub-agents | accepted | agent fleet, pipeline architecture |
+| [0015](./0015-chatgpt-review-discipline.md) | ChatGPT review loops — convergence and diff-misreading discipline | accepted | review pipeline, chatgpt-pr-review, chatgpt-spec-review |
+| [0016](./0016-frontend-consumer-simple-principle.md) | Frontend-first design principle — consumer-simple over capability-mapped dashboards | accepted | frontend, product design, UX |
+| [0017](./0017-retrieval-ranker-v1-simplified.md) | Retrieval / ranker architecture — v1-simplified | accepted | retrieval / agents |
+| [0018](./0018-overlay-stack-ownership.md) | Overlay stack ownership — central manager | accepted | frontend |
+| [0019](./0019-job-result-and-review-loop-contracts.md) | Job result and review-loop state-machine contracts | accepted | workflow-engine / tooling |
+| [0020](./0020-test-conventions-vitest-and-test-folder.md) | Test conventions — Vitest only, `__tests__/` folder, `.js` relative imports | accepted | tests / tooling |
+| [0021](./0021-workflows-v1-v2-boundary.md) | Workflows V1 → V2 boundary contract | accepted | workflow-engine |
+| [0022](./0022-workspace-inbound-webhook-db-exception.md) | Direct DB access in workspaceInboundWebhook route | accepted | auth, routes |
+| [0023](./0023-approval-follows-executor-owner.md) | Approval ownership follows the executor's data boundary, not the request origin | accepted | agent delegation, approvals, personal assistant |
+| [0024](./0024-service-layer-extraction-for-routes-touching-db.md) | Service-layer extraction for routes touching `db/schema/` — type imports via `shared/types/`, queries via services, new baselines require ADR sign-off | accepted | routes, services, layer architecture |
+
+ADRs 0001-0005 were extracted from KNOWLEDGE.md historical "Decision" entries on 2026-05-03. The remaining 6 historical Decision entries stay in KNOWLEDGE.md as observations — they're either implementation patterns (not durable choices) or research notes (no decision to defend). Promote them to ADRs only if they keep being cited.
+
```

### `docs/context-packs/handover.md`

```diff
@@ -13,10 +13,10 @@
 - `tasks/builds/<slug>/handoff.md` if it exists (Phase 1 → 2 or 2 → 3 handoff)
 - The most recent 3 review logs in `tasks/review-logs/` matching the active slug
 - `architecture.md`:
-  - `#architecture-rules` (so a fresh session knows the constraints)
+  - `#architecture-rules-automation-os-specific` (so a fresh session knows the constraints)
   - `#key-files-per-domain` (the index)
 - `docs/decisions/` — any open ADRs in the active domain
 
 ## Skip
 
 - Other features' specs and plans
```

### `docs/context-packs/implement.md`

```diff
@@ -12,10 +12,10 @@
   - `#service-layer`
   - `#migrations`
   - `#shared-infrastructure-use-these-do-not-reinvent`
-  - `#architecture-rules`
+  - `#architecture-rules-automation-os-specific`
 - `DEVELOPMENT_GUIDELINES.md`:
   - § 2 Tier boundaries
   - § 3 Schema layer rules
   - § 6 Migration discipline
   - § 7 Testing posture
   - § 8 Development discipline
```

### `docs/context-packs/review.md`

```diff
@@ -13,10 +13,10 @@
   - `#service-layer`
   - `#row-level-security-rls-three-layer-fail-closed-data-isolation`
   - `#auth-permissions`
-  - `#architecture-rules`
+  - `#architecture-rules-automation-os-specific`
   - `#key-files-per-domain` (index, for quick lookups)
 - `DEVELOPMENT_GUIDELINES.md`:
   - § 1 Multi-tenancy and RLS
   - § 2 Service / Route / Lib tier boundaries
   - § 3 Schema layer rules
   - § 8 Development discipline
```

### `docs/frontend-design-principles.md`

```diff
@@ -6,10 +6,10 @@
 
 ## Why this document exists
 
-{{PROJECT_NAME}} positions as **consumer-simple on enterprise-grade backend**. The product sells to agency operators, solo founders, and non-technical knowledge workers — the same audience that finds tools like HubSpot and Salesforce overwhelming. The backend needs to be powerful (router, cost ledger, HITL gates, cached-context infrastructure, policy engine); the frontend needs to be invisible where possible and obvious everywhere else. These two stay decoupled.
+Automation OS positions as **consumer-simple on enterprise-grade backend**. The product sells to agency operators, solo founders, and non-technical knowledge workers — the same audience that finds tools like HubSpot and Salesforce overwhelming. The backend needs to be powerful (router, cost ledger, HITL gates, cached-context infrastructure, policy engine); the frontend needs to be invisible where possible and obvious everywhere else. These two stay decoupled.
 
 The trap this doc prevents: **treating the spec's exposed capability surface as the UI surface.** A spec that adds `bundle_utilization`, `prefix_hash`, `cache_creation_tokens`, `run_outcome = 'completed' | 'degraded' | 'failed'`, and per-tenant cache-cost rollups does not imply a bundle-utilization dashboard, a prefix-hash inspector, a cache-cost explorer, and a per-tenant financial breakdown. Backend spec → full coverage. Frontend design → strict editorial filter.
 
 ---
 
 ## Contents
@@ -37,234 +37,234 @@
 
 Work through these in order. An unchecked box is a design finding; every unchecked box means the artifact is under-specified and not ready to build.
 
-- [ ] **Who is the primary user of this screen?** Roles: agency operator / solo founder / tenant admin / internal staff / {{COMPANY_NAME}} admin. Different users tolerate different complexity ceilings. Agency operator = lowest tolerance. Internal staff = highest.
+- [ ] **Where does this surface live in the existing UI?** Identify the existing page(s) and component(s) the new capability extends *before drafting anything*. Search `client/src/pages/` and `client/src/components/`. Read the actual files. Quote the layout, tab labels, status pill text, vocabulary you'll inherit. New capabilities surface inside existing pages by default. A new dedicated page requires explicit justification (cross-cutting overview, distinct user journey, no extensible surface exists). The most expensive design mistake is inventing a parallel UI universe when the app already has the right surface.
-- [ ] **What single task are they here to complete?** One sentence. Example: *"Attach a document bundle to this scheduled task."* NOT *"Manage document bundles and monitor utilization and review run history."* If the answer is a list, you have multiple screens, not one.
+- [ ] **Who is the primary user of this screen?** Roles: agency operator / solo founder / tenant admin / internal staff / Synthetos admin. Different users tolerate different complexity ceilings. Agency operator = lowest tolerance. Internal staff = highest.
-- [ ] **What is the minimum information needed to complete that task?** List it. Example: bundle name, bundle document count, an attach button. NOT utilization-per-tier, cache-hit-rate, prefix-hash preview, attach button.
+- [ ] **What single task are they here to complete?** One sentence. Example: *"Attach a document bundle to this scheduled task."* NOT *"Manage document bundles and monitor utilization and review run history."* If the answer is a list, you have multiple screens, not one.
-- [ ] **What would happen if I removed X?** For every candidate element (panel, metric, chart, table, sidebar card), ask this. If the answer is *"the user would still complete the primary task"*, the element is deferred.
+- [ ] **What is the minimum information needed to complete that task?** List it. Example: bundle name, bundle document count, an attach button. NOT utilization-per-tier, cache-hit-rate, prefix-hash preview, attach button.
-- [ ] **Where does everything else go?** Every deferred element goes to exactly one of: (a) progressive disclosure on this screen (collapsed "Advanced" section), (b) a dedicated page the primary user rarely visits, (c) admin-only view, (d) deferred out of v1 entirely. Name the destination per element.
+- [ ] **What would happen if I removed X?** For every candidate element (panel, metric, chart, table, sidebar card), ask this. If the answer is *"the user would still complete the primary task"*, the element is deferred.
-- [ ] **The re-check.** Imagine a non-technical operator landing on this screen for the first time. Do they know what to do within 3 seconds? If not, cut more.
+- [ ] **Where does everything else go?** Every deferred element goes to exactly one of: (a) progressive disclosure on this screen (collapsed "Advanced" section), (b) a dedicated page the primary user rarely visits, (c) admin-only view, (d) deferred out of v1 entirely. Name the destination per element.
-
+- [ ] **The re-check.** Imagine a non-technical operator landing on this screen for the first time. Do they know what to do within 3 seconds? If not, cut more.
----
+
-
+---
-## What to ship by default
+
-
+## What to ship by default
-- **The primary action** — prominent, obvious, one button or one drop zone.
+
-- **The minimum state needed to complete the action** — current value inline, not in a separate panel.
+- **The primary action** — prominent, obvious, one button or one drop zone.
-- **The result of the last action taken** — inline confirmation (e.g. "attached · 2m ago"), not a history table.
+- **The minimum state needed to complete the action** — current value inline, not in a separate panel.
-- **One sidebar callout at most** — only if it's load-bearing for completing the primary task (e.g. a required field's help text).
+- **The result of the last action taken** — inline confirmation (e.g. "attached · 2m ago"), not a history table.
-- **Empty states with one next action** — "No bundles yet. [Create bundle]". Not a tour, not tips, not a chart of nothing.
+- **One sidebar callout at most** — only if it's load-bearing for completing the primary task (e.g. a required field's help text).
-- **Load-bearing inline visuals** — status dots, band pills, sparklines next to names, outcome badges, a single hero visualisation where *understanding trajectory IS the primary task*. These communicate state faster than text and are *encouraged*, not deferred. See [Visuals as simplicity](#visuals-as-simplicity) below.
+- **Empty states with one next action** — "No bundles yet. [Create bundle]". Not a tour, not tips, not a chart of nothing.
-
+- **Load-bearing inline visuals** — status dots, band pills, sparklines next to names, outcome badges, a single hero visualisation where *understanding trajectory IS the primary task*. These communicate state faster than text and are *encouraged*, not deferred. See [Visuals as simplicity](#visuals-as-simplicity) below.
----
+
-
+---
-## Visuals as simplicity
+
-
+## Visuals as simplicity
-A common misread of this document is "cut all visuals to ship faster". That is wrong. **Visuals are how consumer-simple products communicate state.** A status dot beats a paragraph. A sparkline beats three lines of trend prose. A single hero chart on a drilldown where *understanding the trajectory* is the primary task beats five lines explaining the same number.
+
-
+A common misread of this document is "cut all visuals to ship faster". That is wrong. **Visuals are how consumer-simple products communicate state.** A status dot beats a paragraph. A sparkline beats three lines of trend prose. A single hero chart on a drilldown where *understanding the trajectory* is the primary task beats five lines explaining the same number.
-**The test is never "is there a visual?" — it's "is this visual load-bearing for the primary task?"**
+
-
+**The test is never "is there a visual?" — it's "is this visual load-bearing for the primary task?"**
-| Ship | Don't ship |
+
-|---|---|
+| Ship | Don't ship |
-| Status dots inline on list rows (band, health, run outcome) | A row of five KPI tiles at the top of every page |
+|---|---|
-| Sparklines next to a client name showing 4-week trajectory | Multi-series comparison charts nobody asked for |
+| Status dots inline on list rows (band, health, run outcome) | A row of five KPI tiles at the top of every page |
-| Band pills, severity pills, outcome badges | 7/30/90-day toggle charts as decoration |
+| Sparklines next to a client name showing 4-week trajectory | Multi-series comparison charts nobody asked for |
-| A single hero trend visualisation on a drilldown page | Trend dashboards that duplicate content visible inline below |
+| Band pills, severity pills, outcome badges | 7/30/90-day toggle charts as decoration |
-| Progress indicators on active flows | Observability explorers on primary user journeys |
+| A single hero trend visualisation on a drilldown page | Trend dashboards that duplicate content visible inline below |
-| Micro-gauges, subtle colour accents for state | Multi-panel dashboards when the task is *operating*, not *monitoring* |
+| Progress indicators on active flows | Observability explorers on primary user journeys |
-
+| Micro-gauges, subtle colour accents for state | Multi-panel dashboards when the task is *operating*, not *monitoring* |
-A sparkline communicating a trend in 60 pixels earns its place. A KPI tile row showing four numbers the user already sees in the list below does not. A hero chart on a page whose primary task *is* "read the trajectory" earns its place. A hero chart on a page whose primary task is "pick one and act" is decoration.
+
-
+A sparkline communicating a trend in 60 pixels earns its place. A KPI tile row showing four numbers the user already sees in the list below does not. A hero chart on a page whose primary task *is* "read the trajectory" earns its place. A hero chart on a page whose primary task is "pick one and act" is decoration.
-### Aesthetic quality is not negotiable
+
-
+### Aesthetic quality is not negotiable
-Pages must be **aesthetically beautiful**, not just functional. Plain-text lists with no visual hierarchy read as unfinished. Every surface should feel intentional: confident type hierarchy, generous whitespace, colour accents for state, small visual signals that communicate faster than words.
+
-
+Pages must be **aesthetically beautiful**, not just functional. Plain-text lists with no visual hierarchy read as unfinished. Every surface should feel intentional: confident type hierarchy, generous whitespace, colour accents for state, small visual signals that communicate faster than words.
-**Consumer-simple means *beautiful and obvious*, not *stripped and bare*.**
+
-
+**Consumer-simple means *beautiful and obvious*, not *stripped and bare*.**
-If a screen is entirely text, pause and ask: *is there a visual that would communicate this state faster?* Usually yes. Ship it. A list of clients without trend sparklines is harder to scan than one with. A drilldown without a health-score visualisation hides the single most important thing the operator is there to see.
+
-
+If a screen is entirely text, pause and ask: *is there a visual that would communicate this state faster?* Usually yes. Ship it. A list of clients without trend sparklines is harder to scan than one with. A drilldown without a health-score visualisation hides the single most important thing the operator is there to see.
-The caps in the [complexity budget](#complexity-budget-per-screen) below are about **defaulting away from the dashboard-of-dashboards anti-pattern** — rows of tiles, multi-chart explorers, observability sprawl. They are *not* a mandate against visual richness. Sparklines, inline gauges, status indicators, outcome badges, and load-bearing single hero visualisations are never counted against those caps.
+
-
+The caps in the [complexity budget](#complexity-budget-per-screen) below are about **defaulting away from the dashboard-of-dashboards anti-pattern** — rows of tiles, multi-chart explorers, observability sprawl. They are *not* a mandate against visual richness. Sparklines, inline gauges, status indicators, outcome badges, and load-bearing single hero visualisations are never counted against those caps.
----
+
-
+---
-## What to defer by default
+
-
+## What to defer by default
-Everything below is **deferred out of v1 unless explicitly requested for a specific user workflow**. Not "maybe v2" — actively cut from the v1 artifact.
+
-
+Everything below is **deferred out of v1 unless explicitly requested for a specific user workflow**. Not "maybe v2" — actively cut from the v1 artifact.
-- Metric dashboards and KPI tile rows — the "four-to-seven big numbers at the top of every page" anti-pattern. Inline single-metric signals (a sparkline next to a name, a band pill, a status dot) are different — ship those freely. See [Visuals as simplicity](#visuals-as-simplicity).
+
-- Trend-chart decks with 7/30/90-day toggles as decoration at the top of pages. A single hero trend visualisation on a drilldown where *understanding trajectory IS the primary task* is different — ship that.
+- Metric dashboards and KPI tile rows — the "four-to-seven big numbers at the top of every page" anti-pattern. Inline single-metric signals (a sparkline next to a name, a band pill, a status dot) are different — ship those freely. See [Visuals as simplicity](#visuals-as-simplicity).
-- Diagnostic panels that expose internal identifiers (prefix hashes, snapshot IDs, idempotency keys, correlation IDs).
+- Trend-chart decks with 7/30/90-day toggles as decoration at the top of pages. A single hero trend visualisation on a drilldown where *understanding trajectory IS the primary task* is different — ship that.
-- Aggregated cost rollups, per-tenant financial breakdowns, spend-saved calculations, cost-split donuts.
+- Diagnostic panels that expose internal identifiers (prefix hashes, snapshot IDs, idempotency keys, correlation IDs).
-- Observability explorers ("Usage Explorer", "Bundle Lens", "Model Lens", "Feature Lens").
+- Aggregated cost rollups, per-tenant financial breakdowns, spend-saved calculations, cost-split donuts.
-- Ranking tables ("bundles by utilization", "tenants by spend", "features by cost").
+- Observability explorers ("Usage Explorer", "Bundle Lens", "Model Lens", "Feature Lens").
-- Run-history tables on per-entity pages — runs live in the existing run log, not on every page that has a run.
+- Ranking tables ("bundles by utilization", "tenants by spend", "features by cost").
-- Three-tier / four-tier comparison views (e.g. "Sonnet vs Opus vs Haiku side-by-side").
+- Run-history tables on per-entity pages — runs live in the existing run log, not on every page that has a run.
-- "Cost saved vs. first run" or any other counterfactual-comparison framing.
+- Three-tier / four-tier comparison views (e.g. "Sonnet vs Opus vs Haiku side-by-side").
-
+- "Cost saved vs. first run" or any other counterfactual-comparison framing.
-These all represent **real backend capability** the spec legitimately covers. The capability ships. The UI surface for it does not ship until a specific user workflow needs it. If they're truly needed, they go on a dedicated admin page that the average user never opens — not inline on the primary user journey.
+
-
+These all represent **real backend capability** the spec legitimately covers. The capability ships. The UI surface for it does not ship until a specific user workflow needs it. If they're truly needed, they go on a dedicated admin page that the average user never opens — not inline on the primary user journey.
----
+
-
+---
-## Complexity budget per screen
+
-
+## Complexity budget per screen
-Hard caps. A screen exceeding these is a design finding; cut before shipping.
+
-
+Hard caps. A screen exceeding these is a design finding; cut before shipping.
-| Element | Cap | Notes |
+
-|---|---|---|
+| Element | Cap | Notes |
-| Primary actions | 1 | Buttons that commit state. A "Save" and a "Cancel" count as one primary action (the save). |
+|---|---|---|
-| Panels (distinct bordered sections) | 3 | Header, primary body, one sidebar. More than that = compose multiple screens. |
+| Primary actions | 1 | Buttons that commit state. A "Save" and a "Cancel" count as one primary action (the save). |
-| KPI tiles | 0 by default | Add only when the primary task is *monitoring* (not operating). |
+| Panels (distinct bordered sections) | 3 | Header, primary body, one sidebar. More than that = compose multiple screens. |
-| Charts | 0 by default | Same rule. A spark-line on an inline card is not a chart. |
+| KPI tiles | 0 by default | Add only when the primary task is *monitoring* (not operating). |
-| Table columns | 4 | Name, 1 key state column, 1 timestamp, 1 action. More columns → collapse into secondary state / progressive disclosure. |
+| Charts | 0 by default | Same rule. A spark-line on an inline card is not a chart. |
-| Sidebar cards | 1 | Only if load-bearing. A second sidebar is a design finding. |
+| Table columns | 4 | Name, 1 key state column, 1 timestamp, 1 action. More columns → collapse into secondary state / progressive disclosure. |
-| Hash / ID exposures | 0 by default | Internal identifiers never surface to the primary user. Admin view only. |
+| Sidebar cards | 1 | Only if load-bearing. A second sidebar is a design finding. |
-| Tier / model / variant comparisons | 0 | The user does not care what model runs under the hood. If they do, it's an admin concern. |
+| Hash / ID exposures | 0 by default | Internal identifiers never surface to the primary user. Admin view only. |
-
+| Tier / model / variant comparisons | 0 | The user does not care what model runs under the hood. If they do, it's an admin concern. |
-Admin-only views (accessed via an explicit toggle, hidden from the primary nav) operate under a relaxed budget: 5 panels, 2 sidebars, charts and KPIs permitted. These exist to serve {{COMPANY_NAME}} internal staff and advanced tenant admins — never the default operator.
+
-
+Admin-only views (accessed via an explicit toggle, hidden from the primary nav) operate under a relaxed budget: 5 panels, 2 sidebars, charts and KPIs permitted. These exist to serve Synthetos internal staff and advanced tenant admins — never the default operator.
----
+
-
+---
-## Progressive disclosure patterns
+
-
+## Progressive disclosure patterns
-When information is genuinely needed but not for the primary task, use these — in preference order:
+
-
+When information is genuinely needed but not for the primary task, use these — in preference order:
-1. **Inline badge or dot.** A coloured status dot next to a name. A "· 2m ago" trailing line. Lowest visual weight, zero clicks to see.
+
-2. **Hover tooltip.** For informational copy that doesn't need to be scanned — "why this is disabled", "what this count means".
+1. **Inline badge or dot.** A coloured status dot next to a name. A "· 2m ago" trailing line. Lowest visual weight, zero clicks to see.
-3. **Collapsed "Advanced" section.** A single expandable section at the bottom of the primary body. Labelled clearly. Defaults collapsed. Contains the internal-detail fields (hashes, IDs, raw config).
+2. **Hover tooltip.** For informational copy that doesn't need to be scanned — "why this is disabled", "what this count means".
-4. **"Details →" link to a dedicated page.** For rich diagnostic content that a user will visit deliberately. Separate URL, not inline.
+3. **Collapsed "Advanced" section.** A single expandable section at the bottom of the primary body. Labelled clearly. Defaults collapsed. Contains the internal-detail fields (hashes, IDs, raw config).
-5. **Admin-only page.** For content that should not surface to primary users at all. Gated behind a role check.
+4. **"Details →" link to a dedicated page.** For rich diagnostic content that a user will visit deliberately. Separate URL, not inline.
-
+5. **Admin-only page.** For content that should not surface to primary users at all. Gated behind a role check.
-Pick the lowest-weight pattern that works. Do not mix three patterns on one screen.
+
-
+Pick the lowest-weight pattern that works. Do not mix three patterns on one screen.
----
+
-
+---
-## Worked examples
+
-
+## Recurring UI patterns
-Three worked examples — drawn from origin-project features — live in [`frontend-design-examples.md`](./frontend-design-examples.md):
+
-
+Concrete, copy-once-paste-often patterns that came out of the auto-knowledge-retrieval mockup pass (May 2026). When designing a new screen, default to these unless you have a clear reason not to. Mockup references in `_archive/prototypes/auto-knowledge-retrieval/`.
-- **Cached-context infrastructure** — backend exposes 9 capabilities; UI ships 3 screens + 2 inline signals. The bulk of the deferred-by-default rule.
+
-- **ClientPulse health monitoring** — analytical complexity in the backend does not imply analytical complexity in the UI. One drilldown, one modal, one settings page.
+### Three-dot (⋮) context menus on rows
-- **Tier-1 agent chat uplift** — backend richness (cost attribution, suggested actions, OCC versioning) maps to the smallest possible UI signals: a number, a chip row, a text field, a card.
+
-
+- **Maximum 6 to 8 visible items.** If you have more, you're probably grouping wrong.
-Read for method, not content. If you're adapting this framework to a new project, replace these with worked examples from your own product.
+- **Collapse grouped sub-options into a single item with a `›` chevron** that opens a flyout, instead of expanding inline as a multi-section block. Example: *"Change mode ›"* opens a flyout with Auto / Always available / Reference only. Do not list those three as inline items under a section header in the parent menu.
-
+- **Never show "Open" and "Edit" as two separate items.** Row-click opens the detail modal (which is both view and edit). The three-dots menu has *Edit* xor *Open*, never both.
-## Re-check before delivery
+- **Reserve danger actions to the bottom**, separated by a divider, in red.
 
-Before committing any UI artifact (mockup, PR, component), run through this quickly:
+Reference: `_archive/prototypes/auto-knowledge-retrieval/agent-data-sources.html`, `knowledge-documents-tab.html`.
 
-- [ ] Did I start from the user's task, not the data model?
+### Source / origin / provenance badges
-- [ ] Is there exactly one primary action on this screen?
+
-- [ ] Is every element load-bearing for the primary task?
+Don't badge the default case. Default-case badges are decoration, not signal.
-- [ ] Have I deferred every monitoring / observability / diagnostic element that the task doesn't need?
+
-- [ ] If a non-technical operator landed here, would they know what to do in 3 seconds?
+- For a list of items where most are *manually authored / uploaded by the operator*, do not show a "Manually authored" badge on every row. Only show a badge when the source is non-default ("From file", "Approved from auto-memory", "Uploaded PDF", etc.).
-- [ ] Am I under the complexity-budget caps?
+- The default-case absence-of-badge becomes the visual carrier of *"this is normal."* Special badges become the visual carrier of *"this came from somewhere interesting."*
 
-If any answer is "no" or "not sure", cut before shipping. Shipping a fatter UI "just in case someone wants it" is how this product loses the consumer-simple positioning.
+### Token / cost / size information
 
----
+Hide by default. Only surface as a warning when it's actionable.
 
-## When to break these rules
+- Do not show token counts, cost-per-run, retrieval latency, embedding size, or similar engineering metrics in default views.
-
+- Surface a small warning chip on the affected row when a threshold is crossed (e.g. "⚠ Large document" when a document exceeds the recommended size). The chip carries the action: *something here is unusual, you might want to look*.
-Almost never. The two legitimate exceptions:
+- Detail modals are an acceptable place for one expanded size widget (visual bar + qualitative label like "Small" / "Medium"), so users can self-debug if they want. Still no raw numbers as the primary information.
 
-1. **Admin-only views.** Operate under the relaxed budget above. Gated behind an explicit role check, hidden from the primary nav, discoverable only via direct URL or an admin settings page. Every {{PROJECT_NAME}} user is NOT an admin.
+### Stat tiles on list / table pages
-2. **Safety-critical information-dense screens.** Payload-rendering screens where the complexity exists to prevent harm — HITL block payloads, terminal-failure review queues, dry-run diff previews. Even here, the rule is "surface only what's needed to make the decision", not "surface everything the backend knows".
+
-
+Maximum two stat tiles. The table itself is the data; tiles are for what the table can't show.
-Everything else obeys the rules. If you find yourself arguing for a third exception during a design, you're almost certainly rationalising a data-model-first mistake — go back to the primary task and start over.
+
-
+- Good tile: *"Total documents: 23"* (a count the table doesn't aggregate).
+- Good tile: *"Most loaded: [name]"* (a top-1 the table doesn't sort to by default).
+- Bad tile: *"Avg per run: 2.4"* (operational metric, not actionable for the operator).
+- Bad tile: *"Last 30 days: $2.40"* (cost detail, hidden by default per the rule above).
+
+If a tile fails the "would the operator act on this?" check, cut it.
+
+### Explainer banners
+
+Useful for first-time users; must be dismissable.
+
+- Every explainer banner has a `×` close button. Closing persists per-user.
+- Do not ship permanent help copy at the top of every page. The banner is a one-time learning aid, not an instruction strip.
+- Footer notes that repeat what the banner just said are noise. Pick one, not both.
+
+### Admin-only controls
+
+Hide entirely from non-admin users. Do not render disabled; do not render with "you can't do this" copy.
+
+- Org-admin-only fields (e.g. a "Promote to org-wide" scope picker in a sub-account-scoped modal) are absent for sub-account admins. The field doesn't exist in their DOM.
+- Use a small "Org admin only" pill on the field label in the org-admin view itself, so the org admin understands the scope of their own action. Never show that pill to non-admins.
+
+### Default-case controls
+
+If a control has only one meaningful choice, hide it.
+
+- "Available to" radios with only one option ("All agents in this sub-account", because the user has no other sub-account) is a non-decision. Hide the radio entirely. The default action takes effect on save.
+- A "Restrict to specific agents" override lives behind an Advanced expander, not in the primary form.
+
+### Modal advanced expanders
+
+Default to collapsed.
+
+- A modal that asks for a title, scope, and an Advanced section should ship with Advanced collapsed and a single line ("Advanced: change loading mode" or similar). Most users complete the action without expanding.
+- Mockups should show the collapsed state by default. Show the expanded state only when the mockup is specifically demonstrating the advanced flow.
+
+### Em-dashes
+
+CLAUDE.md prohibits em-dashes in UI copy, labels, or app-facing text. Use commas, colons, or rewrite the sentence. This applies to mockup data (sample document names, sample agent names) too, not just chrome.
+
+### Sub-text on rows
+
+Trim aggressively.
+
+- Multi-fact sub-text strings ("Pinned to organisation · 2,300 tokens · last updated 5 days ago by Michael H.") become noise after the first row. Keep the most actionable single fact ("Updated 5 days ago"); push the rest to the detail modal.
+- Mime types are usually carried by the file icon. Don't repeat them in text.
+- Run identifiers ("produced during run #1284") are operator-debugging context. Show on hover or in detail, not in default rows.
+
+---
+
+## Worked examples
+
+Three worked examples — drawn from origin-project features — live in [`frontend-design-examples.md`](./frontend-design-examples.md):
+
+- **Cached-context infrastructure** — backend exposes 9 capabilities; UI ships 3 screens + 2 inline signals. The bulk of the deferred-by-default rule.
+- **ClientPulse health monitoring** — analytical complexity in the backend does not imply analytical complexity in the UI. One drilldown, one modal, one settings page.
+- **Tier-1 agent chat uplift** — backend richness (cost attribution, suggested actions, OCC versioning) maps to the smallest possible UI signals: a number, a chip row, a text field, a card.
+
+Read for method, not content. If you're adapting this framework to a new project, replace these with worked examples from your own product.
+
+## Re-check before delivery
+
+Before committing any UI artifact (mockup, PR, component), run through this quickly:
+
+**The five hard rules:**
+- [ ] Did I extend an existing page/component instead of inventing a new one? (If new page: did I justify why no existing surface fits?)
+- [ ] Did I start from the user's task, not the data model?
+- [ ] Is there exactly one primary action on this screen?
+- [ ] Is every element load-bearing for the primary task?
+- [ ] Have I deferred every monitoring / observability / diagnostic element that the task doesn't need?
+- [ ] If a non-technical operator landed here, would they know what to do in 3 seconds?
+- [ ] Am I under the complexity-budget caps?
+
+**The recurring-pattern rules** (per *Recurring UI patterns* section above):
+- [ ] Three-dot menus: under 8 items? Sub-options as flyouts not inline sections?
+- [ ] Source / provenance badges: only on non-default cases?
+- [ ] No token / cost / size numbers in default views? Warnings only as actionable chips?
+- [ ] Stat tiles: 2 maximum, each one the operator would act on?
+- [ ] Explainer banners: dismissable? No duplicate footer note?
+- [ ] Admin-only fields: absent (not disabled) for non-admins?
+- [ ] Single-choice "Available to" / "Apply to" controls hidden?
+- [ ] Modal advanced expander defaulted to collapsed?
+- [ ] No em-dashes in any UI copy or sample data?
+- [ ] Row sub-text trimmed to one most-actionable fact?
+
+If any answer is "no" or "not sure", cut before shipping. Shipping a fatter UI "just in case someone wants it" is how this product loses the consumer-simple positioning.
+
+---
+
+## When to break these rules
+
+Almost never. The two legitimate exceptions:
+
+1. **Admin-only views.** Operate under the relaxed budget above. Gated behind an explicit role check, hidden from the primary nav, discoverable only via direct URL or an admin settings page. Every Automation OS user is NOT an admin.
+2. **Safety-critical information-dense screens.** Payload-rendering screens where the complexity exists to prevent harm — HITL block payloads, terminal-failure review queues, dry-run diff previews. Even here, the rule is "surface only what's needed to make the decision", not "surface everything the backend knows".
+
+Everything else obeys the rules. If you find yourself arguing for a third exception during a design, you're almost certainly rationalising a data-model-first mistake — go back to the primary task and start over.
+
```

### `references/test-gate-policy.md`

```diff
@@ -20,59 +20,59 @@
 - `npm run lint`.
 - `npm run typecheck` (or the dual-tsconfig form per `replit.md`).
 - `npm run build:server` / `npm run build:client` when the change touches the build surface.
-- **Targeted execution of unit tests authored for THIS change** — a single test file via `npx tsx <path-to-test>`. Confirm the new test runs and passes. Not to re-run anything else.
+- **Targeted execution of unit tests authored for THIS change** — a single test file via `npx vitest run <path-to-test>`. Confirm the new test runs and passes. Not to re-run anything else.
 
-Authoring tests and gates is encouraged. Running the full battery of them locally is not. CI handles that.
+**Runner: Vitest 2.x.** Unit tests live at `**/__tests__/*.test.ts`, import `test`/`expect` from `vitest`, and run via `npx vitest run <path>`. Do NOT author tests with `node:test`, `node:assert`, handwritten harnesses, `process.exit` exit-codes, or `npx tsx`-runnable shapes — `scripts/verify-test-quality.sh` rejects them and CI will fail the PR. See `docs/testing-conventions.md` for the canonical pattern. The one carve-out: `scripts/__tests__/*.test.ts` are script-helper checks (not unit tests) and run via `npx tsx` per `scripts/README.md`.
 
-## Why
+Authoring tests and gates is encouraged. Running the full battery of them locally is not. CI handles that.
 
-- CI is the authoritative gate runner. Local runs drift. Trust the canonical surface.
+## Why
-- Whole-repo verifiers are slow. They burn agent time without producing new signal.
+
-- Local runs encourage "make this gate pass" patches that hide root causes. CI's pre-merge run catches them anyway.
+- CI is the authoritative gate runner. Local runs drift. Trust the canonical surface.
-- Pre-production posture: gate state shifts as the codebase shifts. The CI run is the only one fresh enough to act on.
+- Whole-repo verifiers are slow. They burn agent time without producing new signal.
-
+- Local runs encourage "make this gate pass" patches that hide root causes. CI's pre-merge run catches them anyway.
-## What this means for plans and specs
+- Pre-production posture: gate state shifts as the codebase shifts. The CI run is the only one fresh enough to act on.
 
-- A plan's "Verification commands" section per chunk lists ONLY lint, typecheck, build:server/client (when relevant), and targeted unit tests for that chunk. No `scripts/verify-*.sh`, no `npm run test:*` umbrella commands.
+## What this means for plans and specs
-- A plan does NOT include a "Phase 0 baseline gate run" or a "Programme-end full gate set" section. CI does both.
+
-- A spec MUST NOT instruct implementers to run any forbidden command above. Spec-reviewer auto-fixes specs that do.
+- A plan's "Verification commands" section per chunk lists ONLY lint, typecheck, build:server/client (when relevant), and targeted unit tests for that chunk. No `scripts/verify-*.sh`, no `npm run test:*` umbrella commands.
-- A pull request that requires the operator to "run the gates locally to confirm" before merging is mis-scoped. Either CI catches it, or it's not gate-relevant.
+- A plan does NOT include a "Phase 0 baseline gate run" or a "Programme-end full gate set" section. CI does both.
-
+- A spec MUST NOT instruct implementers to run any forbidden command above. Spec-reviewer auto-fixes specs that do.
-## Pre-existing gate violations
+- A pull request that requires the operator to "run the gates locally to confirm" before merging is mis-scoped. Either CI catches it, or it's not gate-relevant.
 
-If a plan or implementation suspects pre-existing gate violations:
+## Pre-existing gate violations
-1. Identify the suspected violation by static reasoning (read the code, read the gate script's grep pattern, point at the offending line).
+
-2. If the new code clearly depends on the violating pattern, add a "Pre-existing violation to fix" item to the plan with the file, the fix, and a one-line justification.
+If a plan or implementation suspects pre-existing gate violations:
-3. CI will catch any baseline violation we missed when the PR is opened — that is the expected behaviour. Don't pre-empt CI by running gates locally.
+1. Identify the suspected violation by static reasoning (read the code, read the gate script's grep pattern, point at the offending line).
-
+2. If the new code clearly depends on the violating pattern, add a "Pre-existing violation to fix" item to the plan with the file, the fix, and a one-line justification.
-## How to reference this file
+3. CI will catch any baseline violation we missed when the PR is opened — that is the expected behaviour. Don't pre-empt CI by running gates locally.
 
-Agent files and specs that need to enforce the rule should link here rather than embedding their own copy:
+## How to reference this file
 
-```markdown
+Agent files and specs that need to enforce the rule should link here rather than embedding their own copy:
-**Test gates are CI-only.** See [`references/test-gate-policy.md`](../../references/test-gate-policy.md). The forbidden / allowed lists live there; this agent enforces them at <step or boundary>.
+
-```
+```markdown
-
+**Test gates are CI-only.** See [`references/test-gate-policy.md`](../../references/test-gate-policy.md). The forbidden / allowed lists live there; this agent enforces them at <step or boundary>.
-Agents may add a one-line clarification specific to their step (e.g. "step 5 re-verification is limited to reading the affected file back; never runs gates"), but should not duplicate the forbidden / allowed lists.
+```
 
+Agents may add a one-line clarification specific to their step (e.g. "step 5 re-verification is limited to reading the affected file back; never runs gates"), but should not duplicate the forbidden / allowed lists.
+
+## Audit-prevention-gates policy (2026-05-14)
+
+Introduced by the `audit-prevention-gates-2026-05-14` build. The three contracts below extend (do not replace) the canonical "Test gates are CI-only" rule.
+
+**Baseline expiry policy.** The expiry framework applies to **violation-list baselines** — baselines under `scripts/.gate-baselines/<guard-id>.txt` whose entries match the canonical violation-key format `<relative-path>:<line>:<message>`. Each such entry MUST be preceded by an `# expires: YYYY-MM-DD` directive on the line above. Entries become warning (exit 2 contribution) at expiry; entries become error (exit 1 contribution) after `GATE_GRACE_DAYS` (default 30) past expiry. Implementation: `scripts/lib/guard-utils.sh::check_expiring_baseline` (introduced by chunk 1).
+
+**Per-file count baselines are out of scope for the expiry framework.** Baselines under `scripts/.gate-baselines/` that use the `<relative-path>:<count>` format — currently `any-budget.txt` and `marker-budget.txt`, consumed by `scripts/verify-any-budget.sh` (P9) and `scripts/verify-marker-budget.sh` (P10) via `scripts/lib/per-file-counter-pure.mjs::parsePerFileBudgetBaseline` — promote on **count growth**, not on calendar expiry. Any `# expires: YYYY-MM-DD` lines in those two files are informational soft-deadlines for human review only; `parsePerFileBudgetBaseline` strips them and `diffAgainstBaseline` compares counts only. Adding expiry enforcement to these gates is tracked as a follow-up — see `tasks/todo.md § BUDGET-EXPIRY-ENFORCEMENT-1`. New per-file count gates SHOULD NOT add `# expires:` directives until that follow-up lands.
+
+**Suppression annotation grammar.** Five forms supported in declining preference order:
+- T1 preferred: `// guard-ignore: <guard-id> reason="<rationale>"`
+- ADR shape: `// guard-ignore: <guard-id> ADR-<id> <rationale>` (used by gates that require ADR sign-off for new baselines)
+- Legacy with `reason="..."`: same shape, accepted for transition
+- T0 deprecated: `// guard-ignore: <guard-id>` (no reason) — gates emit `error` severity on T0-only suppressions
+- Next-line and file-scoped: documented in the `guard-utils.sh` header
+
+Cross-reference the suppression-grammar header block at the top of `scripts/lib/guard-utils.sh`.
+
+**Warning-first promotion policy.** New gates ship with `default_exit_code=2` (warning). Promotion to `exit 1` (error) is per-gate, operator-initiated, after a minimum one-week soak post-merge. Each promotion is a single-gate PR that flips the gate's `DEFAULT_EXIT_CODE` and surfaces any baseline expirations the soak window revealed. Cross-reference Operator decision §C1 of the prevention-gates plan at `tasks/builds/audit-prevention-gates-2026-05-14/plan.md`.
+
```

### `references/spec-review-directional-signals.md`

```diff
@@ -32,10 +32,10 @@
 - "Add chaos / resilience tests beyond the existing round-trip"
 - "Add adversarial security tests beyond what static gates catch"
 - "Add frontend unit tests"
-- "Add E2E tests of the {{PROJECT_NAME}} app"
+- "Add E2E tests of the Automation OS app"
 
 ## Rollout posture signals
 
 - "Feature-flag this"
 - "Stage the rollout"
 - "Verify in staging between steps"
```

### `docs/spec-context.md`

```diff
@@ -13,15 +13,15 @@
 # Update last_reviewed_at when the framing block below is verified or modified.
 # stale_after_days = 60: spec-reviewer warns when last_reviewed_at is older.
 # stale_blocks_at_days = 120: spec-reviewer refuses to start until reviewed.
-last_reviewed_at: 2026-04-16
+last_reviewed_at: 2026-05-11
 stale_after_days: 60
 stale_blocks_at_days: 120
 ```
 
-Current as of 2026-04-16. Update the date whenever any of the statements below change AND when the framing is verified to still apply (even if no statement changed). The staleness check above turns "I'll re-check this someday" into "the agent stops me at 4 months."
+Current as of 2026-05-10. Update the date whenever any of the statements below change AND when the framing is verified to still apply (even if no statement changed). The staleness check above turns "I'll re-check this someday" into "the agent stops me at 4 months."
 
 ```yaml
 # Deployment context
 pre_production: yes
 live_users: no
 live_agencies: no
```

### `docs/doc-sync.md`

```diff
@@ -15,10 +15,10 @@
 | Doc | Update when… |
 |-----|-------------|
 | `architecture.md` | Service boundaries, route conventions, three-tier agent model, orchestrator routing, task system, RLS / schema invariants, run-continuity, agent fleet, key-files-per-domain, audit framework |
-| `docs/capabilities.md` | **Capability Registration trigger.** Update when any merge creates, mutates, splits, or merges a capability surface (an Asset Register row changes). **Editorial Rules apply** — see § *Editorial Rules* in that file. External-ready prose only; no engineer-facing primitives.<br><br>**Verdict format (combined):** exactly one of these eight strings — no other phrasing is valid:<br>- `yes: create new capability record`<br>- `yes: update existing capability record`<br>- `yes: split existing capability record`<br>- `yes: merge with existing capability record`<br>- `n/a: docs-only change`<br>- `n/a: test-only change`<br>- `n/a: internal refactor with no capability surface change`<br>- `n/a: build / tooling change only`<br><br>A `yes`-class verdict requires that the Asset Register row(s) follow your repo's capability spec and that one of the registration outcomes is named explicitly. A `n/a`-class verdict requires that one of the four reasons above is named explicitly. Any other phrasing is invalid and treated as a missing verdict — which blocks `MERGE_READY`. |
+| `docs/capabilities.md` | **Capability Registration trigger** (spec-section references §6.2.1 / §7.4.1 / §7.4.4 resolve to `tasks/builds/development-lifecycle-governance-upgrade/spec.md`). Update when any merge creates, mutates, splits, or merges a capability surface — i.e. anything that would change an Asset Register row's spec §7.4.1 fields (Capability ID/slug, Name, Description, Owner, Cluster, Lifecycle state, Launch source, Risk surface, Last review date, Carry notes, Decommission notes, Related docs). **Editorial Rules apply** — see § *Editorial Rules* in that file. External-ready prose only; no engineer-facing primitives.<br><br>**Verdict format (§6.2.1 combined format):** exactly one of these eight strings — no other phrasing is valid:<br>- `yes: create new capability record`<br>- `yes: update existing capability record`<br>- `yes: split existing capability record`<br>- `yes: merge with existing capability record`<br>- `n/a: docs-only change`<br>- `n/a: test-only change`<br>- `n/a: internal refactor with no capability surface change`<br>- `n/a: build / tooling change only`<br><br>A `yes`-class verdict requires that the Asset Register row(s) follow spec §7.4.1 and that one of the §7.4.4 registration outcomes is named explicitly. A `n/a`-class verdict requires that one of the four reasons above is named explicitly. Any other phrasing is invalid and treated as a missing verdict — which blocks `MERGE_READY`. |
 | `docs/integration-reference.md` | Any change to integration behaviour: new scope, new skill, changed status, new write capability, new OAuth provider, new MCP preset, new capability slug, new alias. Update `last_verified`. |
 | `CLAUDE.md` / `DEVELOPMENT_GUIDELINES.md` | Any change touching build discipline, conventions, agent fleet, review pipeline, locked rules (RLS, service-tier, gates, migrations, §8 development discipline). Also triggered by `[missing-doc] > 2`. |
 | `CONTRIBUTING.md` | Any change to lint-suppression policy, `// reason:` comment format, acceptable / forbidden disable patterns, or addition of new contributor-facing conventions. |
 | `docs/frontend-design-principles.md` | Any new UI pattern, hard rule, or worked example introduced this session. |
 | `KNOWLEDGE.md` | Patterns and corrections — always check. **Note:** architectural decisions go to `docs/decisions/` (ADRs), not KNOWLEDGE.md. |
 | `docs/spec-context.md` | **Spec-review sessions only.** Any framing-assumption change implied by the spec under review. Bump `last_reviewed_at` when you confirm framing is still current — the staleness gate in `spec-reviewer` blocks at 120 days. |
@@ -27,83 +27,83 @@
 | `references/test-gate-policy.md` | When the test-gate posture changes (a new umbrella command becomes forbidden, a new local check becomes allowed). |
 | `references/spec-review-directional-signals.md` | When `spec-reviewer` surfaces the same scope/sequencing/posture call >2 times — add a signal so the classifier catches it. |
 | `docs/incident-response.md` | When the SEV classification matrix, on-call rotation, timeline-log format, post-mortem template, or escalation paths change. |
-| `.claude/FRAMEWORK_VERSION` + `.claude/CHANGELOG.md` | Every framework-level change ships with a version bump and changelog entry. Repo-specific changes (your own architecture.md edits, your own agent additions) DO NOT bump the framework version — that tracks the agent-fleet/conventions layer only. |
+| `docs/testing-transition-plan.md` | When migration triggers, test-inventory sequencing, per-area effort estimates, or phasing decisions change. |
-
+| `.claude/FRAMEWORK_VERSION` + `.claude/CHANGELOG.md` | Every framework-level change ships with a version bump and changelog entry. Repo-specific changes (your own architecture.md edits, your own agent additions) DO NOT bump the framework version — that tracks the agent-fleet/conventions layer only. |
----
+| `scripts/verify-*` (15 gates from audit-prevention-gates-2026-05-14; P6 dropped per §B1) | Triggers when adding/removing/renaming a gate, when changing suppression grammar, when changing baseline expiry policy. Update `references/test-gate-policy.md` if the gate posture changes |
 
-## Investigation procedure
+---
 
-Every doc-sync sweep MUST execute this procedure per registered doc. Verdicts cannot be assigned without it. The procedure is the gate; the verdict is the receipt.
+## Event registry conventions
 
-1. **Read the doc.** Open the file. Do not rely on prior summaries, prior reviews, or memory.
+### `operator-session.*` lifecycle event namespace (operator-backend, 2026-05)
-2. **Derive a candidate-stale-reference set from the branch diff.** Build a deterministic list of grep terms drawn from this session's changes:
+
-   - File paths the diff renames, deletes, or moves
+Hyphenated lifecycle events (`operator-session.*`) are distinct from dotted incident/audit events (`operator.*`, `task.operator.*`, `subaccount.operator_settings.*`). The separation is enforced by a CI gate.
-   - Symbols renamed, removed, or added: agent names, service names, primitive names, function names, table names, config keys, route paths, env vars, capability slugs, skill names
+
-   - Behaviour, invariants, or rules introduced, changed, or removed
+**Single source of truth:** `shared/types/operatorBackendEvents.ts` — the discriminated union for all `operator-session.*` event-name literals. Any file that needs to reference an event name literal MUST import from this file; it MUST NOT declare a string literal inline (even if the string is identical).
-   - Any new name introduced in the branch that the doc may need to mention going forward
+
-3. **Grep the doc for each candidate.** Every hit becomes a stale-reference candidate.
+**CI gate:** `scripts/gates/verify-operator-event-registry.sh` — greps the repo for naked `operator-session.*` string literals outside the registry file and the explicitly allow-listed paths (the registry file itself, test fixtures, this spec, plan, and brief). Non-empty output from the gate = CI failure.
-4. **For each hit, verify and fix in this same finalisation pass:**
+
-   - Stale → update the doc now. Do not defer. Do not log a TODO. Do not assume someone else will see it.
+**Why this matters:** before this gate, event-name strings drifted across handlers and services, making it impossible to enumerate all producers or consumers of an event without a full-text search. The single-source-of-truth pattern prevents silent drift. Future event families that span multiple producers and consumers should adopt the same pattern: one `shared/types/<domain>Events.ts` file + one CI gate in `scripts/gates/verify-<domain>-event-registry.sh`.
-   - Still correct (mention is intentional and accurate) → leave alone.
+
-5. **Record the verdict** per Verdict rule below — only after steps 1–4 ran.
+---
 
-A "no" verdict cited from memory or skim is a missing verdict. The grep terms in step 2 are the audit trail; the verdict cites them.
+## Investigation procedure
 
----
+Every doc-sync sweep MUST execute this procedure per registered doc. Verdicts cannot be assigned without it. The procedure is the gate; the verdict is the receipt.
 
-## Verdict rule
+1. **Read the doc.** Open the file. Do not rely on prior summaries, prior reviews, or memory.
-
+2. **Derive a candidate-stale-reference set from the branch diff.** Build a deterministic list of grep terms drawn from this session's changes:
-For each doc, record one of:
+   - File paths the diff renames, deletes, or moves
-
+   - Symbols renamed, removed, or added: agent names, service names, primitive names, function names, table names, config keys, route paths, env vars, capability slugs, skill names
-- `yes (sections X, Y)` — doc was updated as part of step 4; cite headings actually edited (e.g. `yes (Agent Workplace Identity, Playbook Engine)`), not vague descriptors like `yes (misc updates)`.
+   - Behaviour, invariants, or rules introduced, changed, or removed
-- `no — <rationale>` — investigation procedure ran clean. The rationale MUST include either:
+   - Any new name introduced in the branch that the doc may need to mention going forward
-  - The grep terms checked against this doc and found absent (e.g. `no — checked feature-coordinator, builder, finalisation-coordinator, dual-reviewer; zero stale references`), OR
+3. **Grep the doc for each candidate.** Every hit becomes a stale-reference candidate.
-  - The specific reason this doc's update trigger from the table above did not actually apply to the change-set (e.g. `no — no skill / capability / integration add/remove/rename in this PR`).
+4. **For each hit, verify and fix in this same finalisation pass:**
-  Without one of those, the verdict is treated as missing.
+   - Stale → update the doc now. Do not defer. Do not log a TODO. Do not assume someone else will see it.
-- `n/a` — step 2 produced zero candidates relevant to this doc's update trigger; the doc's scope per the table above was not touched.
+   - Still correct (mention is intentional and accurate) → leave alone.
-
+5. **Record the verdict** per Verdict rule below — only after steps 1–4 ran.
-**A missing or unsubstantiated verdict blocks finalisation.** Stale docs are a blocking issue per `CLAUDE.md § 11`.
+
-
+A "no" verdict cited from memory or skim is a missing verdict. The grep terms in step 2 are the audit trail; the verdict cites them.
----
+
-
+---
-## Final Summary fields
+
-
+## Verdict rule
-Every finalised `chatgpt-pr-review` and `chatgpt-spec-review` log must include these fields in its `## Final Summary` block:
+
-
+For each doc, record one of:
-```
+
-- KNOWLEDGE.md updated: yes (N entries) | no — <rationale>
+- `yes (sections X, Y)` — doc was updated as part of step 4; cite headings actually edited (e.g. `yes (Agent Workplace Identity, Playbook Engine)`), not vague descriptors like `yes (misc updates)`.
-- architecture.md updated: yes (sections X, Y) | no — <rationale> | n/a
+- `no — <rationale>` — investigation procedure ran clean. The rationale MUST include either:
-- capabilities.md updated: yes (sections X) | no — <rationale> | n/a
+  - The grep terms checked against this doc and found absent (e.g. `no — checked feature-coordinator, builder, finalisation-coordinator, dual-reviewer; zero stale references`), OR
-- integration-reference.md updated: yes (slug X) | no — <rationale> | n/a
+  - The specific reason this doc's update trigger from the table above did not actually apply to the change-set (e.g. `no — no skill / capability / integration add/remove/rename in this PR`).
-- CLAUDE.md / DEVELOPMENT_GUIDELINES.md updated: yes | no — <rationale> | n/a
+  Without one of those, the verdict is treated as missing.
-- spec-context.md updated: yes | no — <rationale> | n/a   # spec-review sessions only
+- `n/a` — step 2 produced zero candidates relevant to this doc's update trigger; the doc's scope per the table above was not touched.
-- frontend-design-principles.md updated: yes | no — <rationale> | n/a
+
-```
+**A missing or unsubstantiated verdict blocks finalisation.** Stale docs are a blocking issue per `CLAUDE.md § 11`.
 
-`spec-context.md` applies to spec-review sessions only — omitted from PR review and feature-pipeline summaries.
+---
 
----
+## Final Summary fields
 
-## Where this is enforced
+Every finalised `chatgpt-pr-review` and `chatgpt-spec-review` log must include these fields in its `## Final Summary` block:
 
-- **`chatgpt-pr-review`** — Finalization step 6 (Doc sync sweep)
+```
-- **`chatgpt-spec-review`** — Finalization step 5 (Doc sync sweep)
+- KNOWLEDGE.md updated: yes (N entries) | no — <rationale>
-- **`feature-coordinator`** — D.5 (Doc Sync gate), applied across full feature change-set
+- architecture.md updated: yes (sections X, Y) | no — <rationale> | n/a
-- **`tasks/review-logs/README.md`** — Final Summary fields table
+- capabilities.md updated: yes: <registration-outcome> | n/a: <reason>  (§6.2.1 format — eight valid strings listed in the Capability Registration section above; any other phrasing is invalid and treated as a missing verdict)
-
+- integration-reference.md updated: yes (slug X) | no — <rationale> | n/a
+- CLAUDE.md / DEVELOPMENT_GUIDELINES.md updated: yes | no — <rationale> | n/a
+- spec-context.md updated: yes | no — <rationale> | n/a   # spec-review sessions only
+- frontend-design-principles.md updated: yes | no — <rationale> | n/a
+```
+
+`spec-context.md` applies to spec-review sessions only — omitted from PR review and feature-pipeline summaries.
+
+---
+
+## Where this is enforced
+
+- **`chatgpt-pr-review`** — Finalization step 6 (Doc sync sweep)
+- **`chatgpt-spec-review`** — Finalization step 5 (Doc sync sweep)
+- **`feature-coordinator`** — D.5 (Doc Sync gate), applied across full feature change-set
+- **`tasks/review-logs/README.md`** — Final Summary fields table
+
```
