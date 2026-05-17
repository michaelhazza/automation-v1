# Codebase Audit Report — Track A3 (skillAnalyzerServicePure split, post-refactor)

| Field | Value |
|---|---|
| Audit framework version | 1.4 |
| Project | automation-v1 |
| Audited by | Claude Code (main session, inline audit-runner playbook, third track) |
| Date | 2026-05-14 |
| Branch | audit/track-skill-analyzer |
| Starting commit SHA | 6f2f819a235f78dc0fca8575d015cc7945cf8bd5 |
| Final commit SHA | _(filled at finish)_ |
| Mode | Targeted — skillAnalyzerServicePure split (4th of the operator's four splits) |
| Layers run | Layer 2 Module I (RLS) + Module J (idempotency / queues / job discipline) + Layer 1 Areas 9 (boundary) + 10 (god files) |
| Subagents invoked | None |
| Previous tracks in this session | Track A → PR #308; Track A2 → PR #309 |

---

## Reconnaissance Map

### In-scope paths

- `server/services/skillAnalyzerService.ts` — **2,642 LOC** (over hard cap 2,500)
- `server/services/skillAnalyzerServicePure.ts` — **3,727 LOC** (over hard cap 2,500 by 1.5×)
- `server/services/skillAnalyzerConfigService.ts` — 238 LOC
- `server/jobs/skillAnalyzerJob.ts` — **2,254 LOC** (over soft cap 1,500)
- `server/jobs/skillAnalyzerJobWithIncidentEmission.ts` — 53 LOC
- `server/routes/skillAnalyzer.ts` — 556 LOC
- `server/db/schema/skillAnalyzerConfig.ts` — 93 LOC (singleton config — no tenant data)
- `server/db/schema/skillAnalyzerJobs.ts` — 110 LOC (tenant-scoped — has `organisation_id`)
- `server/db/schema/skillAnalyzerResults.ts` — 157 LOC (FK-scoped to skillAnalyzerJobs)
- Worker registration in `server/index.ts:685-699`

### Concurrent audits

Tracks A (PR #308) and A2 (PR #309) in flight. Non-overlapping file sets.

### Implicit external contracts (Rule 4)

- `skill_analyzer_jobs.classifyState` jsonb shape (queue state for the LLM stage)
- `skill_analyzer_results.classification` enum (`DUPLICATE | IMPROVEMENT | PARTIAL_OVERLAP | DISTINCT`)
- pg-boss `skill-analyzer` queue payload (`{ jobId: string }`)
- The 6-stage pipeline contract (Parse → Hash → Embed → Compare → Classify → Write)

### Protected files in scope

- `server/db/schema/skillAnalyzer*.ts`
- Worker registration at `server/index.ts:691` (boot path)

## Pass 1 Findings

| # | Finding | Severity | Confidence | Justification | Proposed fix | Pass |
|---|---|---|---|---|---|---|
| SA1 | **`skill_analyzer_results` lacks an RLS policy.** Same pattern as Track A2 WF1. The table is FK-scoped to `skill_analyzer_jobs` (which IS RLS-protected with `organisation_id`) but has no `CREATE POLICY` of its own (verified empty via `grep -E "skill_analyzer_results" migrations/*.sql \| grep -iE "POLICY\|ENABLE ROW\|FORCE ROW"`). It holds per-tenant classification data: `candidateSlug`, `candidateContentHash`, `classification` enum, `classification_reasoning`, `diff_summary` jsonb. **Mitigation:** routes are system-admin-only (`server/routes/skillAnalyzer.ts:28-29` applies `requireSystemAdmin`), so the attack surface is narrower than the WF1 cluster. Still a defence-in-depth gap. | medium | high — empty grep + table-definition inspection prove the gap; system-admin-only access narrows blast radius | Add `CREATE POLICY` migration with parent-EXISTS pattern (join through `skill_analyzer_jobs`). Add to check2-exempt section of `rls-not-applicable-allowlist.txt` with rationale. Pass 3 (Module I + migration). | 3 |
| SA2 | **God-files persist post-split with an inverted shape — both halves over hard cap.** `skillAnalyzerService.ts` = 2,642 LOC (over 2,500 hard cap); `skillAnalyzerServicePure.ts` = **3,727 LOC** (1.5× the service shell, also over hard cap). Total 6,369 LOC across the split — slightly bigger than skillExecutor's god-file (6,133, Track A F6). The Pure module being larger than the impure shell is unusual: typical Pure splits extract a small, focused helper set; this one extracted a parallel surface that's now its own god-file. | medium | high — `wc -l` deterministic | Per Area 10: splits are never Pass 2. Recommended next: decompose `skillAnalyzerServicePure.ts` by pipeline stage (parsePure, hashPure, embedPure, comparePure, classifyPure, writePure files) rather than treating it as a monolithic Pure namespace. | 3 |
| SA3 | **`skillAnalyzerJob.ts` is 2,254 LOC** (over soft cap 1,500). Jobs are not explicitly in framework Area 10's caps table (the caps are for `server/services/*.ts`, `server/routes/*.ts`, `client/src/pages/*.tsx`, `client/src/components/*.tsx`, `shared/*.ts`) but at 2,254 LOC with 6 pipeline stages this is a god-file by spirit. The Stage 1–Stage 6 contract is a natural decomposition boundary. | medium | high — `wc -l` deterministic; jobs file at scale of a service | Per Area 10 spirit: defer to Pass 3. Recommended split: one file per pipeline stage. Framework Area 10 could be extended to cap `server/jobs/*.ts` at the same soft/hard thresholds as services. | 3 |
| SA4 | **`server/index.ts:691` uses `boss.work('skill-analyzer', ...)` directly instead of the canonical `createWorker(...)` wrapper.** This bypasses the `withOrgTx` + `app.organisation_id` GUC setup that every other queue handler gets via `createWorker`. The skill-analyzer worker (and its `runSkillAnalyzerJobWithIncidentEmission` wrapper) reads/writes tenant-scoped data on the unscoped DB pool without ever entering an org-scoped transaction. **Cross-reference:** Track A2 WF4 found the workflow tick worker has the same anti-pattern via `resolveOrgContext: () => null`; this is the same pattern via `boss.work` directly. Both bypass canonical org-context plumbing. | medium | high — direct inspection: `boss.work` call at line 691 with no `withOrgTx` wrap downstream | Convert to `createWorker({queue: 'skill-analyzer', boss, concurrency, resolveOrgContext: (job) => /* look up org from the job row */, handler: ...})` OR document inline why this queue intentionally bypasses the org-context plumbing (e.g. system-admin-only operation). | 3 |
| SA5 | **Route URL uses UK spelling `skill-analyser` while everything else uses US `skillAnalyzer`.** `server/routes/skillAnalyzer.ts:36` mounts `POST /api/system/skill-analyser/jobs` (UK "analyser") but the file path, schema, services, jobs, and queue name all use US "analyzer". This is a stable contract once the URL ships (frontend, external API consumers); changing it now would be breaking. Worth documenting the intentional split or aligning the spelling on a major version. | low | high — direct path inspection | Add a one-line comment at the route declaration explaining the intentional UK-spelling URL, OR plan a deprecation cycle to align on US spelling. Documentation, not code. | 3 |
| SA6 | **`skillAnalyzerService.ts` raw `db.insert` for `skill_analyzer_results` (lines 2001, 2009) outside `getOrgScopedDb`.** Same family as Track A F3/F4, Track A2 WF3. Inserts happen during Stage 6 (Write) of the pipeline. Without scoped tx, the GUC isn't set; defence is the app-layer `jobId` filter (results belong to a job, job belongs to an org). Worsened because the job worker bypasses `createWorker` (SA4), so no upstream `withOrgTx` exists either. | medium | high — direct inspection at 2 sites | Migrate to `getOrgScopedDb('skillAnalyzerService.writeResults')` once SA4 lands; depends on the worker re-opening `withOrgTx`. Pass 3. | 3 |

## Prevention Proposals

| # | Target | Tier | Proposed addition | Closes findings |
|---|---|---|---|---|
| R1 | `gate` | 1 | Add a gate that flags any `boss.work(...)` call outside `server/lib/createWorker.ts` and `server/lib/__tests__/`. Forces queue handlers to go through the canonical wrapper or carry an inline `// guard-ignore: <reason>` annotation. | SA4 |
| R2 | `architecture.md` | 2 | Document the canonical worker registration pattern: "Every pg-boss queue handler MUST be registered via `createWorker(...)` to inherit the `withOrgTx` prelude. Bare `boss.work(...)` is reserved for the wrapper itself and for boot-time DLQ wiring. Cross-org sweep handlers use `resolveOrgContext: () => null` to opt out — see audit/track-workflow-engine WF4 for the trap to avoid." | SA4 |
| R3 | `gate` | 1 | Extend Track A2's Q1/Q2 (FK-scoped tenant tables without explicit RLS) to also cover `skill_analyzer_results`. The audit caught it manually; a gate would catch the next instance automatically. | SA1 |
| R4 | `KNOWLEDGE.md` | 3 | Pattern entry: "A 'split' commit landed two god-files instead of one — `skillAnalyzerServicePure.ts` (3,727 LOC) is even bigger than its impure shell (2,642 LOC). Pure modules should be smaller, focused helpers — not parallel god-files. Check `wc -l` on both sides of every split-PR before accepting the 'completed' claim." | SA2 |
| R5 | `docs/codebase-audit-framework.md` | 2 | Extend Area 10's caps table to cover `server/jobs/*.ts` with the same thresholds as services (soft 1,500 / hard 2,500). At present the framework only caps services, routes, client pages/components, and shared. Jobs at scale of a service warrant the same hygiene. | SA3 |
| R6 | `KNOWLEDGE.md` | 3 | Pattern entry: "URL paths can diverge from file/service spelling — `/api/system/skill-analyser/jobs` (UK) vs `skillAnalyzer*` (US) throughout the codebase. Audit-time spot-check: grep the route file for `router.(post\|get\|patch\|delete)` and compare the URL to the surrounding identifiers." | SA5 |

---

## Pass 2 Changes Applied

**None.** Every Pass 1 finding (SA1–SA6) is architectural (RLS migration, god-file decomposition, worker wrapper migration) or documentation (SA5). Per framework Rule 7 / Rule 8 / Area 10, none qualifies as a high-confidence mechanical fix.

### Validation Results

**N/A — no code modified in Pass 2.**

## Pass 3 Items

Cross-listed in `tasks/todo.md` under `## Deferred from codebase audit — 2026-05-14 (Track A3: skillAnalyzerServicePure split)`.

| Item | Area | Severity | Confidence | Recommendation |
|---|---|---|---|---|
| SA1 | Module I (RLS) | medium | high | Migration adding parent-EXISTS policy on `skill_analyzer_results` + allowlist entry |
| SA2 | Area 10 (god-files) | medium | high | Per-pipeline-stage decomposition of `skillAnalyzerServicePure.ts` |
| SA3 | Area 10 (jobs) | medium | high | Per-stage split of `skillAnalyzerJob.ts`; consider extending Area 10 caps to jobs |
| SA4 | Module J (worker plumbing) | medium | high | Migrate `server/index.ts:691` from `boss.work` to `createWorker` |
| SA5 | Module D (docs) | low | high | Document intentional UK-spelling URL OR plan migration |
| SA6 | Module I (RLS) | medium | high | Use `getOrgScopedDb()` once SA4 lands |

## Patterns Captured to KNOWLEDGE.md

| Pattern title | Trigger | Heading |
|---|---|---|
| A 'split' commit can land two god-files instead of one (Pure module bigger than its impure shell) | SA2 | `[2026-05-14] Pattern — A 'split' commit can land two god-files instead of one — the Pure module can end up bigger than its impure shell` |
| `boss.work(queue, ...)` outside `createWorker` bypasses canonical org-context plumbing | SA4 | `[2026-05-14] Pattern — boss.work(queue, ...) outside createWorker bypasses canonical org-context plumbing` |

## Summary

| Field | Value |
|---|---|
| Overall Status | PASS (audit produced; all findings deferred per architectural / docs scope) |
| Critical findings | 0 |
| High findings | 0 |
| Medium findings | SA1, SA2, SA3, SA4, SA6 — 5 |
| Low findings | SA5 — 1 |
| Fixes applied (pass 2) | 0 |
| Files modified | 0 (audit log + todo + KNOWLEDGE only) |
| Items deferred to pass 3 | 6 (SA1–SA6) |
| Prevention proposals | 6 — breakdown: `gate` × 2 (R1, R3) + `architecture.md` × 1 (R2) + `KNOWLEDGE.md` × 2 (R4, R6) + `docs/codebase-audit-framework.md` × 1 (R5) |
| KNOWLEDGE.md entries appended | 2 |
| Linked `pr-reviewer` log | _(filled when run)_ |
| Linked `spec-conformance` log | _(filled when run)_ |

## Post-audit actions required

1. `spec-conformance: verify the audit branch audit/track-skill-analyzer against its spec` — sanity check (no spec).
2. `pr-reviewer: review the audit branch audit/track-skill-analyzer. No Pass 2 code changes. Audit log: tasks/review-logs/codebase-audit-log-skill-analyzer-2026-05-14T16-53-39Z.md.`

## Recommended Next Steps

- SA4 is the highest-leverage finding — the bypass of `createWorker` undermines the project's queue-worker plumbing pattern. Pair with R1 prevention proposal so the next bypass surfaces automatically.
- SA1 is a smaller-blast-radius cousin of WF1 (Track A2). Treat both as one migration sprint adding parent-EXISTS RLS policies on every FK-scoped tenant table.
- SA2 / SA3 god-file decomposition is the same conversation as Track A F6 (skillExecutor) and Track A2 WF2 (workflowEngineService). All four split files are still over cap.
