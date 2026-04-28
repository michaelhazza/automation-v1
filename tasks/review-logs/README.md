# Review logs

Single source of truth for review-log conventions. All review agents in `.claude/agents/` write here; downstream tooling (mining for patterns, regression detection, audit cycles) globs this directory.

This document is referenced from `CLAUDE.md`, `feature-coordinator.md`, `spec-conformance.md`, `pr-reviewer.md`, `dual-reviewer.md`, `spec-reviewer.md`, `audit-runner.md`, and the ChatGPT review agents. **It is the canonical definition** — if a contract here disagrees with an agent definition, the agent definition is correct (more local), but flag the drift back to here.

---

## Filename convention

All review-log filenames use the shape:

```
tasks/review-logs/<agent>-log-<slug>[-<chunk-slug>]-<timestamp>.md
```

- **`<agent>`** — fixed per agent: `pr-review`, `spec-conformance`, `dual-review`, `spec-review`, `codebase-audit`, `chatgpt-pr-review`, `chatgpt-spec-review`.
- **`<slug>`** — the feature/spec slug when working under `tasks/builds/<slug>/`, otherwise a short kebab-case name derived from the branch or spec path.
- **`<chunk-slug>`** — present **only** when the review is scoped to a single plan chunk (e.g. `feature-coordinator` per-chunk invocations of `spec-conformance` or `pr-reviewer`); omitted for manual whole-branch invocations.
  - **Format:** kebab-case of the chunk name — lowercase, ASCII, hyphen-separated, no spaces or underscores, no duplicate hyphens.
  - **Derivation:** lowercase the chunk name → replace any run of non-alphanumeric characters with a single hyphen → trim leading/trailing hyphens.
  - **Example:** chunk name `"DB schema — agent_runs"` → `db-schema-agent-runs`.
- **`<timestamp>`** — ISO 8601 UTC with seconds, hyphens between time fields. Example: `2026-04-22T07-08-30Z`.

When referencing the review log from another artifact (`tasks/todo.md` source-log field, `progress.md` Notes column, a scratch file), use the same `slug` and `chunk-slug` so all three match.

---

## Verdict header convention

Every review log under `tasks/review-logs/` MUST include, within the first 30 lines, exactly one line matching the regex:

```
/^\*\*Verdict:\*\*\s+([A-Z_]+)\b/m
```

Format:

```
**Verdict:** <ENUM>
```

Trailing prose on the same line is allowed and ignored by the parser (e.g. `**Verdict:** CONFORMANT_AFTER_FIXES (1 mechanical gap closed; 4 directional items routed)`). The Mission Control dashboard at `tools/mission-control/` reads this line per log to surface the latest verdict per build.

Per-agent enum (locked):

| Agent | Allowed values |
|---|---|
| `spec-conformance` | `CONFORMANT` \| `CONFORMANT_AFTER_FIXES` \| `NON_CONFORMANT` |
| `pr-reviewer` | `APPROVED` \| `CHANGES_REQUESTED` \| `NEEDS_DISCUSSION` |
| `dual-reviewer` | `APPROVED` \| `CHANGES_REQUESTED` |
| `spec-reviewer` (final report) | `READY_FOR_BUILD` \| `NEEDS_REVISION` |
| `audit-runner` | `PASS` \| `PASS_WITH_DEFERRED` \| `FAIL` |
| `chatgpt-pr-review` | `APPROVED` \| `CHANGES_REQUESTED` \| `NEEDS_DISCUSSION` |
| `chatgpt-spec-review` | `APPROVED` \| `CHANGES_REQUESTED` \| `NEEDS_DISCUSSION` |

Mid-session ChatGPT logs (rounds in progress, no finalisation) MAY omit the Verdict line entirely. The dashboard treats missing-verdict logs as "review in progress."

When adding a new review agent, extend this table AND add a Verdict line to its log template — the dashboard parser will not see a verdict that lives elsewhere in the log.

---

## Caller contracts per agent

### `pr-reviewer`

`pr-reviewer` is read-only. It emits its complete review inside a fenced markdown block tagged `pr-review-log` and prints it as the LAST content of its response.

**Caller responsibility:** before fixing any issues, extract the block verbatim and write it to `tasks/review-logs/pr-review-log-<slug>[-<chunk-slug>]-<timestamp>.md`. Persist first, then fix — this captures the raw reviewer voice before code changes overwrite the context.

**After persisting**, process findings in this order:
1. Blocking non-architectural findings → implement in-session.
2. Blocking findings that are architectural in nature (significant redesign, contract change, multi-service impact) → route to `tasks/todo.md` under `## PR Review deferred items / ### <slug>` rather than attempting in-place.
3. Strong Recommendations → implement if in-scope, otherwise defer to the same backlog section.

