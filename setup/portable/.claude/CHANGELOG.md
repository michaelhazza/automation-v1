# Claude Code Framework — Changelog

This file tracks framework versions for cross-repo drift detection. The version lives in `.claude/FRAMEWORK_VERSION` (single line, semver). When you propagate this framework to a new repo, the version travels with it; future updates can compare versions and produce a delta.

## Format

```
## <version> — <YYYY-MM-DD>

**Highlights:** one paragraph of what shipped.

**Breaking:** changes that require manual migration in repos already on a previous version.
**Added:** new agents, hooks, conventions, or scaffolding.
**Changed:** existing files updated in place; agents now do X instead of Y.
**Deprecated:** still works, but slated for removal.
**Removed:** files / agents / conventions no longer in the framework.
**Fixed:** bugs, doc-rot, broken cross-references.
```

## Upgrade protocol

When a repo's `FRAMEWORK_VERSION` falls behind the latest:

1. **Read this changelog** from the latest version backward to your current one.
2. **For each `Breaking:` entry**, follow the migration note. Don't skip.
3. **For each `Added:` entry**, decide whether to adopt (some additions are opt-in).
4. **For each `Changed:` entry**, diff your local file against the new template — the change may already exist locally if you customised, or may need to be re-applied.
5. **Update `.claude/FRAMEWORK_VERSION`** to the new version.
6. **Run `validate-setup`** (when that skill exists) or the agent fleet's smoke test to confirm the upgrade landed cleanly.

Repos can stay on older versions intentionally. The framework is designed to be additive; older versions don't break.

---

## 2.2.1 — 2026-05-07

**Highlights:** finalisation-coordinator now auto-resolves known-shape merge conflicts during S2 sync instead of pausing for operator confirmation on every run.

**Changed:**
- `.claude/agents/finalisation-coordinator.md` § Step 2 — added an auto-resolve table for append-only artefact files and feature-branch-canonical files: `tasks/builds/{slug}/spec.md`/`plan.md`/`progress.md`/`handoff.md`/`mockup-log.md` and `tasks/current-focus.md` are taken from HEAD ("ours"); `tasks/todo.md`, `tasks/review-logs/_index.jsonl`, `tasks/lessons.md`, and `KNOWLEDGE.md` are union-merged by stripping conflict markers (safe because all four are append-only by convention). Code-area conflicts (`client/`, `server/`, `shared/`, `worker/`, `scripts/`, `migrations/`, `architecture.md`, `CLAUDE.md`, `DEVELOPMENT_GUIDELINES.md`) still pause for operator review. Removes the operator round-trip on conflicts that always have a deterministic resolution. Also relaxes the post-merge overlap check from "require explicit confirmation" to "continue silently" — overlap alone is not a signal; the conflict protocol handles the actual collisions.

---

## 2.2.0 — 2026-05-04

**Highlights:** adds sync infrastructure for one-command framework upgrade across consuming repos. Introduces `manifest.json` (file ownership declaration), `sync.js` (deterministic sync engine, ~300 lines JS with JSDoc types), and `SYNC.md` (guided upgrade prompt for Claude sessions). Migrates placeholder format from `[PROJECT_NAME]` to canonical `{{PROJECT_NAME}}` (double-brace) across all agent files and docs. ADAPT.md Phase 6 now records adoption state in `.claude/.framework-state.json` for future syncs.

**Breaking:** NONE (additive — old `[…]` placeholders are ignored by sync.js, but ADAPT.md authors must use `{{...}}` format from this version forward).

**Added:**
- `setup/portable/manifest.json` — declares which files are framework-managed, their sync mode, and substitution behaviour.
- `setup/portable/sync.js` — the sync engine: reads manifest, classifies per-file state (clean/customised/new), applies substitutions, writes framework updates or `.framework-new` siblings for manual merge. Atomic state write. Flags: `--adopt`, `--dry-run`, `--check`, `--strict`, `--doctor`, `--force`.
- `setup/portable/SYNC.md` — guided upgrade walkthrough prompt. Claude reads it to walk the operator through a framework upgrade (diff versions, dry-run, run sync, resolve merges, verify, commit).
- `setup/portable/tests/` — unit and end-to-end tests for the sync engine (helpers, walk/classify, substitution, settings-merge, flags, e2e-adopt, e2e-sync, e2e-merge).

