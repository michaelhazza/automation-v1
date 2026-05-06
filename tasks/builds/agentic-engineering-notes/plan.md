# Agentic Engineering Notes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Translate four Karpathy "agentic engineering" takeaways into concrete repo changes — agent-shaped setup docs, an adversarial reviewer agent, a model-collapse pre-check in `architect`, and a verifiability heuristic in `CLAUDE.md`.

**Source spec:** [`docs/agentic-engineering-notes-dev-spec.md`](../../../docs/agentic-engineering-notes-dev-spec.md)
**Spec-review final:** [`tasks/review-logs/spec-review-final-agentic-engineering-notes-2026-04-30T08-51-18Z.md`](../../review-logs/spec-review-final-agentic-engineering-notes-2026-04-30T08-51-18Z.md)
**Branch:** `claude/agentic-engineering-notes-WL2of`
**Build slug:** `agentic-engineering-notes`

**Architecture:** Process / tooling only. No product code, no schema changes, no test-gate or CI changes. Nine tasks across four spec items: edits to `CLAUDE.md`, `replit.md`, `.claude/agents/architect.md`; new `.claude/agents/adversarial-reviewer.md`; new `scripts/README.md` and `docs/README.md`; a small TS extension to `tools/mission-control/server/lib/logParsers.ts` (with TDD coverage) so Mission Control's parser recognises adversarial-review logs; updates to `tasks/review-logs/README.md` to register the new agent's filename + verdict enum.

**Tech Stack:** Markdown (agent-facing, dense bullets per `CLAUDE.md` §13), TypeScript (single file in `tools/mission-control/`), no schema or product code.

**Task Classification:** **Significant** — multiple domains (agent fleet, mission-control parser, project docs, architect prompt), and a new agent contract pattern in the review pipeline. Run `pr-reviewer` after implementation. `spec-conformance` will run automatically (spec-driven). `dual-reviewer` only if explicitly requested.

**Executor notes:** Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.

---

## Table of contents