### `spec-conformance`

Self-writes its log to `tasks/review-logs/spec-conformance-log-<slug>[-<chunk-slug>]-<timestamp>.md`. The agent also appends directional/ambiguous findings to `tasks/todo.md` under a dated section (`## Deferred from spec-conformance review — <spec-slug>`).

**Caller responsibility:** read the log path the agent returns. Process the Next-step verdict:

- **CONFORMANT** — proceed.
- **CONFORMANT_AFTER_FIXES** — agent applied mechanical fixes in-session. Re-run `pr-reviewer` on the expanded changed-code set.
- **NON_CONFORMANT** — triage the dated section the agent appended to `tasks/todo.md`:
  - Non-architectural gaps → resolve in-session, then re-invoke `spec-conformance` to confirm closure. **Max 2 re-invocations.**
  - Architectural gaps → leave in the dated section as the raw record AND promote into `## PR Review deferred items / ### <slug>` so they survive across review cycles. Do not re-invoke; escalate to the user.
  - Ambiguous-only / architectural-only remaining gap set → do not re-invoke; escalate.

### `dual-reviewer`

Self-writes its log to `tasks/review-logs/dual-review-log-<slug>-<timestamp>.md`. **Local-development-only** — depends on the local Codex CLI; will not run in Claude Code on the web. Never auto-invoke; only when the user explicitly asks.

### `spec-reviewer`

Self-writes per-iteration scratch logs to `tasks/review-logs/spec-review-log-<spec-slug>-<iteration>-<timestamp>.md` and a final summary to `tasks/review-logs/spec-review-final-<spec-slug>-<timestamp>.md`. Auto-decided directional findings are appended to `tasks/todo.md`.

### `audit-runner`

Self-writes its log to `tasks/review-logs/codebase-audit-log-<scope>-<timestamp>.md`. Pass-3 deferred items route to `tasks/todo.md`. Auto-commits and auto-pushes within its own flow.

### `chatgpt-pr-review` / `chatgpt-spec-review`

Self-write session logs to `tasks/review-logs/chatgpt-pr-review-<slug>-<timestamp>.md` and `tasks/review-logs/chatgpt-spec-review-<slug>-<timestamp>.md` respectively.

---

## Deferred actions route to `tasks/todo.md`

Every review agent that produces deferred action items writes them to **`tasks/todo.md`**, not to per-session side files. The review log here keeps the raw finding-by-finding record; `tasks/todo.md` carries the curated backlog.

Why one file: a future session picking up deferred work needs to grep one place, not scan a directory of session logs.

**Append rules:**
- **New dated section per review session** — heading shape `## Deferred from <agent> review — <PR-or-spec-ref>` with `**Captured**`, `**Source log**`, and a checkbox list. Never mix a new review's items into an existing feature's section.
- **Append-only** — never rewrite or delete existing sections. Future triage sessions close items by checking the box, not by deleting the line.
- **Dedup before append** — scan for a similar existing entry (same `finding_type` OR same leading ~5 words); skip if already present so re-runs don't duplicate.
- **No concurrent review agents against the same repo.** `tasks/todo.md` is a single shared file — two review agents appending simultaneously will race on the write.

### Item format — origin tag + status

Each deferred item line uses this shape so findings stay traceable to their source review and can be triaged at a glance:

```
- [ ] [origin:<agent>:<slug>:<timestamp>] [status:open] <finding description>
```

- **`origin:<agent>:<slug>:<timestamp>`** — references the source review log filename's discriminating fields. For audits: `origin:audit:<scope>:<timestamp>` (e.g. `origin:audit:rls:2026-04-25T07-35-00Z`). The tag exists so a future PR closing the item can grep back to the original finding.
- **`status:<state>`** — one of `open` (default), `in-progress`, `resolved`, `wont-fix`. Status is updated by editing the tag in place when work begins or completes; the checkbox flips to `[x]` only when `resolved` or `wont-fix`.

When a PR closes an item: include the `origin:` tag in the PR description so the audit trail joins. When marking `wont-fix`, append a one-line justification to the same line.

Triage sessions filter by `[status:open]` to see live work; by `[origin:audit:*]` to see all unresolved audit findings; by `[origin:audit:rls:2026-04-25T07-35-00Z]` to check closure of a specific audit.

---

## Persistence rule

If a reviewer ran, the log must exist. This applies regardless of task classification (Trivial / Standard / Significant / Major). Read-only reviewers (`pr-reviewer`) emit a fenced block the caller persists; self-writing agents persist their own logs.
