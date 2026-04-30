---
title: Agentic Engineering Notes — Development Specification
date: 2026-04-30
status: draft
input: Karpathy "From Vibe Coding to Agentic Engineering" (Apr 2026) — applied to this repo
revision: 1
---

# Agentic Engineering Notes — Development Specification

## Table of contents

1. Summary
2. Current state audit
3. Item A — Agent-facing setup docs pass
4. Item B — Adversarial reviewer agent
5. Item C — "App shouldn't exist" check in architect
6. Item D — Verifiability heuristic in CLAUDE.md
7. Build order & dependencies
8. Verification plan
9. Deferred items & open questions

---

## 1. Summary

This spec translates four takeaways from the Karpathy "agentic engineering" talk into concrete repo changes. None of these items add product features. They sharpen how the agent fleet operates, close one gap in the review pipeline (adversarial / threat-model review), and reduce the rate at which we build pipelines that a single multimodal call could collapse.

**What this spec produces when fully implemented:**

- A repo where any agent can bootstrap, run, and verify the project from `replit.md` + a `scripts/README.md` index without human translation (Item A).
- A new `adversarial-reviewer` agent in the review pipeline that hunts tenant-isolation, auth, race-condition, and injection holes after `pr-reviewer` runs (Item B).
- An architect-agent prompt that forces the "could one model call replace this whole pipeline?" question before producing any plan (Item C).
- A verifiability heuristic in `CLAUDE.md` that changes how we scope and supervise non-verifiable (taste-based) work (Item D).

**North-star acceptance test:** A fresh Claude Code session, given only `replit.md` and a feature ask, can boot the dev environment, locate the right script, run the change through the review pipeline (including adversarial review), and produce a plan that explicitly considers the model-collapse alternative — with no human translating between docs and tooling at any step.

**Scope boundary:** Process / tooling only. No product code. No new product capability. No schema changes. No test-gate or CI changes.

---

## 2. Current state audit

Verified against current main on branch `claude/agentic-engineering-notes-WL2of`.

| Surface | File(s) | Status |
|---|---|---|
| Bootstrap doc | `replit.md` | Human-shaped: stack description, not actionable agent instructions |
| Scripts index | `scripts/` (~80 scripts), no `scripts/README.md` | No index — agents must grep |
| Docs index | `docs/` (~50 spec files), no top-level pointer | `architecture.md` indexes code but not specs |
| Review pipeline | `pr-reviewer.md`, `spec-conformance.md`, `dual-reviewer.md`, `audit-runner.md` | No adversarial / threat-model agent; `audit-runner` is broad-spectrum, not adversarial |
| Architect prompt | `.claude/agents/architect.md` (180 lines) | No model-collapse pre-check; defaults to multi-step pipeline planning |
| Task classification | `CLAUDE.md` § "Task Classification" | Classified by scope only; no verifiability axis |

No prior items in `tasks/todo.md` cover this work. No deferred items from earlier mini-specs need verification.

---

## 3. Item A — Agent-facing setup docs pass

### 3.1 What changes

Three documents converted from human-shaped to agent-shaped.

**`replit.md`** — Add an "Agent quick-start" section at the top with:

- Exact command to install and boot dev (`npm install && npm run dev`).
- Required env vars (link to `docs/env-manifest.json`).
- One-line verification command. The repo has two tsconfigs; the root `tsconfig.json` covers `client/src` only and `server/tsconfig.json` covers `server/` + `shared/`. The quick-start should give a single command that exercises both: `npx tsc --noEmit && npx tsc -p server/tsconfig.json --noEmit`.
- Pointer to `architecture.md` for code conventions, `scripts/README.md` for tooling, and `docs/README.md` for the spec-corpus index.

Keep the existing stack-description content but demote it below the quick-start.

**`scripts/README.md`** — New file. One-screen index mapping intent → script. Categories:

- Database: reseed, migrate, healthcheck.
- Code intelligence: rebuild graph, walker compare.
- Audits: run-all-gates, run-all-qa-tests, individual `verify-*` scripts (with the CI-only caveat from `CLAUDE.md`).
- Imports / exports: company import, system-agents export.
- Internal / test-only scripts (prefixed `_`) listed separately and marked "do not run unless instructed."

**`docs/README.md`** — New file. One-screen "if you're working on X, read Y" index over the spec corpus. Groups by domain (agents, skills, canonical data platform, ClientPulse, GEO/SEO, hierarchical delegation, HITL, etc.). Points at the canonical spec for each area, not all variants.

### 3.2 Files touched

| File | Action |
|---|---|
| `replit.md` | Edit — prepend agent quick-start section |
| `scripts/README.md` | New file |
| `docs/README.md` | New file |

### 3.3 Out of scope

- Per-domain "how to extend" recipes (adding a skill, adding an agent capability) — those live in `architecture.md` and skill files; if gaps surface during this pass, capture to `tasks/todo.md`, do not expand spec scope.
- Rewriting individual spec docs in `docs/` to be more agent-shaped.

