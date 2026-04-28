# Dev Mission Control

**Date:** 2026-04-28
**Status:** Draft — for build in branch `claude/review-feature-workflow-c7Zij`
**Class:** Significant (multiple domains, dev-tooling, new tool surface)

## Table of contents

1. Overview
2. Problem being solved
3. Out of scope
4. Architecture decisions
5. Files to change
6. Contracts
7. Execution model
8. Phase sequencing
9. Testing posture
10. Deferred items
11. Self-consistency notes
12. Maintenance notes

## 1. Overview

Three coordinated dev-tooling changes that ship together:

1. **ChatGPT-via-API CLI** — replaces the manual copy/paste loop in `chatgpt-pr-review` and `chatgpt-spec-review` with a CLI that calls the OpenAI API directly. The agents continue to own log file format and the per-round table; the CLI is a stateless input → findings function.
2. **Logging gap closures** — every review log under `tasks/review-logs/` gets a parseable `**Verdict:**` header line; `tasks/current-focus.md` gets a machine-readable HTML comment block. Required so the dashboard renders without fragile prose parsing.
3. **Mission Control dashboard** — read-only, single-screen "What's In Flight" view. Self-contained under `tools/mission-control/`, portable to other repos via env-var config.

These are independent in implementation but share the same review pass and ship as one PR for context coherence.

## 2. Problem being solved

- **Copy/paste fatigue.** Every ChatGPT review requires shuttling diffs/specs between Claude and ChatGPT manually. Friction enough that reviews get skipped or rushed.
- **No cross-branch view.** Multiple feature branches in flight at once → context-switching cost grows as `n²`. Existing tools (GitHub, VS Code, log files) each show one slice.
- **Review-log verdicts are YELLOW.** Only `spec-conformance` and `audit-runner` emit a parseable verdict header today. `pr-reviewer`, `dual-reviewer`, `spec-reviewer`, `chatgpt-*-review` bury the verdict in prose, so a dashboard cannot reliably surface "what's the latest review say."

## 3. Out of scope

- Coordinator / write-side mission control (kicking off reviews, merging, deploying from the UI). The dashboard is **read-only**.
- Production deploy management. Replit / Vercel handle this.
- Codex / dual-reviewer API automation. Codex remains CLI-driven.
- Cost tracking through `llmUsageService` for the dev-tool CLI.

See §10 Deferred items for the full list and rationale.

## 4. Architecture decisions

### A1. The dev-tool CLI does NOT route through `llmRouter`

`server/services/providers/llmRouter.ts` is the financial chokepoint for every **application** LLM call — every production agent run, embedding, transcription. The dev-tool CLI runs on a developer's local machine, outside the application context, against the developer's personal `OPENAI_API_KEY`. It does not consume an org's budget, does not write to `llm_usage`, does not flow through the resolver/registry chain.

**Mechanism:** `scripts/chatgpt-review.ts` reads `process.env.OPENAI_API_KEY` directly, makes a raw `fetch` to `https://api.openai.com/v1/chat/completions`, and returns. No imports from `server/services/providers/`.

**Rationale:** dev-tool cost is small, separate, and the user-facing reporting expectations are different. Mixing dev-tool calls into `llmUsageService` would pollute production cost dashboards.

### A2. The dashboard is read-only

The dashboard surfaces state that already exists (review log files, build progress files, `current-focus.md`, GitHub API) — it never writes. No "trigger review", no "merge PR", no "deploy". Any future write capability is a separate spec with its own auth model.

**Locked constraints (no exceptions without a new spec):**
- No manual override of findings — what the CLI/agent emits is what the dashboard renders.
- No editing of findings, verdicts, or progress in the UI.
- No "acknowledge and hide" — drift, partial data, and stale state are surfaced, never dismissed silently.

These keep the system deterministic: the dashboard is a pure projection of the underlying log/file/API state, and the underlying state is the only place edits happen.

### A3. The dashboard is portable

`tools/mission-control/` is self-contained: own `package.json`, own `tsconfig.json`, own `vite.config.ts`. All paths configurable via env vars (`MISSION_CONTROL_REPO_ROOT`, `MISSION_CONTROL_GITHUB_REPO`, `GITHUB_TOKEN`, `MISSION_CONTROL_PORT`). One directory copy + `npm install` to drop into another project.

### A4. CLI returns findings; agent owns logs

The CLI is stateless: input is diff/spec, output is `ChatGPTReviewResult` JSON on stdout. The `chatgpt-pr-review` / `chatgpt-spec-review` agent definitions continue to own log file format, the per-round table, the KNOWLEDGE.md finalisation step, and the user-facing approval flow. Only the "shuttle text to ChatGPT and get a response" step changes.

