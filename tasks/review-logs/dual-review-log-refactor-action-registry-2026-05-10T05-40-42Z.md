# Dual Review Log — refactor-action-registry

**Files reviewed:** `server/config/actionRegistry.ts` (shim), `server/config/actionRegistry/{types,factories,index,core,intelligence,agents,methodology,configuration,clientpulse,commerce,support}.ts`, `scripts/{audit-action-registry-risk-tiers,diff-action-registry,registrySerialiserPure,snapshot-action-registry,verify-action-registry-zod,verify-idempotency-strategy-declared,verify-skill-read-paths}.ts`, `scripts/verify-{action-registry-zod,idempotency-strategy-declared,skill-read-paths}.sh`, `scripts/snapshots/action-registry.snapshot.json`, `KNOWLEDGE.md`, `architecture.md`, `tasks/builds/refactor-action-registry/**`.
**Iterations run:** 2/3
**Timestamp:** 2026-05-10T05:40:42Z

---

## Iteration 1

Codex returned two prioritised findings against the uncommitted changes.

### [ACCEPT] P1: scripts/verify-action-call-allowlist.sh:30,64 — Greps the new shim file for registry entries

Codex's claim: after the refactor turned `server/config/actionRegistry.ts` into a 3-line re-export shim, this gate's grep `^\s+${slug}:` against that file returns 0 hits for every `config_*` mutation slug, because the actual entries now live under `server/config/actionRegistry/configuration.ts`. Verified by hand:

```
$ grep -E "^\s+config_create_agent:" server/config/actionRegistry.ts        # 0 hits
$ grep -rE "^\s+config_create_agent:" server/config/actionRegistry/         # 1 hit (configuration.ts)
```

The plan (`tasks/builds/refactor-action-registry/plan.md` line 83) lists `verify-action-call-allowlist.sh` among the gates that must still pass post-refactor, but the gate body was never updated. CI runs `npm test → test:gates → run-all-gates.sh` on `ready-to-merge` PRs and would have failed on every config_* mutation slug.

Reason for acceptance: real, in-scope CI regression introduced by the directory split. The fix is mechanical (point the grep at the directory rather than the shim file).

**Fix applied:** `scripts/verify-action-call-allowlist.sh` — replaced `REGISTRY_FILE="$ROOT_DIR/server/config/actionRegistry.ts"` with `REGISTRY_DIR="$ROOT_DIR/server/config/actionRegistry"`, switched the existence check to `[ ! -d "$REGISTRY_DIR" ]`, and switched the per-slug check to `grep -rqE "^\s+${slug}:" "$REGISTRY_DIR"` (recursive). Updated header comment to record the post-refactor scan target. Updated the violation message to reference the new path.

### [ACCEPT] P1: scripts/verify-action-registry-{zod,idempotency-strategy-declared,skill-read-paths}.ts — Hard-fail when `dist/` missing

Codex's claim: the three converted gates exit 1 with "run `npm run build:server` first" when `dist/server/config/actionRegistry.js` is absent, but `run-all-gates.sh` (invoked by CI's `npm test → test:gates`) does NOT run `build:server` first. On a clean checkout the three gates fail before they check anything; with stale `dist/` they validate stale code.

Verified by inspecting `package.json` (`test:gates → run-all-gates.sh`), `scripts/run-all-gates.sh` (no `build:server` step before `verify-{idempotency,zod,read-paths}`), and the existing precedent `verify-risk-tier-assigned.ts` which imports directly from `'../server/config/actionRegistry.js'` via tsx and works without dist.

The plan said "same pattern as `verify-runtime-check-coverage.mjs`" (line 317), which SKIPs (exit 0) on missing dist. The implementation diverged: it exits 1 instead, hardening the behaviour into a CI break. The better precedent already in this codebase is source-loading via tsx (`verify-risk-tier-assigned.ts`).

Reason for acceptance: real CI regression that would break the gate suite on `ready-to-merge` PRs. The fix is not "add a build step" (more brittle, slows the suite, makes the gate non-portable) but "switch the harness to source-loading via tsx" — strictly more reliable, no extra setup, matches the existing `verify-risk-tier-assigned.ts` precedent.

**Fix applied to all three harnesses:**
- `scripts/verify-action-registry-zod.ts` — replaced the `dist/` resolve+existsSync+pathToFileURL+import block with `import { ACTION_REGISTRY } from '../server/config/actionRegistry.js';`. Removed unused `existsSync`/`resolve`/`dirname`/`fileURLToPath`/`pathToFileURL` imports.
- `scripts/verify-idempotency-strategy-declared.ts` — same conversion.
- `scripts/verify-skill-read-paths.ts` — same conversion.
- Updated each `.sh` wrapper's header comment to record that no `npm run build:server` step is required (matches `verify-risk-tier-assigned.ts` pattern).

**Verification (live, post-fix):**
```
[verify-action-registry-zod] PASS — all 148 entries have parameterSchema: z.object({...}).
[verify-idempotency-strategy-declared] PASS — all 148 entries declare a valid idempotencyStrategy.
[verify-skill-read-paths] PASS — all 148 entries tagged with readPath, 12 liveFetch with rationale.
```

All three `.sh` wrappers also exit 0 end-to-end with the patched harnesses. `npm run lint` and `npm run typecheck` both clean (0 errors).

---

## Iteration 2

Codex re-reviewed the patched diff and returned:

> "I did not identify any discrete, actionable regressions in the current staged, unstaged, or untracked changes. The registry split preserves the public shim and the new verification scripts appear aligned with the refactor."

Loop terminates: no findings.

---

## Changes Made

- `scripts/verify-action-call-allowlist.sh` — switched registry scan from the shim file to the `server/config/actionRegistry/` directory; updated comments and violation message.
- `scripts/verify-action-registry-zod.ts` — switched from `dist/` import to source import via tsx; removed dist-existence precheck and dist-load error path.
- `scripts/verify-idempotency-strategy-declared.ts` — same dist→source switch.
- `scripts/verify-skill-read-paths.ts` — same dist→source switch.
- `scripts/verify-action-registry-zod.sh` — header comment updated: no `build:server` required.
- `scripts/verify-idempotency-strategy-declared.sh` — header comment updated: no `build:server` required.
- `scripts/verify-skill-read-paths.sh` — header comment updated: no `build:server` required.

## Rejected Recommendations

None — both Iteration 1 findings were accepted and applied.

---

**Verdict:** APPROVED (2 iterations, 2 P1 CI-regression findings accepted and fixed)