---

## 4. Item B — Adversarial reviewer agent

### 4.1 What changes

New agent definition `.claude/agents/adversarial-reviewer.md`. Read-only (Read, Glob, Grep) — no Write, no Edit, no Bash.

### 4.2 Agent contract

**Trigger:** Manually invoked only — the user must explicitly ask, matching the `dual-reviewer` posture. Auto-invocation from `feature-coordinator` is deferred (see § 9). The intended auto-trigger surface, once auto-invocation lands, is any change under `server/db/schema/`, `server/routes/`, `server/services/auth*`, `server/middleware/`, or RLS-related migrations.

**Input:** The branch diff. Same auto-detection logic as `spec-conformance` (committed + staged + unstaged + untracked).

**Threat model checklist** (seeded from our actual surface, expanded as findings accumulate):

1. **RLS / tenant isolation** — every new query routed through a tenant-scoped client; no service-role escape; RLS policies cover the new table.
2. **Auth & permissions** — every new route gated by the right permission group; permission check uses session identity, not request body.
3. **Race conditions** — read-modify-write wrapped in a transaction; idempotency keys honored; queue jobs safe under retry.
4. **Injection** — no raw SQL string concat; prompt-injection surfaces in agent context flagged; path traversal in file ops; SSRF in outbound calls.
5. **Resource abuse** — per-tenant rate limit / quota; recursive agent invocation guard; unbounded queue payload.
6. **Cross-tenant data leakage** — shared caches keyed by tenant; logs and error messages do not leak other-tenant identifiers.

**Output:** Findings written to `tasks/review-logs/adversarial-review-log-<slug>-<timestamp>.md`. Each finding labelled `confirmed-hole`, `likely-hole`, or `worth-confirming`, with file:line references and a one-paragraph attack scenario. Confirmed holes route to `tasks/todo.md` for the main session to fix.

The log MUST include a verdict header per `tasks/review-logs/README.md § Verdict header convention`:

```
**Verdict:** <ENUM>
```

Allowed values for `adversarial-reviewer`: `NO_HOLES_FOUND` | `HOLES_FOUND` | `NEEDS_DISCUSSION`. The Mission Control dashboard parses this line — without it the log is treated as "review in progress."

**Non-goals:** Does not fix anything. Does not run code. Does not create a runtime fuzzing harness — that is deferred (see § 9).

### 4.3 Files touched

| File | Action |
|---|---|
| `.claude/agents/adversarial-reviewer.md` | New file |
| `CLAUDE.md` § "Local Dev Agent Fleet" table | Edit — add row |
| `CLAUDE.md` § "Review pipeline (mandatory order)" | Edit — adversarial-reviewer is optional, post-`pr-reviewer`, user must explicitly ask (matches `dual-reviewer` posture) |
| `tasks/review-logs/README.md` | Edit — add `adversarial-review-log` to the filename convention examples and add `adversarial-reviewer` row to the per-agent Verdict enum table (`NO_HOLES_FOUND` \| `HOLES_FOUND` \| `NEEDS_DISCUSSION`) |
| `tools/mission-control/server/lib/logParsers.ts` | Edit — extend the `ReviewKind` union with `'adversarial-review'` and extend `FILENAME_REGEX_STD` to recognise the `adversarial-review` prefix. Without this, Mission Control's parser returns `null` for adversarial-review-log filenames and the dashboard never sees them. The verdict-line parser is already prefix-agnostic so no change there. |

### 4.4 Out of scope (deferred to § 9)

Runtime fuzzing harness (`scripts/adversarial/`) that spins up the dev server and runs scripted multi-tenant attack scenarios. Higher value, larger build — separate spec.

---

## 5. Item C — "App shouldn't exist" check in architect

### 5.1 What changes

Edit `.claude/agents/architect.md`. Add a "Pre-plan: model-collapse check" section that runs before the architect produces any implementation plan.

### 5.2 Prompt addition

```
## Pre-plan: model-collapse check

Before producing the implementation plan, ask:

1. Does this feature decompose into ingest → extract → transform → render?
2. Is each step doing something a frontier multimodal model could do in a single call?
3. If yes: can the whole pipeline collapse into one model call with a structured-output schema?

State the collapsed-call alternative explicitly in the plan, even if you reject it. If you reject, give the reason in one paragraph (latency, cost, determinism, audit trail, compliance, model jaggedness in this domain). Do NOT default to a multi-step pipeline because that is how it would have been built before frontier multimodal models existed.

Record the decision under a heading "Model-collapse check" in the plan output.
```

### 5.3 Files touched

| File | Action |
|---|---|
| `.claude/agents/architect.md` | Edit — add the pre-plan section |

### 5.4 Success signal

Architect plans for new features include a "Model-collapse check" heading with either an adopted collapsed alternative or a one-paragraph rejection. If the rejection reason is the same across 5+ plans, hoist it into a standing rule and remove the check.