## 5. Files to change

### New files

| Path | Purpose |
|---|---|
| `scripts/chatgpt-review.ts` | CLI, `--mode pr\|spec`, reads diff/spec from stdin or file, calls OpenAI API, emits `ChatGPTReviewResult` JSON to stdout |
| `scripts/__tests__/chatgpt-review.test.ts` | tsx unit tests for pure parsing helpers (raw response → findings) |
| `tools/mission-control/package.json` | Standalone deps: express, react, vite, tailwind |
| `tools/mission-control/tsconfig.json` | Client tsconfig |
| `tools/mission-control/tsconfig.server.json` | Server tsconfig |
| `tools/mission-control/vite.config.ts` | Client bundler config; proxies `/api` to local server |
| `tools/mission-control/.env.example` | Documented env vars |
| `tools/mission-control/README.md` | Usage + portability notes |
| `tools/mission-control/server/index.ts` | Express server, exposes `/api/health`, `/api/in-flight`, `/api/builds`, `/api/current-focus`, `/api/review-logs`. PR + CI status flow through `/api/in-flight` (per § C4); no standalone `/api/github/*` endpoints. |
| `tools/mission-control/server/lib/config.ts` | Env-driven config, defaults |
| `tools/mission-control/server/lib/logParsers.ts` | Pure parsers: review-log filename → metadata; verdict header → enum; build progress.md → status |
| `tools/mission-control/server/lib/github.ts` | GitHub REST client (PRs by branch, latest CI run status) |
| `tools/mission-control/server/lib/inFlight.ts` | Composer: stitch local files + GitHub data into `InFlightItem[]` |
| `tools/mission-control/server/__tests__/logParsers.test.ts` | tsx unit tests for the pure parsers |
| `tools/mission-control/client/index.html` | Vite entry HTML |
| `tools/mission-control/client/src/main.tsx` | React entry |
| `tools/mission-control/client/src/App.tsx` | Single dashboard page |
| `tools/mission-control/client/src/components/InFlightCard.tsx` | Per-build card |
| `tools/mission-control/client/src/lib/api.ts` | Fetch wrapper |
| `tools/mission-control/client/src/index.css` | Tailwind entry |
| `docs/superpowers/specs/2026-04-28-dev-mission-control-spec.md` | This spec |

### Modified files

| Path | Change |
|---|---|
| `package.json` | Add scripts: `review:chatgpt-pr`, `review:chatgpt-spec`, `mission-control:dev` |
| `.env.example` | Add `OPENAI_API_KEY`, `GITHUB_TOKEN`, `MISSION_CONTROL_PORT` |
| `.gitignore` | Add `tools/mission-control/dist/`, `tools/mission-control/node_modules/` |
| `.claude/agents/chatgpt-pr-review.md` | Replace copy/paste invocation step with CLI call; preserve every other step (per-round logic, decision taxonomy, log format, finalisation) |
| `.claude/agents/chatgpt-spec-review.md` | Same |
| `.claude/agents/pr-reviewer.md` | Add `**Verdict:**` header line to its persisted log convention |
| `.claude/agents/dual-reviewer.md` | Same |
| `.claude/agents/spec-reviewer.md` | Same (final report only) |
| `tasks/review-logs/README.md` | Document the verdict header convention with regex |
| `tasks/current-focus.md` | Add machine-readable HTML comment block at top |

## 6. Contracts

### C1. `ChatGPTReviewResult` — CLI stdout JSON

Producer: `scripts/chatgpt-review.ts`. Consumer: `chatgpt-pr-review`, `chatgpt-spec-review` agents.

```json
{
  "mode": "pr",
  "model": "gpt-4o",
  "input_summary": {
    "branch": "claude/example",
    "spec_path": null,
    "files_changed": 12
  },
  "findings": [
    {
      "id": "f-001",
      "title": "Missing null check on user.email",
      "severity": "high",
      "category": "bug",
      "finding_type": "null_check",
      "rationale": "[no-doc] Direct hazard at server/services/userService.ts:42 — email accessed without guard.",
      "evidence": "server/services/userService.ts:42"
    }
  ],
  "verdict": "CHANGES_REQUESTED",
  "raw_response": "<full ChatGPT message text, verbatim>"
}
```

Field rules:
- `mode` ∈ {`pr`, `spec`}. `spec_path` is non-null in spec mode; `files_changed` is non-null in pr mode.
- `severity` ∈ {`critical`, `high`, `medium`, `low`} — matches existing chatgpt-*-review enum.
- `category` ∈ {`bug`, `improvement`, `style`, `architecture`} — matches existing enum.
- `finding_type` ∈ {`null_check`, `idempotency`, `naming`, `architecture`, `error_handling`, `test_coverage`, `security`, `performance`, `scope`, `other`} — matches existing enum, locked.
- `verdict` ∈ {`APPROVED`, `CHANGES_REQUESTED`, `NEEDS_DISCUSSION`}.
- `raw_response` is preserved verbatim so the agent can show the user what ChatGPT actually said and so the existing per-round logging continues to work.

