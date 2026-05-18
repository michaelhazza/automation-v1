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

## Version authority — single source of truth

**The standalone `claude-code-framework` repo, mounted here as a submodule at `.claude-framework/`, is the canonical framework. Root `.claude/` is a deployment.**

After Phase C (2026-05-17), this repo consumes the framework as a submodule. The two `FRAMEWORK_VERSION` files do NOT have equal authority:

- **Canonical** — `.claude-framework/.claude/FRAMEWORK_VERSION` and `.claude-framework/.claude/CHANGELOG.md`. This is the framework artifact mounted from `github.com/michaelhazza/claude-code-framework`. All version decisions are made there. **`.claude-framework/.claude/CHANGELOG.md` is the source of truth.**
- **Deployment marker** — `.claude/FRAMEWORK_VERSION` and `.claude/CHANGELOG.md` (this file you are reading now). Records which version of the framework is currently *deployed* in this repo's `.claude/` tree for our own Claude Code sessions. NOT a separate version authority — it can lag the canonical version transiently while the framework advances ahead of self-adoption.

Adoption state is tracked in `.claude/.framework-state.json` (per-file hashes, substitutions, framework commit). Upgrade flow: `git submodule update --remote .claude-framework && node .claude-framework/sync.js`.

**Validate-setup and drift-detection tooling read the file relevant to scope, not as competing authorities:**
- "What version of the framework is *deployed* here?" → root `.claude/FRAMEWORK_VERSION` (in this repo OR any consuming repo's `.claude/`).
- "What version does the framework artifact ship?" → canonical `.claude-framework/.claude/FRAMEWORK_VERSION`.

These answer different questions. They are not asserted equal.

Drift between them is expected and bounded: a deployment may lag the canonical version, but should never *exceed* it. Validate-setup warns if the deployment file's version is greater than the canonical file's version.

---

## 2.5.0 — 2026-05-18

**Highlights:** Mockup pipeline gets a self-correcting loop. New `mockup-reviewer` agent independently audits every mockup-designer round for ungrounded surfaces (phantom pages, invented nav, fictional component extensions) and operator overload (jargon, exposed internals, complexity-budget breaches). New `mockup-coordinator` inline playbook owns the pre-spec mockup loop — any operator phrase like "create mockups for X" now triggers a self-correcting designer ↔ reviewer loop before the prototype reaches the operator. spec-coordinator's Step 5 reuses the same dispatch pattern.

**Added:**
- `.claude/agents/mockup-reviewer.md` — read-only audit agent for HTML prototypes. CLEAN / NEEDS_REWORK / NEEDS_DISCUSSION verdicts. Persists `mockup-review-log-round-N-*.md` per round.
- `.claude/agents/mockup-coordinator.md` — inline playbook for the pre-spec mockup loop. Operator entry phrases trigger main session to adopt the playbook.
- CLAUDE.md "Mockup-request handling rule" forbidding the main session from dispatching `mockup-designer` alone — must go through `mockup-coordinator` so the reviewer audit runs.

**Changed:**
- `.claude/agents/mockup-designer.md` — header now notes that the caller will run `mockup-reviewer` after every round, and that grounding (Step 0a) and simplification (Step 3 five-hard-rules) are the highest-leverage steps.
- `.claude/agents/spec-coordinator.md` Step 5 — mockup loop now dispatches `mockup-designer` AND `mockup-reviewer` as a pair per round; reuse-check detects existing `mockup-log.md` and skips Round 1 if `mockup-coordinator` already ran pre-spec.
- CLAUDE.md fleet table — added `mockup-coordinator` and `mockup-reviewer` rows; updated `mockup-designer` row.
- CLAUDE.md common-invocations block — added `mockup-coordinator: <brief>`, `create mockups for <feature>`, `mock up the <feature> feature`.
- CLAUDE.md inline-coordinator list — added `mockup-coordinator` to the set that runs INLINE.

## 2.4.0 — 2026-05-14

**Highlights:** adds lightweight governance overlay to the dev pipeline — intent intake, duplication/strategy check, Lifecycle Declaration + ABCd sizing, Asset Register, Capability Registration verdict, and Compound Learning Feedback. All additions are operator-driven and markdown-only; no new runtime code paths. Pipeline is fully backwards-compatible: Trivial builds keep the existing `brief.md` flow; Standard, Significant, and Major builds produce `intent.md` with a structured schema.

**Added:**
- `spec-coordinator.md` — Step 3 renamed to "Intent intake"; branches on classification (Trivial → `brief.md` unchanged; Standard+ → produces `tasks/builds/<slug>/intent.md` per §7.1 schema with 9 required H2 sections + §7.1.1 Risk Surface vocabulary + provisional-slug rule + migration rule).
- `spec-coordinator.md` — Step 3a "Duplication / Strategy Check" inserted between Step 3 and Step 4; 4-branch recommendation table (`proceed` / `revise` / `merge with existing capability` / `stop`); hard-gate and soft-gate behaviours; `**Operator decision:**` resume signal.
- `finalisation-coordinator.md` — Step 7a "Compound Learning Feedback" inserted between Step 7 and Step 8; 8-value target enum; 6-agent shortlist for `agent-instruction`; auto-apply prohibition; never blocks `MERGE_READY`.
- `docs/capabilities.md` — 10-cluster header (closed cluster list per §7.4.2); pinned 12-column Asset Register table header (§7.4.1); 47 existing capabilities backfilled as rows with spec-compliant placeholders per §7.4.3.
- `docs/doc-sync.md` — Capability Registration trigger row for `docs/capabilities.md` with all 8 §6.2.1 valid verdict strings; `MERGE_READY` block clause.

**Changed:**
- `spec-coordinator.md` Step 6 — required sections list now includes Lifecycle Declaration (§7.2: 5-field table) and ABCd Estimate (§7.3: 4-dimension S/M/L-only table); both templates reproduced inline.
- `finalisation-coordinator.md` Step 6 — extended to emit §6.2.1 combined Capability Registration verdict (`yes: <outcome>` or `n/a: <reason>`); 8 valid strings enumerated; `MERGE_READY` blocked until valid verdict recorded.
- `docs/spec-authoring-checklist.md` — Section 12 added (Lifecycle Declaration + ABCd blocks); two new Appendix pre-review checklist boxes.
- `CLAUDE.md` — `spec-coordinator` agent fleet row updated ("intent intake, duplication/strategy check, …"); Build lifecycle subsection added with corrected 9-step sequence.
- `architecture.md` — Dev build lifecycle subsection added with corrected 9-step sequence and orchestrator mapping.
- `docs/doc-sync.md` Final Summary fields — `capabilities.md updated` format updated to §6.2.1 combined eight-string format.
- `tasks/review-logs/README.md` — `capabilities.md updated` field format updated to §6.2.1 combined format.

---

## 2.3.0 — 2026-05-12

**Highlights:** adds `incident-commander` coordinator agent and companion `docs/incident-response.md`. Provides a dedicated inline playbook for production incident coordination (SEV classification, scribe duties, post-mortem) that is distinct from `hotfix`, which focuses on shipping the fix.

**Added:**
- `.claude/agents/incident-commander.md` — production incident coordinator (inline playbook). Handles SEV classification, scribe duties (timestamped timeline under `tasks/incidents/<YYYY-MM-DD-slug>/`), hotfix handoff, and post-mortem drive. Distinct from `hotfix`: incident-commander coordinates the response; hotfix fixes the fire.
- `docs/incident-response.md` — SEV matrix (four levels), on-call expectations, timeline-log format, and post-mortem template.

**Changed:**
- `CLAUDE.md` — added `incident-commander` row to agent fleet table; added `"incident-commander: prod is on fire"` invocation example.

---

## 2.2.0 — 2026-05-12

**Highlights:** adds `reality-checker` agent — a post-pr-reviewer evidence-demanding verifier that classifies the implementer's claimed success criteria against supplied evidence before a build is approved. Wires into `feature-coordinator`'s branch-level review pass (§8.4), Phase 2 branch-level sequence position is: `spec-conformance` → `adversarial-reviewer` (if §5.1.2 surface) → `pr-reviewer` → **`reality-checker`** → `dual-reviewer`. Mandatory for Significant/Major tasks.

**Added:**
- `.claude/agents/reality-checker.md` — read-only (Read, Glob, Grep) evidence verifier. Verdict enum: `READY` / `NEEDS_WORK` / `NEEDS_DISCUSSION`. Logs to `tasks/review-logs/reality-check-log-{slug}-{timestamp}.md`.

**Changed:**
- `.claude/agents/feature-coordinator.md` — inserted §8.4 `reality-checker` step in branch-level review pass; renumbered old §8.4 fix-loop to §8.5 and old §8.5 dual-reviewer to §8.6; updated handoff template with `reality-checker verdict:` line; updated TodoWrite expansion line.
- `CLAUDE.md` — added `reality-checker` row to agent fleet table; added invocation example; updated Review pipeline section to number reality-checker as step 3 (after pr-reviewer, before dual-reviewer).
- `tasks/review-logs/README.md` — added `reality-check` agent slug, `reality-checker` verdict enum table row, and caller-contract section.

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
- `.claude/agents/hotfix.md` (internal) — replaced leftover `[PROJECT_NAME]` placeholder with the project name in the internal copy. Portable bundle's copy retains the placeholder.

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

The original Automation OS internal setup. Agent fleet of 16, three-coordinator pipeline, ChatGPT review agents, doc-sync sweep, audit framework. No formal version tracking.