**Changed:**
- `setup/portable/ADAPT.md` — Phase 2 substitution table updated to `{{...}}` format; Phase 6 added (record adoption state with `sync.js --adopt`).
- `setup/portable/README.md` — updated to describe submodule + sync model; mentions SYNC.md for upgrades; documents `{{...}}` placeholder format.
- Placeholder format migrated across 14 source files in `setup/portable/` (agent files, docs, references).
- `scripts/build-portable-framework.ts` — preflight scan now also detects legacy `[PROJECT_NAME]`-style placeholders as errors. `FORBIDDEN_STRINGS` blacklist expanded with `AutomationOS` (no-space variant) and case variants (`automation-os`, `automation_os`, `automation_v1`, `automationV1`, lowercase / uppercase Synthetos) to catch project-name leakage that the original list missed.
- `scripts/build-portable-framework.ts` — added `assertZipBinaryAvailable()` preflight before invoking `zip` on POSIX, with installation hints for apt / apk / brew so minimal containers fail with a clear error instead of cryptic ENOENT.
- `package.json` — added `test:portable-framework` script (`node --import tsx --test setup/portable/tests/*.test.ts`) and `.github/workflows/ci.yml` `portable_framework_tests` unconditional CI gate that runs the same script on every PR.

**Fixed:**
- Placeholder format consistency: all `[PROJECT_NAME]` occurrences in portable bundle migrated to `{{PROJECT_NAME}}`.
- Two `AutomationOS` (no-space variant) leaks in `setup/portable/.claude/agents/audit-runner.md` replaced with `{{PROJECT_NAME}}`. The forbidden-string scanner only caught `Automation OS` (with space) before this release; both variants are now caught.

**Notes:**
- Version authority is now explicit: `setup/portable/.claude/CHANGELOG.md` (this file) is canonical; `.claude/CHANGELOG.md` in any consuming repo is a deployment marker. See the deployment-marker file's § *Version authority — single source of truth* for the rules.

---

## 2.1.0 — 2026-05-04

**Highlights:** adds in-repo portable bundle infrastructure so the framework can be reproducibly exported to other repos. Adds the SessionStart hook for self-healing code-intelligence cache. Adds the `validate-setup` agent for ongoing framework health checks.