**Source-of-truth precedence:** `raw_response` is canonical. The `findings` array is a CLI-extracted convenience for the agent's per-round table; if the two disagree, `raw_response` wins and the agent re-extracts.

### C2. Verdict header convention (review logs)

Every review log under `tasks/review-logs/` MUST include, within the first 30 lines, exactly one line matching:

```
**Verdict:** <ENUM>
```

Per-agent enum (locked):

| Agent | Allowed values |
|---|---|
| `spec-conformance` | `CONFORMANT` \| `CONFORMANT_AFTER_FIXES` \| `NON_CONFORMANT` |
| `pr-reviewer` | `APPROVED` \| `CHANGES_REQUESTED` \| `NEEDS_DISCUSSION` |
| `dual-reviewer` | `APPROVED` \| `CHANGES_REQUESTED` |
| `spec-reviewer` (final) | `READY_FOR_BUILD` \| `NEEDS_REVISION` |
| `audit-runner` | `PASS` \| `PASS_WITH_DEFERRED` \| `FAIL` |
| `chatgpt-pr-review` | `APPROVED` \| `CHANGES_REQUESTED` \| `NEEDS_DISCUSSION` |
| `chatgpt-spec-review` | `APPROVED` \| `CHANGES_REQUESTED` \| `NEEDS_DISCUSSION` |

Parser regex (used by `logParsers.ts`):

```
/^\*\*Verdict:\*\*\s+([A-Z_]+)\b/m
```

The trailing `\b` (word boundary) lets the agent append a parenthetical explanation on the same line — e.g. `**Verdict:** CONFORMANT_AFTER_FIXES (1 mechanical gap closed)` — without breaking the parser. Only the enum value is captured.

### C3. `current-focus.md` machine block

A single HTML comment block at the very top of the file:

```html
<!-- mission-control
active_spec: docs/superpowers/specs/2026-04-28-dev-mission-control-spec.md
active_plan: tasks/builds/dev-mission-control/plan.md
build_slug: dev-mission-control
branch: claude/review-feature-workflow-c7Zij
status: BUILDING
last_updated: 2026-04-28
-->
```

Status enum: `PLANNING` | `BUILDING` | `REVIEWING` | `MERGE_READY` | `MERGED` | `NONE`.

The block mirrors the prose below it. The block is read by the dashboard; the prose is read by humans. **Source-of-truth precedence:** if the two disagree, the prose is canonical and the block is corrected.

### C4. `InFlightItem` — Mission Control API JSON

Producer: `tools/mission-control/server/lib/inFlight.ts`. Consumer: dashboard UI.

```json
{
  "build_slug": "dev-mission-control",
  "branch": "claude/review-feature-workflow-c7Zij",
  "phase": "BUILDING",
  "pr": {
    "number": 207,
    "url": "https://github.com/michaelhazza/automation-v1/pull/207",
    "state": "open",
    "ci_status": "passing",
    "ci_updated_at": "2026-04-28T12:34:56Z"
  },
  "latest_review": {
    "kind": "spec-conformance",
    "verdict": "CONFORMANT_AFTER_FIXES",
    "log_path": "tasks/review-logs/spec-conformance-log-...md",
    "timestamp": "2026-04-28T12:00:00Z"
  },
  "progress": {
    "last_updated": "2026-04-28",
    "completed_chunks": 2,
    "total_chunks": 5
  },
  "dataPartial": false
}
```

