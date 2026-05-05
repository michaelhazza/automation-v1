# A1b — Principal-context propagation: gate hardening + caller enforcement

**Build slug:** `tasks/builds/audit-remediation-followups/a1b-principal-context-gate/`
**Branch:** `claude/deferred-quality-fixes-ZKgVV`
**Commit at start:** `50c3016789041d27ade8ebc97b0b49678aec5bc4`

## Step 1 — Pre-condition shim-usage greps

A1a left no deprecated shims; the canonicalDataService surface ships only the
new `(principal: PrincipalContext, …)` signatures. All four pre-flight greps
return zero results — confirming no caller still depends on the old positional
`(organisationId, …)` shape.

```
$ grep -rn "@deprecated — remove in A1b" server/
(no matches)

$ grep -rn "canonicalDataService\.\w+(\s*organisationId" server/ | grep -v __tests__
(no matches)

$ grep -rn "canonicalDataService\.\w+(\s*orgId" server/ | grep -v __tests__
(no matches)
```

Cross-check against A1a inventory: every call site listed in A1a's
`canonical-call-sites.md` now passes `fromOrgId(...)` (or an identifier
assigned from it). Verified by listing all 42 invocations across the five
caller files; every one uses `principal`, `orgPrincipal`, or `accountPrincipal`,
each of which is `const … = fromOrgId(…)` in the same scope.

Verdict: pre-conditions met, A1b proceeds.

## Step 2 — Read current gate

`scripts/verify-principal-context-propagation.sh` was file-level: it scanned
files importing `canonicalDataService` and flagged any that did NOT also import
`fromOrgId` / `withPrincipalContext` / `principal/types`. That gate accepts
ANY first argument once a single principal-context import is present in the
file — so it cannot detect a file that imports `fromOrgId` once but then makes
a `canonicalDataService.upsertContact(orgIdString, …)` call.

## Step 3 — Rewrite to call-site granularity

New gate at `scripts/verify-principal-context-propagation.sh`. Strategy:

1. Identify candidate files via `grep -rl 'canonicalDataService' server/` minus
   `canonicalDataService.ts` and `__tests__/`.
2. For each file, honour the top-of-file annotation
   `// @principal-context-import-only — reason: <one-sentence>` (skip if present).
3. For each `canonicalDataService.<method>(` invocation:
   - Read up to 10 lines forward from the call site to handle multi-line
     argument lists.
   - Strip everything up to and including the call site, then walk the
     remainder character-by-character tracking `( )`, `[ ]`, `{ }` depth, and
     stop at the first depth-0 comma or closing paren — that span is the first
     argument.
   - Classify:
     - `fromOrgId(` / `fromOrgId<` / `withPrincipalContext(` → PASS
     - `{...` (object literal) → VIOLATION
     - `...x` (spread) → VIOLATION
     - Bare identifier → trace back: PASS if the same file declares
       `<ident>: PrincipalContext` (function param annotation) OR
       `const|let|var <ident>(: PrincipalContext)? = (fromOrgId|withPrincipalContext)(...)`.
       Otherwise → VIOLATION.
4. Emit standard `[GATE] principal-context-propagation: violations=<count>` line
   via `emit_summary`.

`is_suppressed` (next-line / inline `guard-ignore`) is preserved as a per-call
escape hatch.

## Step 4 — Sample for FP/FN check

Total call sites on `main` after A1a: **42** across 5 files. Spec requires
sampling 50 or every site if fewer than 50 — so all 42 are sampled.

| File | Count | First-arg shape | Verdict |
|---|---|---|---|
| `server/jobs/measureInterventionOutcomeJob.ts` | 1 | `principal` (= `fromOrgId(orgId, sub)`) | PASS |
| `server/routes/webhooks/ghlWebhook.ts` | 4 | `principal` (= `fromOrgId(orgId, sub)`) | PASS ×4 |
| `server/services/connectorPollingService.ts` | 8 | `orgPrincipal` / `accountPrincipal` (each = `fromOrgId(...)`) | PASS ×8 |
| `server/services/crmQueryPlanner/executors/canonicalQueryRegistry.ts` | 8 | `principal` (= `fromOrgId(args.orgId, args.subaccountId)`) | PASS ×8 |
| `server/services/intelligenceSkillExecutor.ts` | 21 | `principal` (= `fromOrgId(...)`) | PASS ×21 |

Misclassifications: **0 / 42**. The trigger threshold for AST-fallback (≥3
misclassifications) is not met. Regex matcher ships as-is per spec §A1b
step 2 "Regex-fallback contract".

## Step 5 — `@principal-context-import-only` annotation support

Two files import or reference `canonicalDataService` only in commentary, with
no method invocations:

- `server/config/actionRegistry.ts` — references `canonicalDataService` in the
  P2A read-path classification doc comment. The earlier dead `import { fromOrgId }`
  added to satisfy the file-level gate has been removed; the file now carries
  `// @principal-context-import-only — reason: …` at the top.
- `server/services/crmQueryPlanner/crmQueryPlannerService.ts` — references
  `canonicalDataService` in a doc comment about the lazy-loaded executor.
  Annotated with the same marker.

Both files now drop out of the gate's enforcement scope cleanly.

## Step 6 — Fixtures

Authored under `scripts/__tests__/principal-context-propagation/`:

- `fixture-bare-identifier.ts` — VIOLATION
- `fixture-object-literal.ts` — VIOLATION
- `fixture-spread.ts` — VIOLATION
- `fixture-fromOrgId.ts` — PASS
- `fixture-typed-variable.ts` — PASS

Plus `run-fixture-check.sh`, a manual driver that stages each fixture into a
throw-away `server/`-shaped tree and runs the gate against it, asserting the
expected verdict. Run via `bash scripts/__tests__/principal-context-propagation/run-fixture-check.sh`:

```
PASS: bare-identifier (violations=1)
PASS: object-literal (violations=1)
PASS: spread (violations=1)
PASS: fromOrgId (violations=0)
PASS: typed-variable (violations=0)
All fixture checks passed.
```

These fixtures are reference cases — they are NOT part of the gate's run set
(they live under `scripts/__tests__/`, outside the `server/` glob). The
fixture driver is opt-in only.

## Step 7 — Baseline regeneration

Pre-A1b baseline: `principal-context-propagation: 4`. Post-A1b run:
`violations=0`. Updated `scripts/guard-baselines.json` to `0`.

## Step 8 — C1 standard line

```
$ bash scripts/verify-principal-context-propagation.sh 2>&1 | grep -E '^\[GATE\] '
[GATE] principal-context-propagation: violations=0
```

## Step 9 — Spec tracking

A1b row in §5 of the spec flipped to `✓ done` with this build slug.

## Manual deliberate-regression verification

```
# Inject one bare-identifier call.
$ sed -i 's/canonicalDataService.getAccountById(principal, accountId)/canonicalDataService.getAccountById(organisationId, accountId)/' \
    server/services/intelligenceSkillExecutor.ts
$ bash scripts/verify-principal-context-propagation.sh
… 3 violations, [GATE] principal-context-propagation: violations=3 …
$ git checkout server/services/intelligenceSkillExecutor.ts
$ bash scripts/verify-principal-context-propagation.sh
[GATE] principal-context-propagation: violations=0
```

Gate fails on the regression as required (acceptance criteria step 3).

## Outcome

DONE. Gate is now call-site granular, violations=0, baseline updated, fixtures
in place, C1 emit-line preserved. No new dependencies introduced; regex matcher
sufficient for current call-site shape (0 misclassifications across all 42
sites on main).