---

## 6. Item D — Verifiability heuristic in CLAUDE.md

### 6.1 What changes

One paragraph added to `CLAUDE.md`, near § 4 ("Verification Before Done") and the task-classification table.

### 6.2 Wording

```
**Verifiability heuristic.** Before scoping work, ask: is the success condition checkable by a deterministic test or only by human judgment? Verifiable work (route returns X, row saves with the right shape, test passes) can be agent-driven aggressively. Non-verifiable work (UX polish, tone, copy, "feels right", layout taste) needs a human in the loop on every iteration — frontier models are jagged here and will not self-correct toward the goal. For non-verifiable work: do not subagent-drive it overnight; sit with it; iterate visually.
```

### 6.3 Effect on task classification

No change to the four-class scheme (Trivial / Standard / Significant / Major). The heuristic is orthogonal: a Standard non-verifiable task gets *more* human oversight than a Standard verifiable task, not less.

### 6.4 Files touched

| File | Action |
|---|---|
| `CLAUDE.md` | Edit — add the paragraph |

---

## 7. Build order & dependencies

| Order | Item | Dependency | Cost |
|---|---|---|---|
| 1 | Item D (heuristic) | None — single paragraph edit | ~10 min |
| 2 | Item C (architect pre-check) | None — single prompt edit | ~15 min |
| 3 | Item A (setup docs) | None — three doc edits | ~1–2 hr |
| 4 | Item B (adversarial reviewer) | Pattern matches `pr-reviewer.md` (read-only single agent, no Codex loop) | ~2–3 hr |

All four items are independent. Order is by ascending cost; ship the cheap edits first so the heuristic and architect change are live for any work the adversarial-reviewer build itself produces.

---

## 8. Verification plan

| Item | Verification |
|---|---|
| A | Open a fresh Claude Code session, give it `replit.md` only, ask it to boot the dev env and run the quick-start verification command (`npx tsc --noEmit && npx tsc -p server/tsconfig.json --noEmit`). Both invocations should succeed without asking for stack details. |
| A | Ask the same session to "reseed the dev DB." It should locate the right script via `scripts/README.md` without grepping. |
| B | Invoke `adversarial-reviewer` against a known-good past PR (e.g. a recent RLS migration). Confirm the log file lands in `tasks/review-logs/` with the expected filename pattern and produces zero false confirmed-holes. |
| B | Invoke against a synthetic diff that intentionally drops a tenant filter. Confirm the agent flags it as a confirmed-hole with file:line reference. |
| C | Run architect on a fresh feature ask ("add a CSV import for contacts"). Confirm the plan output includes a "Model-collapse check" heading with an explicit decision. |
| D | After the heuristic ships, on the next non-verifiable task (e.g. a UI polish pass), confirm the main session does not subagent-drive it overnight and instead iterates inline with the user. |

No code changes; no test gates required. `npm run lint` and the two-tsconfig typecheck (`npx tsc --noEmit && npx tsc -p server/tsconfig.json --noEmit`) are not affected.

---

## 9. Deferred items & open questions

### Deferred items

| Item | Reason deferred | Routed to |
|---|---|---|
| Runtime adversarial fuzzing harness (`scripts/adversarial/`) — N tenants, M users, scripted concurrent attack scenarios, CI-gateable | Higher build cost; static adversarial-reviewer agent (Item B) covers ~80% of the value at ~10% of the cost; build only if the static agent's findings plateau and we still see tenant-isolation bugs in production | `tasks/todo.md` — "Adversarial fuzzing harness — follow-up to agentic-engineering-notes-dev-spec § 9" |
| Per-domain "how to extend" agent-shaped recipes (new skill, new agent, new permission group) | Out of scope for Item A; if gaps surface during the doc pass, capture them rather than expand spec scope | `tasks/todo.md` (created during Item A execution if gaps found) |
| Rewriting `docs/` spec corpus to be agent-shaped | Spec authoring is already covered by `docs/spec-authoring-checklist.md`; rewriting historical specs is low-yield | Not pursued |
| Auto-invocation of `adversarial-reviewer` from `feature-coordinator` | Start manual / opt-in (matches `dual-reviewer` posture); revisit after 5+ uses if the signal-to-noise ratio is high | Revisit after Item B has been used in anger |

### Open questions

- **Adversarial-reviewer model.** Sonnet (cheap, fast, runs often) vs Opus (deeper reasoning on threat scenarios). Default to Sonnet; escalate to Opus if findings are shallow.
- **Adversarial-reviewer auto-trigger surface.** Is "any change under `server/db/schema/`, `server/routes/`, `server/services/auth*`, `server/middleware/`, RLS-related migrations" the right gate? Likely yes, but confirm during first 3 invocations.
- **Architect model-collapse check loosening.** If the rejection reason is consistently "this domain is jagged for the model," that is a verifiability finding (Item D) — consider linking the two checks rather than duplicating reasoning.