Nullability:
- `pr` is `null` if no PR exists for the branch (intentional null) or the GitHub fetch errored (in which case `dataPartial` is `true`).
- `latest_review` is `null` if no review logs exist for the build slug.
- `progress` is `null` if no `progress.md` exists for the build slug.
- `pr.ci_updated_at` is `null` when no checks exist or when only a status with no `completed_at` is reported; otherwise the latest non-null `completed_at` across check-runs.
- `phase` is always present. Resolution order: machine block status (when this is the active focus build) → derived from latest review verdict (known green-family → `MERGE_READY`; known change-requested → `REVIEWING`; **unknown verdict string** → `REVIEWING`) → `BUILDING` default (only when there's no review at all).
- `dataPartial` is always present. `true` when at least one underlying fetch hit an error path (GitHub network blip, rate limit, etc.). The wrapping `/api/in-flight` response also carries a top-level `isPartial` boolean summarising across items.

`ci_status` ∈ {`passing`, `failing`, `pending`, `unknown`}. `unknown` covers the no-checks-configured case.

## 7. Execution model

- **CLI:** synchronous shell invocation. `npm run review:chatgpt-pr` style usage. Reads diff/spec from stdin or `--file <path>`, emits JSON to stdout, writes nothing to disk. Exits non-zero on missing `OPENAI_API_KEY`, OpenAI API error, or malformed input. No retries.
- **Dashboard server:** long-running Express on `MISSION_CONTROL_PORT` (default `5050`), bound to `127.0.0.1` only. In-memory cache with 60s TTL on GitHub API responses; local files re-read on every request (cheap).
- **Dashboard UI:** single-page React, polls `/api/in-flight` every 30s.

## 8. Phase sequencing

Phases are independent. Recommended order:

1. **Phase 1 — Logging gap closures.** No dependencies. Touches `.claude/agents/*.md`, `tasks/current-focus.md`, `tasks/review-logs/README.md`. Required before Phase 3 dashboard ships with parseable verdicts (else dashboard falls back to "see log").
2. **Phase 2 — ChatGPT API CLI + agent updates.** No dependencies. Touches `scripts/`, two agent definition files. Independent of phases 1 and 3.
3. **Phase 3 — Mission Control dashboard.** Depends on Phase 1 for clean data. Can ship without Phase 1 with degraded display.

No backward references; no orphaned deferrals; no phase-boundary contradictions.

## 9. Testing posture

Per `docs/spec-context.md`:
- `testing_posture: static_gates_primary` — applies
- `runtime_tests: pure_function_only` — applies; tsx unit tests for `logParsers.ts` and `chatgpt-review.ts` pure helpers
- `frontend_tests: none_for_now` — applies; no tests for `tools/mission-control/client/`
- `api_contract_tests: none_for_now` — applies
- `e2e_tests_of_own_app: none_for_now` — applies

The OpenAI fetch and the GitHub API fetch are boundary calls and not unit-tested. Manual verification via `npm run review:chatgpt-pr` and `npm run mission-control:dev` is the expected pre-merge check.

## 10. Deferred items

- **Coordinator / write-side mission control.** Triggering reviews, merging PRs, deploying from the dashboard is deferred indefinitely. Reason: VS Code already coordinates these well; adding a second control surface duplicates state.
- **Codex / dual-reviewer API automation.** Codex remains CLI-driven via `dual-reviewer` and `spec-reviewer`. Reason: Codex CLI is local-only by design; ChatGPT is the only review channel today that requires a manual loop.
- **Multi-tenant mission control.** Today the dashboard is a single-developer view of one repo. Reason: not yet at team scale; would require auth, persistence, and a hosted server.
- **Cost tracking for the dev-tool CLI.** OpenAI usage by the dev tool is not surfaced through `llmUsageService`. Reason: dev cost is currently negligible. If it becomes material, add a separate dev-cost log later.
- **Auth on the dashboard server.** Server binds to `127.0.0.1` only and assumes the local machine is trusted. Reason: localhost-only matches every other dev tool the user runs. If the dashboard is ever exposed beyond localhost, add auth before doing so.
- **Persistence layer.** Dashboard reads files and GitHub on every request. Reason: small N (handful of branches in flight); a DB is overkill.
- **Multiple production environments per client.** Out of scope per user direction.

## 11. Self-consistency notes

- **Goal "read-only dashboard"** ↔ **Implementation:** server exposes only GET endpoints; UI has no mutation actions. Match.
- **Goal "portable"** ↔ **Implementation:** `tools/mission-control/` is self-contained; all paths via env vars; README documents the copy-paste-into-other-project flow. Match.
- **Goal "dev CLI bypasses llmRouter"** ↔ **Implementation:** `scripts/chatgpt-review.ts` makes raw fetch with no imports from `server/services/providers/`. Match. Verified by pr-reviewer.
- **Goal "logging is parseable"** ↔ **Implementation:** verdict header regex is fixed in C2, applied to all review-agent definitions in Phase 1. Match.
- **Endpoint surface** — original draft listed `/api/github/prs` as a standalone endpoint; the as-built design routes PR + CI through the composed `/api/in-flight` feed instead. Cleaner, single source of truth, no second consumer ever needed for a thin proxy. Spec § 5 row updated; no `/api/github/*` endpoints exist.

## 12. Maintenance notes

- When a new review agent is added, update C2 (verdict enum) and the relevant agent definition with a `**Verdict:**` line.
- When a new build phase is needed, update C3 status enum and `inFlight.ts` resolution.
- The dashboard is intentionally minimal; resist adding KPIs, charts, or aggregations. If asked for them later, push back per `docs/frontend-design-principles.md`.