- [File Structure](#file-structure)
- [Build Order & Dependencies](#build-order--dependencies)
- [Task 1 — Item D: Verifiability heuristic in CLAUDE.md](#task-1--item-d-verifiability-heuristic-in-claudemd)
- [Task 2 — Item C: Model-collapse pre-check in architect](#task-2--item-c-model-collapse-pre-check-in-architect)
- [Task 3 — Item A.1: `replit.md` agent quick-start](#task-3--item-a1-replitmd-agent-quick-start)
- [Task 4 — Item A.2: `scripts/README.md`](#task-4--item-a2-scriptsreadmemd)
- [Task 5 — Item A.3: `docs/README.md` spec-corpus index](#task-5--item-a3-docsreadmemd-spec-corpus-index)
- [Task 6 — Item B.1: Mission Control parser extension (TDD)](#task-6--item-b1-mission-control-parser-extension-tdd)
- [Task 7 — Item B.2: `adversarial-reviewer` agent definition](#task-7--item-b2-adversarial-reviewer-agent-definition)
- [Task 8 — Item B.3: `tasks/review-logs/README.md` updates](#task-8--item-b3-tasksreview-logsreadmemd-updates)
- [Task 9 — Item B.4: `CLAUDE.md` fleet table + review pipeline](#task-9--item-b4-claudemd-fleet-table--review-pipeline)
- [Post-implementation review](#post-implementation-review)

---

## File Structure

| File | Action | Touched by |
|---|---|---|
| `CLAUDE.md` | Edit (two non-overlapping edits) | Task 1 (heuristic paragraph) + Task 9 (fleet row + invocation example + pipeline note) |
| `.claude/agents/architect.md` | Edit | Task 2 |
| `replit.md` | Edit (prepend section) | Task 3 |
| `scripts/README.md` | New file | Task 4 |
| `docs/README.md` | New file | Task 5 |
| `tools/mission-control/server/lib/logParsers.ts` | Edit | Task 6 |
| `tools/mission-control/server/__tests__/logParsers.test.ts` | Edit (add adversarial cases) | Task 6 |
| `.claude/agents/adversarial-reviewer.md` | New file | Task 7 |
| `tasks/review-logs/README.md` | Edit (filename enum + verdict table row + caller-contract subsection) | Task 8 |

No schema files, no migrations, no route/service changes, no client UI changes.

---

## Build Order & Dependencies

Order ascending by cost so the cheap edits ship first and the heuristic + architect change are live for the larger Item B build:

1. **Task 1** — Item D (heuristic, ~10 min). Independent.
2. **Task 2** — Item C (architect pre-check, ~15 min). Independent.
3. **Task 3** — Item A.1 (`replit.md`, ~20 min). Independent.
4. **Task 4** — Item A.2 (`scripts/README.md`, ~30–45 min). Independent.
5. **Task 5** — Item A.3 (`docs/README.md`, ~30–45 min). Independent.
6. **Task 6** — Item B.1 (parser + test, ~30 min). Independent.
7. **Task 7** — Item B.2 (`adversarial-reviewer.md`, ~45–60 min). Independent of Task 6 in the build sense — Task 6 is what makes the dashboard see the log later, but writing the agent does not require the parser to be in place yet.
8. **Task 8** — Item B.3 (`tasks/review-logs/README.md`, ~15 min). Depends on Task 7 (so the agent name in the contract subsection matches).
9. **Task 9** — Item B.4 (`CLAUDE.md` fleet + pipeline, ~15 min). Depends on Task 7.

All four spec items (A / B / C / D) are independent at the spec-item level. **Within Item B, however, Tasks 7 → 8 → 9 form a strict dependency chain** (the agent name registered in Tasks 8 and 9 must match the agent created in Task 7). Task 6 is independent of 7/8/9 within Item B. Do not parallelise inside Item B.

Each task ends with a commit. Use the `commit-commands:commit` skill or a plain `git commit` — do not push. The user pushes explicitly after review.

---

## Task 1 — Item D: Verifiability heuristic in CLAUDE.md

Spec source: § 6 of `docs/agentic-engineering-notes-dev-spec.md`.

**Files:**
- Modify: `CLAUDE.md` — insert one paragraph immediately after the four-bullet list under `## 4. Verification Before Done` and before the `## Verification Commands` heading.

**Insertion anchor:** the existing line `- Ask yourself: "Would a senior/staff engineer approve this?"` (currently `CLAUDE.md:48`). Insert the new paragraph as a new bottom block of `## 4`, separated by a blank line. Do NOT touch the `## Verification Commands` heading or anything below it. Do NOT touch the Task Classification table — the spec says the heuristic is orthogonal to the four-class scheme.

- [ ] **Step 1.1 — Read the anchor region**

Run: `Read CLAUDE.md` lines 42–70 to confirm the layout above is unchanged. If the bullet list has shifted, anchor on the literal `Would a senior/staff engineer approve this?"` line instead.

- [ ] **Step 1.2 — Insert the paragraph**

Use `Edit` against the literal anchor:

```
old_string:
- Ask yourself: "Would a senior/staff engineer approve this?"

new_string:
- Ask yourself: "Would a senior/staff engineer approve this?"

**Verifiability heuristic.** Before scoping work, ask: is the success condition checkable by a deterministic test or only by human judgment? Verifiable work (route returns X, row saves with the right shape, test passes) can be agent-driven aggressively. Non-verifiable work (UX polish, tone, copy, "feels right", layout taste) needs a human in the loop on every iteration — frontier models are jagged here and will not self-correct toward the goal. For non-verifiable work: do not subagent-drive it overnight; sit with it; iterate visually.
```

The paragraph wording is the spec § 6.2 wording verbatim. Do not paraphrase.

- [ ] **Step 1.3 — Verify the edit landed**

Run: `Grep -n "Verifiability heuristic" CLAUDE.md`
Expected: one hit, located between line 48 and the `## Verification Commands` heading.

Run: `Read CLAUDE.md` lines 45–62 to eyeball the surrounding shape.

- [ ] **Step 1.4 — Lint pass on the doc edit**

Run: `npm run lint` — no code changed, so this should pass without new findings. If it surfaces a markdown-related rule, fix and re-run; otherwise proceed.

- [ ] **Step 1.5 — Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude-md): add verifiability heuristic to §4 (agentic-engineering-notes Item D)"
```

---

## Task 2 — Item C: Model-collapse pre-check in architect

Spec source: § 5 of `docs/agentic-engineering-notes-dev-spec.md`.

**Files:**
- Modify: `.claude/agents/architect.md` — add a new top-level section `## Pre-plan: model-collapse check` between `## When You Are Invoked` and `## TodoWrite hygiene during execution`.

**Why this anchor:** the section must be read by the architect during context loading (it lives in the system prompt body) and applied during plan production. Placing it after `## When You Are Invoked` and before the execution-side guidance positions it as a pre-output requirement without disturbing the strict execution-order list at the top of the file.

The architect.md file already prescribes a strict 5-step execution order; this task does NOT modify that order or the minimum TodoWrite skeleton. The model-collapse check is a content requirement on the plan output: the architect must include a `Model-collapse check` heading in `plan.md` with either an adopted collapsed alternative or a one-paragraph rejection.

- [ ] **Step 2.1 — Read the anchor region**

Run: `Read .claude/agents/architect.md` lines 60–80 to confirm `## When You Are Invoked` (~line 61) and `## TodoWrite hygiene during execution` (~line 69) are still adjacent. If new sections have been inserted between them, place the new section directly after `## When You Are Invoked`'s closing paragraph.

- [ ] **Step 2.2 — Insert the new section**

Use `Edit` to anchor on the `---` separator that closes the `## When You Are Invoked` section (line 67 in the current file). The new section follows the dashes:

```
old_string:
You produce a plan the main Claude Code session will use as a build contract. Plans should be specific enough that implementation doesn't require guessing.

---

## TodoWrite hygiene during execution

new_string:
You produce a plan the main Claude Code session will use as a build contract. Plans should be specific enough that implementation doesn't require guessing.

---

## Pre-plan: model-collapse check

Before producing the implementation plan, ask:

1. Does this feature decompose into ingest → extract → transform → render?
2. Is each step doing something a frontier multimodal model could do in a single call?
3. If yes: can the whole pipeline collapse into one model call with a structured-output schema?

State the collapsed-call alternative explicitly in the plan, even if you reject it. If you reject, give the reason in one paragraph (latency, cost, determinism, audit trail, compliance, model jaggedness in this domain). Do NOT default to a multi-step pipeline because that is how it would have been built before frontier multimodal models existed.

Record the decision under a heading "Model-collapse check" in the plan output.

---

## TodoWrite hygiene during execution
```

The body is the spec § 5.2 wording verbatim, wrapped in matching `---` separators to match the surrounding section style.

- [ ] **Step 2.3 — Verify the edit landed**

Run: `Grep -n "Pre-plan: model-collapse" .claude/agents/architect.md`
Expected: one hit, between `## When You Are Invoked` and `## TodoWrite hygiene during execution`.

Run: `Read .claude/agents/architect.md` lines 60–95 to eyeball the surrounding shape and confirm the existing strict execution order at the top of the file is untouched.

- [ ] **Step 2.4 — Commit**

```bash
git add .claude/agents/architect.md
git commit -m "docs(architect): add pre-plan model-collapse check (agentic-engineering-notes Item C)"
```

---

## Task 3 — Item A.1: `replit.md` agent quick-start

Spec source: § 3.1 of `docs/agentic-engineering-notes-dev-spec.md`.

**Files:**
- Modify: `replit.md` — prepend a new `## Agent quick-start` section between the H1 (`# Automation OS`) and the existing `## Overview`. Keep all existing content; demote nothing other than its position in the file.

**Constraint:** the verification command is the spec-mandated two-tsconfig one-liner (`npx tsc --noEmit && npx tsc -p server/tsconfig.json --noEmit`). Do NOT use `npm run typecheck` — that script does not exist. Do NOT use `npx tsc --noEmit` alone — root tsconfig only covers `client/src`.

- [ ] **Step 3.1 — Read the file**

Run: `Read replit.md` (full file — 60 lines). Confirm `# Automation OS` is line 1 and `## Overview` is line 3.

- [ ] **Step 3.2 — Insert the agent quick-start section**

Use `Edit` to insert a new H2 between the H1 and the existing `## Overview`:

```
old_string:
# Automation OS

## Overview

new_string:
# Automation OS

## Agent quick-start

> Read this first if you are an automated agent. The rest of this document is human-shaped reference.

**Boot the dev environment:**

```bash
npm install && npm run dev
```

This runs the Vite client (default port 5000) and the Express server (default port 3000) via `concurrently`.

**Required environment variables:** see [`docs/env-manifest.json`](docs/env-manifest.json) for the canonical manifest. Replit auto-provides `DATABASE_URL`; the rest must be set in the Replit secrets pane (`JWT_SECRET`, `EMAIL_FROM`, `PORT`, `NODE_ENV`).

**Verify the build is healthy:**

```bash
npx tsc --noEmit && npx tsc -p server/tsconfig.json --noEmit
```

The repo has two TypeScript projects. The root `tsconfig.json` covers `client/src/`; `server/tsconfig.json` covers `server/` and `shared/`. The one-liner above exercises both. There is no `npm run typecheck` script.

**Where to look next:**

- [`architecture.md`](architecture.md) — backend conventions, route patterns, three-tier agent model, skill system, all repo-specific patterns.
- [`scripts/README.md`](scripts/README.md) — index of executable tooling (DB, audits, imports, code-graph).
- [`docs/README.md`](docs/README.md) — spec-corpus index ("if you're working on X, read Y").
- [`CLAUDE.md`](CLAUDE.md) — Claude Code playbook applied to this repo (planning, review pipeline, agent fleet).

## Overview
```

The fenced bash blocks inside the inserted section use the same triple-backtick fences as the surrounding document. When pasting the `Edit` payload, escape the inner fences as required by your tooling — the raw file content must read identically to what is shown above.

- [ ] **Step 3.3 — Verify the edit**

Run: `Grep -n "Agent quick-start" replit.md`
Expected: one hit at line 3 (between the H1 and `## Overview`).

Run: `Grep -n "npx tsc --noEmit && npx tsc -p server/tsconfig.json --noEmit" replit.md`
Expected: one hit inside the new section.

Run: `Read replit.md` lines 1–40 to eyeball the layout.

- [ ] **Step 3.4 — Commit**

```bash
git add replit.md
git commit -m "docs(replit): add agent quick-start section (agentic-engineering-notes Item A.1)"
```

---

## Task 4 — Item A.2: `scripts/README.md`

Spec source: § 3.1 of `docs/agentic-engineering-notes-dev-spec.md` (the `scripts/README.md` paragraph).

**Files:**
- Create: `scripts/README.md`.

**Constraint:** This is an *index*, not a tutorial. One-screen layout, intent → script. Internal/test scripts (prefixed `_`) are listed separately and marked "do not run unless instructed." Audit scripts (`scripts/run-all-*.sh`, `scripts/verify-*.sh`, `scripts/gates/*.sh`) carry the CI-only caveat from `CLAUDE.md` § *Test gates are CI-only*.

The agent should rebuild the index from a fresh listing rather than copy the snapshot below — `scripts/` evolves. The categories and CI-only caveat are mandatory; the exact script names below are illustrative anchors as of branch `claude/agentic-engineering-notes-WL2of`.

- [ ] **Step 4.1 — Take a fresh inventory of `scripts/`**

Run: `Glob scripts/*.{sh,ts,js}` to list everything currently in `scripts/`. Cross-check against the snapshot below; if the listing has diverged, prefer the listing.

Snapshot reference (truncated; see `Glob` output for the full list):

- Database / data: `migrate.ts`, `seed.ts`, `prune-security-events.ts`, `seedConfigAgentGuidelines.ts`, `seedOnboardingModules.ts`, `seed-workspace-actors.ts`, `backfill-system-skills.ts`, `apply-skill-visibility.ts`, `regenerate-company-manifest.ts`.
- Reseed (internal, prefixed `_`): `_reseed_drop_create.ts`, `_reseed_backup_users.ts`, `_reseed_restore_users.ts`, `_reseed_inspect_users.ts`, `_reseed_verify.ts`, `_reseed_healthcheck.ts`.
- Code intelligence: `build-code-graph.ts`, `code-graph-health-check.ts`.
- Imports / exports: `import-company.ts`, `import-system-agents.ts`, `export-system-agents.ts`.
- System verification scripts (CI-only — see caveat below): `verify-*.sh`, `verify-*.ts` family — large set covering RLS, soft-delete, permission scope, async-handler usage, idempotency, etc.
- Audit umbrellas (CI-only): `run-all-gates.sh`, `run-all-qa-tests.sh`, `update-guard-baselines.sh`.
- Smoke tests (single-file, runnable locally with `npx tsx`): `smoke-test-agent-embeddings.ts`, `smoke-test-agent-proposal-patch.ts`, `smoke-test-analyzer-pipeline.ts`, `smoke-test-execute-approved.ts`, `smoke-test-getjob-shape.ts`, `smoke-test-merge-endpoints.ts`.
- Internal / test-only (prefixed `_`): `_test-slack.ts`, plus the `_reseed_*` family above.
- Misc: `convert-skills-to-new-format.ts`, `codemod-riley-rename.ts`, `rebase-post-riley-rename.sh`, `chatgpt-review.ts`, `validate-playbooks.ts`, `audit-subaccount-roots.ts`, `auditSubaccountRootsPure.ts`.

- [ ] **Step 4.2 — Write the index**

Use `Write` to create the file with the structure below. Keep it dense (agent-facing per `CLAUDE.md` §13). Content:

```markdown
# scripts/ — index

One-screen map from intent to script. For runtime/build conventions see [`../architecture.md`](../architecture.md); for the playbook see [`../CLAUDE.md`](../CLAUDE.md).

## Database & data

| Intent | Script | Run |
|---|---|---|
| Apply pending Drizzle migrations | `migrate.ts` | `npx tsx scripts/migrate.ts` |
| Seed baseline fixtures | `seed.ts` | `npx tsx scripts/seed.ts` |
| Seed config-agent guidelines | `seedConfigAgentGuidelines.ts` | `npx tsx scripts/seedConfigAgentGuidelines.ts` |
| Seed onboarding modules | `seedOnboardingModules.ts` | `npx tsx scripts/seedOnboardingModules.ts` |
| Seed workspace actors | `seed-workspace-actors.ts` | `npx tsx scripts/seed-workspace-actors.ts` |
| Backfill system skills | `backfill-system-skills.ts` | `npx tsx scripts/backfill-system-skills.ts` |
| Apply skill visibility rules | `apply-skill-visibility.ts` | `npx tsx scripts/apply-skill-visibility.ts` |
| Prune old security events | `prune-security-events.ts` | `npx tsx scripts/prune-security-events.ts` |
| Regenerate the company manifest | `regenerate-company-manifest.ts` | `npx tsx scripts/regenerate-company-manifest.ts` |

## Code intelligence

| Intent | Script | Run |
|---|---|---|
| Rebuild the code-graph cache (`references/project-map.md`, `references/import-graph/`) | `build-code-graph.ts` | `npm run code-graph:rebuild` (preferred) or `npx tsx scripts/build-code-graph.ts` |
| Sanity-check the cache | `code-graph-health-check.ts` | `npx tsx scripts/code-graph-health-check.ts` |

## Imports & exports

| Intent | Script | Run |
|---|---|---|
| Import a company | `import-company.ts` | `npx tsx scripts/import-company.ts <args>` |
| Import system agents | `import-system-agents.ts` | `npx tsx scripts/import-system-agents.ts <args>` |
| Export system agents | `export-system-agents.ts` | `npx tsx scripts/export-system-agents.ts <args>` |

## Smoke tests (single-file, agent-runnable)

Run any of these directly with `npx tsx scripts/<name>.ts` to exercise a single subsystem end-to-end:

- `smoke-test-agent-embeddings.ts`
- `smoke-test-agent-proposal-patch.ts`
- `smoke-test-analyzer-pipeline.ts`
- `smoke-test-execute-approved.ts`
- `smoke-test-getjob-shape.ts`
- `smoke-test-merge-endpoints.ts`

These are local-runnable. They are NOT the system verification suite.

## Audits & system verification — CI ONLY

> **Do not run locally.** `CLAUDE.md` § *Test gates are CI-only — never run locally* forbids running these in any local agent or development session. CI runs the complete suite as a pre-merge gate.

- `run-all-gates.sh` — full gate run.
- `run-all-qa-tests.sh` — full QA-test run.
- `update-guard-baselines.sh` — refreshes guard baselines.
- `verify-*.sh` and `verify-*.ts` — individual verification scripts (RLS, soft-delete, permission scope, idempotency, async-handler, org-scoped writes, etc.). Each one is a slow whole-repo scanner.

If a verifier flags an issue in CI, fix the root cause; do not re-run the verifier locally to confirm.

## Internal / test-only — do not run unless instructed

Prefixed `_` to mark as internal. These exist for narrow operator workflows and tooling — running them blindly may mutate dev DB state or produce noise.

- `_test-slack.ts` — Slack integration smoke test (sends real messages).
- `_reseed_drop_create.ts`, `_reseed_backup_users.ts`, `_reseed_restore_users.ts`, `_reseed_inspect_users.ts`, `_reseed_verify.ts`, `_reseed_healthcheck.ts` — destructive / inspection scripts in the reseed family.

## Miscellaneous

| Script | Purpose |
|---|---|
| `convert-skills-to-new-format.ts` | One-shot skill format migration. |
| `codemod-riley-rename.ts` | Codemod from a previous rename pass. |
| `rebase-post-riley-rename.sh` | Companion rebase helper. |
| `chatgpt-review.ts` / `chatgpt-reviewPure.ts` | ChatGPT review tooling glue. |
| `validate-playbooks.ts` | Validates playbook YAML/JSON. |
| `audit-subaccount-roots.ts` / `auditSubaccountRootsPure.ts` | Subaccount root audit. |
| `update-guard-baselines.sh` | Refreshes guard baselines (CI-only context). |
```

If the inventory in Step 4.1 surfaced scripts not in this template, slot them under the closest existing category and add new categories only when no existing one fits. Do not author "how to extend" recipes — those are deferred per spec § 9.

- [ ] **Step 4.3 — Verify the file**

Run: `Read scripts/README.md` and confirm:
- The CI-only caveat for `verify-*.sh` / `run-all-*.sh` is present and matches the wording in `CLAUDE.md` § *Test gates are CI-only*.
- All scripts in the snapshot (or the Step 4.1 listing if it diverged) appear in exactly one category.
- Internal `_*` scripts are in the "do not run unless instructed" subsection only.

Run: `Grep -n "do not run unless instructed" scripts/README.md`
Expected: at least one hit, scoping the `_` prefixed scripts.

Run: `Glob scripts/*.{sh,ts,js}` and count the entries. Count the script rows in the README (all categories combined, including internal and misc). Expect no major category is obviously absent — a rough completeness check, not an exact audit. If the counts diverge by more than a few, identify and slot the missing scripts before committing.

- [ ] **Step 4.4 — Commit**

```bash
git add scripts/README.md
git commit -m "docs(scripts): add intent->script index (agentic-engineering-notes Item A.2)"
```

---

## Task 5 — Item A.3: `docs/README.md` spec-corpus index

Spec source: § 3.1 of `docs/agentic-engineering-notes-dev-spec.md` (the `docs/README.md` paragraph).

**Files:**
- Create: `docs/README.md`.

**Constraint:** "If you're working on X, read Y." Group by domain. Point at the canonical spec for each area, not all variants. Do NOT rewrite individual specs (out of scope per § 3.3). Do NOT include the four sub-items A/B/C/D specs themselves — meta. Items in `docs/superpowers/specs/` are recent (Apr 2026) and are the canonical specs for newer surfaces; older `docs/*-spec.md` files often have a newer counterpart.

The agent should rebuild the index from a fresh `Glob` listing — `docs/` evolves. The categories and "canonical only" rule are mandatory; the exact files below are anchors as of branch `claude/agentic-engineering-notes-WL2of`.

- [ ] **Step 5.1 — Take a fresh inventory of `docs/`**

Run: `Glob docs/*.md` and `Glob docs/superpowers/specs/*.md` to list every spec/brief currently in the corpus.

For each domain, decide the canonical spec by these rules:
1. If a `superpowers/specs/<date>-<slug>-spec.md` exists, prefer it (most recent and gate-checked).
2. Otherwise, prefer `<area>-dev-spec.md` over `<area>-spec.md` over `<area>-brief.md`.
3. If multiple "v" suffixes exist (e.g. `hitl-platform-dev-brief-v3.md`), prefer the highest version.

If multiple candidates remain after applying rules 1–3 and ambiguity persists, prefer the most recent file by date prefix (filename `YYYY-MM-DD-*.md` first; otherwise `git log -1 --format=%ad <path>` mtime). Only if you still cannot decide should you leave the domain out and add a `tasks/todo.md` entry (per § 9: "Per-domain 'how to extend' agent-shaped recipes" — same backlog).

- [ ] **Step 5.2 — Write the index**

Use `Write` to create the file with the structure below. Keep entries to one line each — domain name, one-sentence purpose, link to canonical spec.

```markdown
# docs/ — spec-corpus index

If you're working on X, read Y. One canonical spec per domain — variants and historical drafts are not listed here.

For repo conventions and patterns, read [`../architecture.md`](../architecture.md) first; this index is the spec layer that sits on top of it. The Claude Code playbook lives in [`../CLAUDE.md`](../CLAUDE.md).

## Capabilities & non-goals

- [`capabilities.md`](capabilities.md) — full catalogue of product capabilities, agency capabilities, skills, integrations. Update in the same commit as feature work.

## Spec authoring & framing

- [`spec-context.md`](spec-context.md) — framing assumptions (pre-production, rapid evolution, primitive preferences) used by `spec-reviewer` and `architect`.
- [`spec-authoring-checklist.md`](spec-authoring-checklist.md) — pre-authoring checklist for Significant/Major specs.
- [`codebase-audit-framework.md`](codebase-audit-framework.md) — framework `audit-runner` follows for Hotspot/Targeted/Full audits.

## Agent fleet & orchestration

- [`automation-os-system-agents-master-brief-v7.1.md`](automation-os-system-agents-master-brief-v7.1.md) — system-agent master brief (canonical for system agents).
- [`agent-intelligence-dev-spec.md`](agent-intelligence-dev-spec.md) — agent intelligence layer (skills, capabilities, routing).
- [`hierarchical-delegation-dev-spec.md`](hierarchical-delegation-dev-spec.md) — hierarchical delegation between agents.
- [`iee-development-spec.md`](iee-development-spec.md) — Independent Execution Engine (IEE).
- [`iee-delegation-lifecycle-spec.md`](iee-delegation-lifecycle-spec.md) — IEE delegation lifecycle and handoffs.
- [`orchestrator-capability-routing-spec.md`](orchestrator-capability-routing-spec.md) — capability-routing orchestrator.
- [`agent-coworker-features-spec.md`](agent-coworker-features-spec.md) — agent-coworker user-facing features.
- [`superpowers/specs/2026-04-29-agents-as-employees-spec.md`](superpowers/specs/2026-04-29-agents-as-employees-spec.md) — agents-as-employees model.
- [`agent-as-employee-runbook.md`](agent-as-employee-runbook.md) — operational runbook for the above.

## HITL (human-in-the-loop)

- [`hitl-platform-dev-brief-v3.md`](hitl-platform-dev-brief-v3.md) — canonical HITL platform brief.
- [`agent-orchestration-hitl-reference.md`](agent-orchestration-hitl-reference.md) — HITL reference patterns.

## Skills

- [`skill-analyzer-v2-spec.md`](skill-analyzer-v2-spec.md) — skill analyzer v2.
- [`skill-gap-analysis-v2.md`](skill-gap-analysis-v2.md) — skill gap analysis methodology.

## Canonical data platform

- [`canonical-data-platform-roadmap.md`](canonical-data-platform-roadmap.md) — roadmap.
- [`canonical-data-platform-p1-p2-p3-impl.md`](canonical-data-platform-p1-p2-p3-impl.md) — phased implementation.

## ClientPulse

- [`clientpulse-dev-spec.md`](clientpulse-dev-spec.md) — ClientPulse development spec.
- [`clientpulse-soft-launch-blockers-brief.md`](clientpulse-soft-launch-blockers-brief.md) — soft-launch blockers.
- [`superpowers/specs/2026-04-24-clientpulse-ui-simplification-spec.md`](superpowers/specs/2026-04-24-clientpulse-ui-simplification-spec.md) — UI simplification.

## GEO / SEO

- [`geo-seo-spec.md`](geo-seo-spec.md) — GEO/SEO surface.

## Onboarding & configuration

- [`onboarding-playbooks-spec.md`](onboarding-playbooks-spec.md) — onboarding playbooks.
- [`configuration-assistant-spec.md`](configuration-assistant-spec.md) — configuration assistant.
- [`config-agent-guidelines-spec.md`](config-agent-guidelines-spec.md) — config-agent guidelines.

## Briefs, memory, context

- [`universal-brief-dev-spec.md`](universal-brief-dev-spec.md) — universal brief surface.
- [`brief-result-contract.md`](brief-result-contract.md) — brief result contract.
- [`memory-and-briefings-spec.md`](memory-and-briefings-spec.md) — memory & briefings.
- [`cached-context-infrastructure-spec.md`](cached-context-infrastructure-spec.md) — cached-context infrastructure.
- [`cascading-context-data-sources-spec.md`](cascading-context-data-sources-spec.md) — cascading context.

## Routines & reporting

- [`routines-response-dev-spec.md`](routines-response-dev-spec.md) — routines response surface.
- [`reporting-agent-paywall-workflow-spec.md`](reporting-agent-paywall-workflow-spec.md) — reporting-agent paywall workflow.
- [`run-continuity-and-workspace-health-spec.md`](run-continuity-and-workspace-health-spec.md) — run continuity & workspace health.

## Scraping & beliefs

- [`robust-scraping-engine-spec.md`](robust-scraping-engine-spec.md) — scraping engine.
- [`beliefs-spec.md`](beliefs-spec.md) — beliefs system.

## MCP & integrations

- [`mcp-tool-invocations-spec.md`](mcp-tool-invocations-spec.md) — MCP tool invocations.
- [`integration-reference.md`](integration-reference.md) — integration reference.
- [`execution-contracts.md`](execution-contracts.md) — execution contracts.

## Tenancy & permissions

- [`org-subaccount-refactor-spec.md`](org-subaccount-refactor-spec.md) — organisation/subaccount refactor.
- [`subaccount-skills-and-history-spec.md`](subaccount-skills-and-history-spec.md) — subaccount skills + history.
- [`superpowers/specs/2026-04-29-pre-prod-tenancy-spec.md`](superpowers/specs/2026-04-29-pre-prod-tenancy-spec.md) — pre-prod tenancy hardening.
- [`superpowers/specs/2026-04-29-pre-prod-boundary-and-brief-api-spec.md`](superpowers/specs/2026-04-29-pre-prod-boundary-and-brief-api-spec.md) — pre-prod boundary + brief API.

## Pre-launch hardening & dev tooling

- [`pre-launch-hardening-spec.md`](pre-launch-hardening-spec.md) — pre-launch hardening.
- [`soft-delete-filter-gaps-spec.md`](soft-delete-filter-gaps-spec.md) — soft-delete filter audit.
- [`superpowers/specs/2026-04-25-codebase-audit-remediation-spec.md`](superpowers/specs/2026-04-25-codebase-audit-remediation-spec.md) — audit remediation.
- [`superpowers/specs/2026-04-28-dev-mission-control-spec.md`](superpowers/specs/2026-04-28-dev-mission-control-spec.md) — Mission Control dashboard.

## Testing

- [`testing-conventions.md`](testing-conventions.md) — test conventions.
- [`test-migration-spec.md`](test-migration-spec.md) — test migration spec.
- [`test-fixtures-inventory.md`](test-fixtures-inventory.md) — test fixtures inventory.
- [`ci-readiness-report.md`](ci-readiness-report.md) — CI readiness report.

## Frontend design

- [`frontend-design-principles.md`](frontend-design-principles.md) — frontend design principles (read before any UI mockup).

## Playbooks & decision steps

- [`playbook-agent-decision-step-spec.md`](playbook-agent-decision-step-spec.md) — agent decision step.
- [`improvements-roadmap-spec.md`](improvements-roadmap-spec.md) — improvements roadmap.
- [`riley-observations-dev-spec.md`](riley-observations-dev-spec.md) — Riley observations.

## What's NOT here

- Historical drafts and superseded versions of the above (the canonical link is the latest).
- Per-domain "how to extend" recipes (deferred per `agentic-engineering-notes-dev-spec.md` § 9).
- Implementation notes that live as comments in the code or as commit messages.
```

The file is human-readable but loaded by agents on demand — keep one-line entries dense; do not editorialise.

- [ ] **Step 5.3 — Verify the file**

Run: `Read docs/README.md` and confirm:
- Every domain heading has at least one canonical spec link.
- No file appears under more than one domain.
- The "What's NOT here" section is present.

Run: `Grep -n "What's NOT here" docs/README.md`
Expected: one hit at the bottom.

- [ ] **Step 5.4 — Commit**

```bash
git add docs/README.md
git commit -m "docs(spec-corpus): add docs/README.md index (agentic-engineering-notes Item A.3)"
```

---

## Task 6 — Item B.1: Mission Control parser extension (TDD)

Spec source: § 4.3 of `docs/agentic-engineering-notes-dev-spec.md` — the `tools/mission-control/server/lib/logParsers.ts` row.

**Files:**
- Test: `tools/mission-control/server/__tests__/logParsers.test.ts` (extend, do not replace existing tests).
- Modify: `tools/mission-control/server/lib/logParsers.ts`.

**Why first in Item B:** lets us TDD the smallest functional change (parser regex) before authoring any agent prose. The verdict-line regex (`VERDICT_LINE`) is already prefix-agnostic, so no parser change is needed there — the spec confirms this.

**Constraint:** Add `'adversarial-review'` to the `ReviewKind` union AND to the `FILENAME_REGEX_STD` alternation. Do NOT add a new regex constant — the standard regex already handles the `<agent>-log-<slug>-<timestamp>.md` shape, so extending the alternation is the minimal change. Do NOT touch `FILENAME_REGEX_FINAL` or `FILENAME_REGEX_CHATGPT`.

- [ ] **Step 6.1 — Write the failing test**

**Parser contract reminder:** the parser normalises filename timestamps from the path-safe form `YYYY-MM-DDTHH-MM-SSZ` (used in filenames because `:` is invalid on Windows) to ISO 8601 `YYYY-MM-DDTHH:MM:SSZ` (returned in `timestampIso`). The test below asserts the exact ISO output to lock that normalisation in; if the parser ever drops the transform, the test fails. Existing test cases for other agent kinds already exercise this — the new cases follow the same pattern.

Use `Edit` against `tools/mission-control/server/__tests__/logParsers.test.ts`. Anchor on the existing `parseReviewLogFilename returns null for non-conforming names` block (around line 78–82) and insert two new test cases immediately above it so the new cases stay in the same test group:

```
old_string:
test('parseReviewLogFilename returns null for non-conforming names', () => {

new_string:
test('parseReviewLogFilename parses adversarial-review log', () => {
  const m = parseReviewLogFilename('adversarial-review-log-feature-foo-2026-04-30T08-00-00Z.md');
  assert(m !== null, 'not null');
  eq(m!.kind, 'adversarial-review', 'kind');
  eq(m!.slug, 'feature-foo', 'slug');
  eq(m!.timestampIso, '2026-04-30T08:00:00Z', 'iso');
});

test('parseReviewLogFilename parses adversarial-review log with hyphenated slug', () => {
  const m = parseReviewLogFilename(
    'adversarial-review-log-agentic-engineering-notes-2026-04-30T09-15-22Z.md',
  );
  assert(m !== null, 'not null');
  eq(m!.kind, 'adversarial-review', 'kind');
  eq(m!.slug, 'agentic-engineering-notes', 'slug');
});

test('parseReviewLogFilename returns null for non-conforming names', () => {
```

- [ ] **Step 6.2 — Run the test to confirm it fails**

Run: `npx tsx tools/mission-control/server/__tests__/logParsers.test.ts`
Expected: the two new `adversarial-review` tests FAIL (the regex does not yet match `adversarial-review`); all other tests still PASS.

If a different test fails unexpectedly, STOP — the test file diverged from the snapshot. Read the file and reconcile before continuing.

- [ ] **Step 6.3 — Update `ReviewKind`**

Use `Edit` against `tools/mission-control/server/lib/logParsers.ts`:

```
old_string:
export type ReviewKind =
  | 'pr-review'
  | 'spec-conformance'
  | 'dual-review'
  | 'spec-review'
  | 'spec-review-final'
  | 'codebase-audit'
  | 'chatgpt-pr-review'
  | 'chatgpt-spec-review';

new_string:
export type ReviewKind =
  | 'pr-review'
  | 'spec-conformance'
  | 'dual-review'
  | 'spec-review'
  | 'spec-review-final'
  | 'codebase-audit'
  | 'adversarial-review'
  | 'chatgpt-pr-review'
  | 'chatgpt-spec-review';
```

The new member is inserted between `codebase-audit` and `chatgpt-pr-review` to keep self-written-log kinds grouped before the chatgpt kinds.

- [ ] **Step 6.4 — Extend `FILENAME_REGEX_STD`**

Use `Edit`:

```
old_string:
const FILENAME_REGEX_STD = new RegExp(
  `^(pr-review|spec-conformance|dual-review|spec-review|codebase-audit)-log-${SLUG_RE}-${TS_RE}\\.md$`,
);

new_string:
const FILENAME_REGEX_STD = new RegExp(
  `^(pr-review|spec-conformance|dual-review|spec-review|codebase-audit|adversarial-review)-log-${SLUG_RE}-${TS_RE}\\.md$`,
);
```

**Slug invariant:** `SLUG_RE` uses a non-greedy match, but slug values whose trailing segments look timestamp-shaped can still create ambiguous parse boundaries. Document this invariant: **slugs must not end with a segment matching `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`** — i.e. nothing that the timestamp regex could plausibly start consuming. Examples to avoid: `feature-2026`, `cleanup-2026-04`, `migration-2026-04-30`. If this is ever violated in practice, tighten `SLUG_RE` to an explicit non-greedy `.+?` at that time. No regex change is needed now.

- [ ] **Step 6.5 — Update the explanatory comment above the regexes**

The current comment at lines 55–59 enumerates which agents the standard regex covers. Update it so future readers see `adversarial-review` is part of the standard family.

```
old_string:
//   <agent>-log-<slug>-<timestamp>.md         (README convention — pr-review, spec-conformance, dual-review, spec-review, codebase-audit)

new_string:
//   <agent>-log-<slug>-<timestamp>.md         (README convention — pr-review, spec-conformance, dual-review, spec-review, codebase-audit, adversarial-review)
```

- [ ] **Step 6.6 — Re-run the test to confirm it passes**

Run: `npx tsx tools/mission-control/server/__tests__/logParsers.test.ts`
Expected: all tests PASS, including the two new `adversarial-review` cases. The console output ends with `<N> passed, 0 failed` where `<N>` is two greater than before.

- [ ] **Step 6.7 — Typecheck both projects**

Run: `npx tsc --noEmit && npx tsc -p server/tsconfig.json --noEmit`

The `tools/mission-control/` directory is covered by the root `tsconfig.json` via its `include` glob; if the typecheck does not pick up the change, add it as a finding to `tasks/todo.md` rather than expanding scope.

Expected: both invocations exit 0 with no new errors.

- [ ] **Step 6.8 — Lint**

Run: `npm run lint`
Expected: pass with no new findings.

- [ ] **Step 6.9 — Commit**

```bash
git add tools/mission-control/server/lib/logParsers.ts tools/mission-control/server/__tests__/logParsers.test.ts
git commit -m "feat(mission-control): recognise adversarial-review log filenames (agentic-engineering-notes Item B.1)"
```

---

## Task 7 — Item B.2: `adversarial-reviewer` agent definition

Spec source: § 4.1 + § 4.2 of `docs/agentic-engineering-notes-dev-spec.md`.

**Files:**
- Create: `.claude/agents/adversarial-reviewer.md`.

**Pattern:** mirror `pr-reviewer.md` exactly for the read-only / fenced-block / caller-persists shape. The spec specifies read-only tools (Read, Glob, Grep) and a written log file, but does not specify a persistence mechanism — the only existing precedent for a read-only agent that produces a persisted log is `pr-reviewer`, which emits a fenced block tagged `pr-review-log` and the caller persists it. Adversarial-reviewer follows the same contract with a `adversarial-review-log` tag.

**Constraint — model:** spec § 9 open question lists Sonnet as default; use `model: sonnet`. Future tuning may escalate to Opus per the open question — that is out of scope for this build.

**Constraint — verdict line:** spec § 4.2 mandates `**Verdict:** <ENUM>` where `<ENUM>` ∈ `{NO_HOLES_FOUND, HOLES_FOUND, NEEDS_DISCUSSION}`. The verdict line MUST appear within the first 30 lines of the persisted log (per `tasks/review-logs/README.md` Verdict header convention).

- [ ] **Step 7.1 — Read the pattern reference**

Run: `Read .claude/agents/pr-reviewer.md` (full file). The new file's frontmatter, "Context Loading" structure, "Final output envelope" wording, and "Verdict line format" wording are the templates.

- [ ] **Step 7.2 — Write the agent file**

Use `Write` to create `.claude/agents/adversarial-reviewer.md` with the content below. The file is the new agent's complete system prompt.

````markdown
---
name: adversarial-reviewer
description: Adversarial / threat-model review — read-only. Hunts tenant-isolation, auth, race-condition, injection, resource-abuse, and cross-tenant data-leakage holes after `pr-reviewer` runs. Manually invoked only — the user must explicitly ask. Phase 1 advisory; non-blocking.
tools: Read, Glob, Grep
model: sonnet
---

You are an adversarial security reviewer for Automation OS — an AI agent orchestration platform. Your job is to assume the role of an attacker with read access to the diff and probe for holes. You are NOT a generalist code reviewer; `pr-reviewer` already covers convention violations and correctness. Your scope is the threat-model checklist below.

## Trigger

Manually invoked only — the user must explicitly ask, matching the `dual-reviewer` posture. Auto-invocation from `feature-coordinator` is deferred. The intended auto-trigger surface, once auto-invocation lands, is any change under `server/db/schema/`, `server/routes/`, `server/services/auth*`, `server/middleware/`, or RLS-related migrations.

## Failure-mode posture

Phase 1 is advisory. Findings do NOT block PRs unless the user explicitly escalates a specific finding. This avoids accidental coupling to CI before the agent's signal-to-noise ratio is established.

## Input

The branch diff. Use the same auto-detection logic as `spec-conformance`: committed + staged + unstaged + untracked. Sample git state once at invocation start; do not re-poll during the review pass.

## Context Loading

Before reviewing, read in order:
1. `CLAUDE.md` — project principles and conventions.
2. `architecture.md` — three-tier agent model, RLS, route conventions, permission system.
3. `DEVELOPMENT_GUIDELINES.md` — read when changes touch `migrations/`, `server/db/schema/`, `server/services/`, `server/routes/`, `server/lib/`, RLS policies, or LLM-routing code. Skip when changes are pure frontend or pure docs.
4. The specific files changed (auto-detected from git state).

## Threat model checklist

Run all six categories against every diff. Each category may produce zero or more findings.

1. **RLS / tenant isolation.** Every new query routed through a tenant-scoped client; no service-role escape; RLS policies cover the new table; no `req.user.organisationId` reads (must be `req.orgId`); no missing soft-delete filter on tables with `deletedAt`.
2. **Auth & permissions.** Every new route gated by the right permission group; permission check uses session identity, not request body; `resolveSubaccount` called on routes with `:subaccountId`; webhook handlers verify HMAC where applicable.
3. **Race conditions.** Read-modify-write wrapped in a transaction; idempotency keys honored; queue jobs safe under retry; agent-run creation paths support deduplication.
4. **Injection.** No raw SQL string concat; prompt-injection surfaces in agent context flagged; path traversal in file ops; SSRF in outbound calls; user-controlled regex inputs.
5. **Resource abuse.** Per-tenant rate limit / quota; recursive agent invocation guard (MAX_HANDOFF_DEPTH); unbounded queue payload; unbounded LLM context expansion.
6. **Cross-tenant data leakage.** Shared caches keyed by tenant; logs and error messages do not leak other-tenant identifiers; analytics/metrics aggregations scoped correctly.

Add new categories as findings accumulate — do not be limited to the seed list above when a class of attack obviously applies (e.g. supply-chain in package.json, secrets in env-manifest).

## Finding labels

Each finding labelled exactly one of:

- `confirmed-hole` — the diff clearly introduces or preserves an exploitable gap. File:line, attack scenario, suggested fix.
- `likely-hole` — the diff almost certainly has a hole but the agent could not 100% verify (e.g. depends on a function whose body is not in the diff). File:line, attack scenario, what would confirm.
- `worth-confirming` — suspicious pattern, but the attack scenario is speculative. File:line, what raised the flag.

## Final output envelope

Wrap your complete review in a single fenced markdown block tagged `adversarial-review-log` and emit it as the LAST content in your response. The block contains: a header with the files reviewed and an ISO 8601 UTC timestamp, the threat-model checklist with findings (or "no findings") under each category, and a one-line Verdict.

The caller is instructed to extract the block verbatim and write it to `tasks/review-logs/adversarial-review-log-<slug>-<timestamp>.md` BEFORE the user acts on any finding — same persistence pattern as `pr-reviewer`.

### Verdict line format (mandatory)

The Verdict line MUST appear within the first 30 lines of the persisted log and MUST match:

```
**Verdict:** NO_HOLES_FOUND
```

or

```
**Verdict:** HOLES_FOUND
```

or

```
**Verdict:** NEEDS_DISCUSSION
```

Trailing prose is allowed after the enum value (e.g. `**Verdict:** HOLES_FOUND (1 confirmed-hole, 2 likely-holes)`). The Mission Control dashboard parses this line per `tasks/review-logs/README.md § Verdict header convention`. Do not deviate from the enum.

**Verdict semantics:**

- `NO_HOLES_FOUND` — ran the full threat-model checklist; surfaced no `confirmed-hole` or `likely-hole` findings. `worth-confirming`-only findings appear in the log but do not set `HOLES_FOUND` — the verdict stays `NO_HOLES_FOUND`.
- `HOLES_FOUND` — at least one finding labelled `confirmed-hole` or `likely-hole`. `worth-confirming`-only results use `NO_HOLES_FOUND`.
- `NEEDS_DISCUSSION` — the diff is ambiguous enough that you cannot classify it as either of the above without user input (e.g. unclear ownership of a new tenant boundary, missing context on an auth flow). Reserved for genuine uncertainty; not a soft `HOLES_FOUND`.

After the user reviews the log, `confirmed-hole` findings route to `tasks/todo.md` for the main session to fix. The agent does not write that backlog — the caller does.

## Non-goals

- Does not fix anything. Does not run code. Does not create a runtime fuzzing harness — that is deferred.
- Does not duplicate `pr-reviewer`'s convention/correctness checks. If a finding is purely "this violates the convention in `architecture.md`", redirect to `pr-reviewer`.
- Does not run any verification scripts, tests, or commands. Read-only by design.

## Rules

- Zero findings means say so explicitly — "No holes found across all six checklist categories."
- Do not speculate without an attack scenario. A `confirmed-hole` or `likely-hole` finding without a concrete attack scenario is a defect — drop it to `worth-confirming` or remove it.
- Reference exact file:line for every finding. Vague references ("somewhere in services/auth") are not actionable.
- Do not repeat the same finding across multiple categories. If a hole spans (e.g.) RLS and cross-tenant data leakage, list it once under the most direct category and cross-reference the other.
- **Cap findings at the top 10 by confidence/severity.** If more than 10 findings surface, list the top 10 in detail (with attack scenario + file:line) and summarise the remainder under a single `## Additional observations` heading — one line each, no expansion. This keeps the log scannable; if the agent is producing 20+ findings the diff is more likely structurally unsafe than the agent has 20 distinct issues to report.
- You have read-only tools. You review, you do not fix. Return findings; let the main session triage and implement.
- **Test gates are CI-only — never recommend running them locally.** Same rule as `pr-reviewer`. CI runs the verifiers; do not ask the implementer to run them.
````

The file is dense and long; that is intentional. Agent prompts are tokens-priced once on every invocation, and threat-model coverage is the agent's reason to exist.

- [ ] **Step 7.3 — Verify the file**

Run: `Read .claude/agents/adversarial-reviewer.md` and confirm:
- YAML frontmatter has `name: adversarial-reviewer`, `tools: Read, Glob, Grep`, `model: sonnet`.
- The Trigger section says "Manually invoked only".
- The Output envelope tags the fenced block as `adversarial-review-log` (matches Task 8 filename convention).
- The Verdict-line section enumerates exactly `NO_HOLES_FOUND`, `HOLES_FOUND`, `NEEDS_DISCUSSION`.
- The threat-model checklist has all six categories.

Run: `Grep -n "adversarial-review-log" .claude/agents/adversarial-reviewer.md`
Expected: at least one hit referencing the persisted-log filename pattern.

- [ ] **Step 7.4 — Commit**

```bash
git add .claude/agents/adversarial-reviewer.md
git commit -m "feat(agents): add adversarial-reviewer agent (agentic-engineering-notes Item B.2)"
```

---

## Task 8 — Item B.3: `tasks/review-logs/README.md` updates

Spec source: § 4.3 of `docs/agentic-engineering-notes-dev-spec.md` — the `tasks/review-logs/README.md` row.

**Files:**
- Modify: `tasks/review-logs/README.md` — three edits: filename-convention agent enumeration, per-agent Verdict enum table row, new caller-contract subsection.

**Constraint:** the agent name in the caller-contract subsection MUST match the `name` field in the agent file from Task 7 (`adversarial-reviewer`). Do this task AFTER Task 7 so a quick `Grep` confirms the name is consistent.

- [ ] **Step 8.1 — Read the file**

Run: `Read tasks/review-logs/README.md` (full file). Confirm the three anchor regions still match the snapshot:
- Filename convention agent enumeration at line 17 (the `<agent>` bullet).
- Per-agent verdict enum table around lines 45–55.
- Caller-contract subsections around lines 65–104.

- [ ] **Step 8.2 — Extend the filename-convention enumeration**

Use `Edit`:

```
old_string:
- **`<agent>`** — fixed per agent: `pr-review`, `spec-conformance`, `dual-review`, `spec-review`, `codebase-audit`, `chatgpt-pr-review`, `chatgpt-spec-review`.

new_string:
- **`<agent>`** — fixed per agent: `pr-review`, `spec-conformance`, `dual-review`, `spec-review`, `codebase-audit`, `adversarial-review`, `chatgpt-pr-review`, `chatgpt-spec-review`.
```

- [ ] **Step 8.3 — Add the per-agent verdict-enum row**

The current table ends with the two `chatgpt-*` rows. Insert the `adversarial-reviewer` row immediately after the `audit-runner` row so self-written-log agents stay grouped.

```
old_string:
| `audit-runner` | `PASS` \| `PASS_WITH_DEFERRED` \| `FAIL` |
| `chatgpt-pr-review` | `APPROVED` \| `CHANGES_REQUESTED` \| `NEEDS_DISCUSSION` |

new_string:
| `audit-runner` | `PASS` \| `PASS_WITH_DEFERRED` \| `FAIL` |
| `adversarial-reviewer` | `NO_HOLES_FOUND` \| `HOLES_FOUND` \| `NEEDS_DISCUSSION` |
| `chatgpt-pr-review` | `APPROVED` \| `CHANGES_REQUESTED` \| `NEEDS_DISCUSSION` |
```

- [ ] **Step 8.4 — Add the caller-contract subsection**

Insert a new `### adversarial-reviewer` subsection between `### dual-reviewer` and `### spec-reviewer`. Anchor on the start of `### spec-reviewer`:

```
old_string:
### `dual-reviewer`

Self-writes its log to `tasks/review-logs/dual-review-log-<slug>-<timestamp>.md`. **Local-development-only** — depends on the local Codex CLI; will not run in Claude Code on the web. Never auto-invoke; only when the user explicitly asks.

### `spec-reviewer`

new_string:
### `dual-reviewer`

Self-writes its log to `tasks/review-logs/dual-review-log-<slug>-<timestamp>.md`. **Local-development-only** — depends on the local Codex CLI; will not run in Claude Code on the web. Never auto-invoke; only when the user explicitly asks.

### `adversarial-reviewer`

Read-only. Emits its complete review inside a fenced markdown block tagged `adversarial-review-log` and prints it as the LAST content of its response — same pattern as `pr-reviewer`.

**Caller responsibility:** before the user acts on any finding, extract the block verbatim and write it to `tasks/review-logs/adversarial-review-log-<slug>[-<chunk-slug>]-<timestamp>.md`. No edits, filtering, or interpretation before persistence — persist the raw block first, then triage.

**After persisting**, process findings:
- `confirmed-hole` findings → route to `tasks/todo.md` under `## Adversarial review findings — <slug>` for the main session to fix.
- `likely-hole` findings → route to the same backlog with the agent's "what would confirm" note attached.
- `worth-confirming` findings → keep in the log only; do not propagate to the backlog unless the user escalates.

Manually invoked only — the user must explicitly ask. Phase 1 advisory; non-blocking.

### `spec-reviewer`
```

- [ ] **Step 8.5 — Verify all three edits landed**

Run: `Grep -n "adversarial-review" tasks/review-logs/README.md`
Expected: at least four hits — filename enumeration, verdict-enum row, the new subsection heading, and the persisted-log filename in the subsection body.

Run: `Read tasks/review-logs/README.md` and eyeball each of the three regions to confirm shape consistency with the surrounding entries.

- [ ] **Step 8.6 — Commit**

```bash
git add tasks/review-logs/README.md
git commit -m "docs(review-logs): register adversarial-reviewer (agentic-engineering-notes Item B.3)"
```

---

## Task 9 — Item B.4: `CLAUDE.md` fleet table + review pipeline

Spec source: § 4.3 of `docs/agentic-engineering-notes-dev-spec.md` — the two `CLAUDE.md` rows.

**Files:**
- Modify: `CLAUDE.md` — three edits: add fleet-table row, add common-invocations example, add review-pipeline step.

**Constraint:** Task 1 already edited `CLAUDE.md` to add the verifiability heuristic; Task 9 must not collide. The Task 1 anchor (the `Verifiability heuristic` paragraph in §4) is far above the fleet table; the edits below all live under `## Local Dev Agent Fleet`. Re-read the file before editing to confirm line numbers — Task 1 will have shifted them.

- [ ] **Step 9.1 — Re-read the anchor regions**

Run: `Read CLAUDE.md` and locate:
- The fleet table (rows for triage-agent through chatgpt-spec-review, around lines 218–227).
- The `### Common invocations` fenced block under the fleet table.
- The `### Review pipeline (mandatory order)` numbered list.

The `dual-reviewer` row in the fleet table is the insertion anchor for the new `adversarial-reviewer` row — the new row goes immediately after `dual-reviewer` and before `spec-reviewer` so adversarial sits next to its sibling-posture agent.

- [ ] **Step 9.2 — Insert the fleet-table row**

Use `Edit`. Anchor on the existing `dual-reviewer` row to ensure the new row lands directly after it:

```
old_string:
| `dual-reviewer` | Codex review loop with Claude adjudication — second-phase **code** review. **Local-dev only — requires the local Codex CLI; unavailable in Claude Code on the web.** | After `pr-reviewer` on Significant and Major tasks — **only when the user explicitly asks**, never auto-invoked |

new_string:
| `dual-reviewer` | Codex review loop with Claude adjudication — second-phase **code** review. **Local-dev only — requires the local Codex CLI; unavailable in Claude Code on the web.** | After `pr-reviewer` on Significant and Major tasks — **only when the user explicitly asks**, never auto-invoked |
| `adversarial-reviewer` | Adversarial / threat-model review — read-only. Hunts tenant-isolation, auth, race-condition, injection, resource-abuse, and cross-tenant data-leakage holes. Emits a fenced `adversarial-review-log` block; the caller persists it. Phase 1 advisory; non-blocking. | After `pr-reviewer` on Significant and Major tasks — **only when the user explicitly asks**, never auto-invoked. Auto-invocation from `feature-coordinator` is deferred. |
```

- [ ] **Step 9.3 — Add the common-invocation example**

Anchor on the existing `dual-reviewer` invocation line; insert the new line immediately after:

```
old_string:
"dual-reviewer: [brief description]"     # local-only, user must explicitly ask
"spec-reviewer: review docs/path-to-spec.md"

new_string:
"dual-reviewer: [brief description]"     # local-only, user must explicitly ask
"adversarial-reviewer: hunt holes in the auth changes I just made"  # read-only, user must explicitly ask
"spec-reviewer: review docs/path-to-spec.md"
```

- [ ] **Step 9.4 — Extend the review pipeline**

The numbered list currently has three entries; add a fourth for `adversarial-reviewer`:

```
old_string:
For Standard/Significant/Major tasks, before marking done or opening a PR:

1. **Spec-driven only:** `spec-conformance` first. If it returns `CONFORMANT_AFTER_FIXES`, re-run `pr-reviewer` on the expanded changed-code set.
2. `pr-reviewer` — always.
3. `dual-reviewer` — optional, local-only, user must explicitly ask.

new_string:
For Standard/Significant/Major tasks, before marking done or opening a PR:

1. **Spec-driven only:** `spec-conformance` first. If it returns `CONFORMANT_AFTER_FIXES`, re-run `pr-reviewer` on the expanded changed-code set.
2. `pr-reviewer` — always.
3. `dual-reviewer` — optional, local-only, user must explicitly ask.
4. `adversarial-reviewer` — optional, user must explicitly ask. Phase 1 advisory; findings are non-blocking unless the user escalates.

Steps 3 and 4 are independent optional steps; their order does not affect correctness.
```

- [ ] **Step 9.5 — Verify all three edits**

Run: `Grep -n "adversarial-reviewer" CLAUDE.md`
Expected: at least three hits — fleet-table row, common-invocation example, pipeline-step line.

Run: `Read CLAUDE.md` lines around the fleet table, common invocations, and review pipeline to eyeball shape.

Run: `Grep -n "Verifiability heuristic" CLAUDE.md`
Expected: still one hit (Task 1 should not have been disturbed).

- [ ] **Step 9.6 — Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude-md): register adversarial-reviewer in fleet + pipeline (agentic-engineering-notes Item B.4)"
```

---

## Post-implementation review

**Success definition:** all nine task commits on the branch + `spec-conformance` returns `CONFORMANT` or `CONFORMANT_AFTER_FIXES` + `pr-reviewer` returns `APPROVED`. If `spec-conformance` returns `CONFORMANT_AFTER_FIXES`, success additionally requires a subsequent `APPROVED` from `pr-reviewer` on the *updated* diff (per the contract — `spec-conformance` may have applied mechanical fixes, so the changed-code set expands).

After Task 9 commits, the build-side work is complete. Run the review pipeline.

- [ ] **Step P.1 — Confirm working tree is clean**

Run: `git status`
Expected: clean working tree, all nine task commits on the branch.

Run: `git log --oneline main..HEAD`
Expected: one commit per task in the order Tasks 1–9 ran.

- [ ] **Step P.2 — Final verification command**

Run the spec-mandated quick-start verification (since Task 3 just put it in `replit.md` — confirm it actually works):

`npx tsc --noEmit && npx tsc -p server/tsconfig.json --noEmit`
Expected: both invocations exit 0 with no errors.

Run: `npm run lint`
Expected: pass.

- [ ] **Step P.3 — Run `spec-conformance`**

The spec drove this build, so `spec-conformance` is mandatory per `CLAUDE.md` § *Review pipeline*.

```
spec-conformance: verify the current branch against docs/agentic-engineering-notes-dev-spec.md
```

The agent self-writes its log to `tasks/review-logs/spec-conformance-log-agentic-engineering-notes-<timestamp>.md`. Process the verdict per the contract in `tasks/review-logs/README.md`:
- `CONFORMANT` → proceed to P.4.
- `CONFORMANT_AFTER_FIXES` → the agent applied mechanical fixes; re-run `pr-reviewer` on the expanded changed-code set in P.4.
- `NON_CONFORMANT` → triage the dated section the agent appended to `tasks/todo.md`. Resolve non-architectural gaps in-session and re-invoke (max 2 re-invocations); architectural gaps escalate to the user.

- [ ] **Step P.4 — Run `pr-reviewer`**

```
pr-reviewer: review all changes on this branch (nine commits implementing agentic-engineering-notes-dev-spec)
```

Persist the agent's `pr-review-log` block to `tasks/review-logs/pr-review-log-agentic-engineering-notes-<timestamp>.md` BEFORE acting on findings. Process per the contract in `tasks/review-logs/README.md` § `pr-reviewer`.

- [ ] **Step P.5 — Optional: `dual-reviewer` / `adversarial-reviewer`**

Only if the user explicitly asks. These two are independent optional steps — their order does not affect correctness. `dual-reviewer` is local-only (Codex CLI). `adversarial-reviewer` is the agent we just built — running it on its own enabling-build is meta but harmless; the threat-model checklist is mostly tenant/auth-scoped and this branch touches no schema or routes, so expect `NO_HOLES_FOUND`.

- [ ] **Step P.6 — Update `tasks/current-focus.md`**

If `tasks/current-focus.md` pointed at this build, update it to `none` or to the next sprint pointer per `CLAUDE.md` § *Current focus*.

- [ ] **Step P.7 — Hand back to the user**

The user opens the PR. Do NOT push or open the PR from the main session — see `CLAUDE.md` § *User Preferences*.

---

## Self-review notes (plan author)

Spec coverage check (each spec section → task):

| Spec section | Covered by |
|---|---|
| § 3.1 `replit.md` quick-start | Task 3 |
| § 3.1 `scripts/README.md` | Task 4 |
| § 3.1 `docs/README.md` | Task 5 |
| § 3.2 Files touched (Item A) | Tasks 3, 4, 5 |
| § 4.1 read-only agent definition | Task 7 |
| § 4.2 Trigger / failure-mode posture / threat checklist / verdict line | Task 7 |
| § 4.3 `.claude/agents/adversarial-reviewer.md` | Task 7 |
| § 4.3 `CLAUDE.md` fleet table | Task 9 |
| § 4.3 `CLAUDE.md` review-pipeline order | Task 9 |
| § 4.3 `tasks/review-logs/README.md` filename + verdict-enum table | Task 8 |
| § 4.3 `tools/mission-control/server/lib/logParsers.ts` extension | Task 6 |
| § 5.2 architect pre-plan section | Task 2 |
| § 6.2 verifiability heuristic | Task 1 |
| § 7 Build order | Build Order section above (matches D → C → A → B per spec) |
| § 8 Verification plan | Embedded in each task's verify steps + post-implementation review |
| § 9 Deferred items | Untouched; runtime fuzzing and per-domain extension recipes remain on `tasks/todo.md` |

Type/path consistency check:
- `adversarial-reviewer` is the agent name in Task 7's frontmatter, Task 8's caller-contract subsection, and Task 9's fleet/pipeline rows. All three match.
- `adversarial-review` (without `-er`) is the filename agent prefix in Task 6's `ReviewKind` union, Task 6's regex, Task 7's persisted-log path, and Task 8's filename-convention enumeration. All four match.
- `adversarial-review-log` is the fenced-block tag in Task 7's output envelope and Task 8's caller-contract subsection. Both match.
- Verdict enum `NO_HOLES_FOUND | HOLES_FOUND | NEEDS_DISCUSSION` appears identically in Task 7's verdict-line section, Task 8's per-agent table row, and the spec's § 4.2.

No placeholders. No "TODO" / "TBD" / "implement later" tokens in the plan. Every step has either a concrete edit payload, a concrete command, or a concrete verification expectation.

If any task's anchor lines have shifted since this plan was written (likely for `CLAUDE.md` after Task 1, or for the spec corpus after Task 5's index drift), re-anchor on the literal strings rather than line numbers — every `Edit` payload above uses literal anchors.