**Added:**
- `setup/portable/` — in-repo source of truth for the export bundle. Mirrors the agent fleet, hooks, and conventions with placeholders substituted at adoption time.
- `setup/portable/ADAPT.md` — master prompt for adapting the framework to a target repo (5-phase walkthrough + profile selector MINIMAL/STANDARD/FULL).
- `setup/portable/README.md` — drop-in instructions for target repos.
- `scripts/build-portable-framework.ts` — preflight-checks the bundle source (forbidden-string scan, conflict-marker scan, agent-count sanity, FRAMEWORK_VERSION ↔ CHANGELOG check) and produces a versioned zip at `dist/portable-claude-framework-v<VERSION>.zip`.
- `.claude/hooks/code-graph-freshness-check.js` — SessionStart hook. Detects a dead code-intelligence watcher at session start and rebuilds the cache plus respawns the watcher in-process. Steady-state cost <200ms; degrades gracefully when the cache build script is absent (so target repos that haven't adopted the cache infra still work).
- `.claude/agents/validate-setup.md` — read-only health-checker. Verifies every agent's referenced files exist, every context-pack anchor resolves in `architecture.md`, ADR index matches files on disk, FRAMEWORK_VERSION matches CHANGELOG, every hook is registered in settings.json. Use periodically to catch drift, or as a pre-merge gate for framework PRs.

**Changed:**
- `.claude/settings.json` — added `SessionStart` hook block for `code-graph-freshness-check`.
- `CLAUDE.md` § Code intelligence artifacts — three-tier refresh model (automatic via SessionStart hook / live during dev / manual). Adds explicit fallback for repos without the cache infra. Reframed as "(optional infra)" so target repos can adopt the cache later.

**Fixed:**
- `.claude/agents/hotfix.md` (internal) — replaced leftover `[PROJECT_NAME]` placeholder with the project name in the internal copy. Portable bundle's copy uses the canonical `{{PROJECT_NAME}}` format.

---

## 2.0.0 — 2026-05-03

**Highlights:** major refactor of the agent fleet for cross-repo portability. Adds ADR convention, mode-scoped context packs, hotfix path, and a stack-neutral templating layer (ADAPT.md). Extracts duplicated boilerplate to references/. Removes hardcoded JS-stack assumptions from the framework core.

**Breaking:**
- Agent file `Context Loading` blocks for `architect`, `pr-reviewer`, `spec-conformance`, `adversarial-reviewer` now reference architecture.md anchor IDs (e.g. `architecture.md#service-layer`) instead of section names. **If you renamed sections in your architecture.md, you must regenerate anchors via the script in tasks/builds/_example/ or run ADAPT.md again.**
- "Test gates are CI-only" boilerplate moved from individual agent files to `references/test-gate-policy.md`. Agents now reference the file. **No-op for operators**, but if you forked an agent file before this version, your fork still has the duplicated boilerplate.

**Added:**
- `.claude/agents/hotfix.md` — fast-path coordinator for time-critical fixes.
- `.claude/agents/context-pack-loader.md` — inline playbook that loads a mode-scoped slice of architecture.md instead of the full file.
- `.claude/agents/codebase-explainer.md` — produces human-facing onboarding tour at `docs/codebase-tour.md`.
- `docs/decisions/` — ADR convention with template + 5 inaugural ADRs.
- `docs/context-packs/` — five mode-scoped packs (review / implement / debug / handover / minimal).
- `references/test-gate-policy.md` — single source of truth for the "test gates are CI-only" rule.
- `references/spec-review-directional-signals.md` — extracted from spec-reviewer.md (was 70 lines of inline bullet lists).
- `references/verification-commands.md` — stack-specific lint/typecheck/test commands template (portable zip only).
- 54 HTML anchors in `architecture.md` so context-packs can splice precisely.
- `Status:` header convention for specs (see `docs/spec-authoring-checklist.md` § 11) — enables future archive sweeps.
- `last_reviewed_at` / `stale_after_days` / `stale_blocks_at_days` staleness gate in `docs/spec-context.md`. `spec-reviewer` enforces it before iteration 1.
- `.claude/FRAMEWORK_VERSION` + this CHANGELOG for cross-repo drift detection.

**Changed:**
- `KNOWLEDGE.md` preamble now distinguishes observations / gotchas / corrections (KNOWLEDGE) from architectural decisions (ADRs in `docs/decisions/`).
- `spec-reviewer.md` slimmed (575 → 509 lines) by extracting the directional-signals classifier.
- `architecture.md` cross-link from `references/project-map.md` softened to "optional infra" — no longer claims the cache always exists.

**Deprecated:**
- "Decision" category in KNOWLEDGE.md — write an ADR in `docs/decisions/` instead. Existing entries stay; new entries should not use this category.

**Removed:**
- `quality-checker-gpt.md` (legacy GPT pipeline doc) — moved to `docs/_archive/`.

**Fixed:**
- 9 fully-resolved sections in `tasks/todo.md` archived to `tasks/todo-archive/2026-Q2.md`.
- `replit.md` is now cross-linked from `CLAUDE.md` (was load-bearing but undocumented).
- `references/` directory presence treated as optional in `CLAUDE.md` and `architect.md` (was previously assumed always-present).

---

## 1.0.0 — predates this changelog

The original {{PROJECT_NAME}} internal setup. Agent fleet of 16, three-coordinator pipeline, ChatGPT review agents, doc-sync sweep, audit framework. No formal version tracking.
