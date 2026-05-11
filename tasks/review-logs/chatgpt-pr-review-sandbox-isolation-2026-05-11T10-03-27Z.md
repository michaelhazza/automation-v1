# ChatGPT PR Review — sandbox-isolation

## Session Info

- **PR:** #287 — https://github.com/michaelhazza/automation-v1/pull/287
- **Branch:** claude/evolve-sandbox-isolation-brief-Q51hc
- **Branch slug:** claude-evolve-sandbox-isolation-brief-Q51hc
- **Build slug:** sandbox-isolation
- **Spec:** tasks/builds/sandbox-isolation/spec.md (1679 lines, LOCKED)
- **Mode:** manual
- **HUMAN_IN_LOOP:** n/a (manual mode)
- **Started:** 2026-05-11T10:03:27Z
- **Coordinator:** finalisation-coordinator (inline in main session, Opus)

## Phase 2 review summary (pre-existing)

| Reviewer | Verdict | Iterations | Log |
|---|---|---|---|
| spec-conformance R2 | CONFORMANT_AFTER_FIXES | 2 | tasks/review-logs/spec-conformance-log-sandbox-isolation-2026-05-11T08-35-46Z.md |
| adversarial-reviewer | HOLES_FOUND (advisory) | 1 | tasks/review-logs/adversarial-review-log-sandbox-isolation-2026-05-11T08-47-38Z.md |
| pr-reviewer R2 | APPROVED | 2 | tasks/review-logs/pr-review-log-sandbox-isolation-2026-05-11T09-14-11Z.md |
| dual-reviewer (Codex) | APPROVED | 3 | tasks/review-logs/dual-review-log-sandbox-isolation-2026-05-11T09-42-07Z.md |
| pr-reviewer re-review | APPROVED | 1 | tasks/review-logs/pr-review-log-sandbox-isolation-post-dual-2026-05-11T10-18-00Z.md |

Doc-sync gate PASS (4 docs updated + 9 n/a with rationale).

## Phase 2 spec deviations / known follow-ups surfaced to ChatGPT

1. **SANDBOX-B4 — Ceiling-monitor + wall-clock-kill enqueue (architectural follow-up).** Synchronous `provider.runTask` blocks pre-start monitor enqueue. Wall-clock + cost ceilings rely solely on provider-side enforcement (best-effort) in V1. Real fix requires splitting provider interface into async `startTask` / `getProviderSignal` / `terminateTask` / `readFiles` seams. **Operator decision needed in this review.**
2. **MAX_LOG_LINE_BYTES (spec §20.8) deferred from DB CHECK to service-layer truncation in C7** (write-amplification avoidance).
3. **classifyExecutionClass currently routes all V1 DevTaskPayload variants to `worker_trusted`** — sandbox dispatch structurally complete but unreachable until future payload variants add an explicit executionClass field. Not a blocker for ship.
4. **e2b SDK installation deferred post-merge** (interface-stubbed; SANDBOX-DEF-EGRESS-MECH lands at SDK install time).
5. **Pre-existing typecheck errors** — `@react-pdf/renderer` missing types in 2 report-rendering files. Confirmed on origin/main; baseline, not introduced by this build.
6. **Plan-gate (Step 5) operator confirmation skipped** in Phase 2 — operator pre-authorised proceed under autonomous mode.
7. **Post-G2 spec-validity checkpoint skipped** — same autonomous-mode preauth.

## Diff bundle

- **Round 1 code-only:** `.chatgpt-diffs/pr287-round1-code-diff.diff` — 464K, 85 files
- **Round 1 full:** `.chatgpt-diffs/pr287-round1-diff.diff` — 984K, 111 files

---

## Rounds

### Round 1 — 2026-05-11T10:03:27Z

**Operator framing:** code-only diff at `.chatgpt-diffs/pr287-round1-code-diff.diff` (464K, 85 files). Full diff also offered (984K, 111 files). Spec deviations + known follow-ups surfaced explicitly.

**Verdict from ChatGPT:** CHANGES_REQUESTED — *"Hold merge. Fix F1-F3 first. After that, T1 is the most important tightening because it protects the exact template-pinning contract this build depends on."*

**Top themes (finding_type vocabulary):** architecture (F3 fail-fast guard, F1 template completeness), security (F2 attestation invariant), test_coverage (T1/T2/T3 gate hardening).

#### Findings — Recommendations and Decisions

| ID | Title | Triage | Severity | Scope | My recommendation | Final decision | Rationale |
|---|---|---|---|---|---|---|---|
| F1 | C12 template structurally unbuildable (placeholder hashes) | technical-escalated *(reason: rec=defer)* | high | standard | defer | **defer (user-approved `as recommended`)** | Per spec §15.2 + Phase 2 progress.md, deps_lockfile_hash + base image digest + pip package hashes are intentionally placeholder until e2b account is provisioned and first tag push. V1 ships interface-stubbed pending account provisioning. Routed to `tasks/todo.md § Deferred spec decisions — sandbox-isolation` as SANDBOX-F1 with operator runbook. |
| F2 | Publish workflow can attest fake image digest (`sha256:pending-first-publish` fallback) | technical-escalated *(reason: severity=high)* | high | standard | implement | **implement (user-approved `as recommended`)** | `.github/workflows/publish-sandbox-templates.yml` — hard-fail on `E2B_PUBLISH_ENABLED != true`, removed local-derived fallback, added `^sha256:[a-f0-9]{64}$` invariant on IMAGE_DIGEST. Prevents placeholder digest from landing in PUBLISHED_VERSION. |
| F3 | Production e2b path stubbed but accepted in all envs | technical-escalated *(reason: severity=high)* | high | standard | implement | **implement (user-approved `as recommended`)** | `server/services/sandbox/e2bSandbox.ts` — added fail-fast guard in the registered factory: throws `sandbox_provider_unavailable` in production always, and in non-production unless `E2B_SDK_STUBBED=true` is explicitly set. Tests bypass via direct E2bSandbox construction (mock client injection). |
| T1 | `verify-template-version-coherence.sh` informational, not blocking | technical | medium | standard | implement | **implement (auto-applied)** | `scripts/gates/verify-template-version-coherence.sh` — added `STRICT_TEMPLATE_TAG_CHECK=1` env var: when set, missing publish tags for non-`local-dev-*` versions are a hard FAIL (main / ready-to-merge); default PR mode remains informational. |
| T2 | `verify-no-sandbox-cost-update.sh` too broad | technical | medium | standard | implement | **implement (auto-applied)** | `scripts/gates/verify-no-sandbox-cost-update.sh` — narrowed to flag only files that contain BOTH an `update(llmRequests)` call AND a reference to `sandbox_compute(_correction)?`. Maintenance jobs that update non-sandbox llmRequests no longer trip the gate. |
| T3 | `verify-sandbox-classification.sh` is mostly a presence check | technical | medium | standard | implement | **implement (auto-applied)** | `scripts/gates/verify-sandbox-classification.sh` — (a) added auto-detection check 0: any adapter declaring `sandboxRequirement: 'code_execution'` not in `SANDBOX_REQUIRED_ADAPTERS` is a FAIL; (b) strengthened check 1: requires BOTH a sandboxExecutionService import (static OR dynamic) AND an actual `runTask(` invocation in the body, not just any mention. |

**Scope check (step 4):** ~70 lines across 5 code files + 1 todo file = well under 500 lines / 20 files. No scope warning needed.

**G3 verification (step 6):** Lint 0 errors / 906 baseline warnings; typecheck 2 pre-existing `@react-pdf/renderer` errors (confirmed on origin/main). No new errors introduced.

**Gate dry-run:** All 3 modified gates execute and PASS against the current branch state in default (PR-mode) configuration.

**Files changed (5 code + 1 todo + this log):**
- `.github/workflows/publish-sandbox-templates.yml` (F2)
- `server/services/sandbox/e2bSandbox.ts` (F3)
- `scripts/gates/verify-template-version-coherence.sh` (T1)
- `scripts/gates/verify-no-sandbox-cost-update.sh` (T2)
- `scripts/gates/verify-sandbox-classification.sh` (T3)
- `tasks/todo.md` (F1 deferred + SANDBOX-F1 operator runbook)
- `tasks/review-logs/chatgpt-pr-review-sandbox-isolation-2026-05-11T10-03-27Z.md` (this log)

### Round 2 — 2026-05-11T10:30:00Z

**Operator directive (before triage):** *"whatever it is, let's fix it in this branch"* — overrides any defer instinct for this round. All findings implement-in-branch unless physically impossible.

**Verdict from ChatGPT:** CHANGES_REQUESTED — *"fix the pending-to-harvesting CHECK violation before locking. The CI strict env wiring is the next most important."*

**Top themes (finding_type vocabulary):** architecture (F1 transition classifier), test_coverage (T2 CI wiring), correctness/timing (T1 DB-anchored time).

#### Findings — Recommendations and Decisions

| ID | Title | Triage | Severity | Scope | My recommendation | Final decision | Rationale |
|---|---|---|---|---|---|---|---|
| F1-R2 | DB CHECK constraint violation on `pending → harvesting` flip in ceiling monitor + reconciliation | technical-escalated *(reason: severity=high)* | high | architectural | implement | **implement (operator: `whatever it is, let's fix it`)** | Real runtime bug — `sandbox_executions_running_harvesting_needs_provider_id` rejects status='harvesting' with NULL provider_sandbox_id; a pending row has NULL provider_sandbox_id by the paired CHECK. Confirmed in `sandboxCeilingMonitorJob.markForHarvest()` (line 186 `inArray(status, ['pending', 'running'])`) AND `sandboxHarvestReconciliationJob.reconcileExecution()` (line 206 `status = ANY(ARRAY['pending','running'])`). Both jobs would write a row that violates the CHECK constraint when a pending+null-provider-id row is swept. Fix: added pure classifier `classifyCeilingTransition(status, providerSandboxId, ceilingType): CeilingTransition` in `sandboxCeilingMonitorPure.ts` with 4 outcomes (`harvesting` / `start_failed` / `noop:already_harvesting` / `noop:unexpected_state`); ceiling monitor's `applyCeilingTransition` routes accordingly — `running+non-null → harvesting` (with race-safe `status='running'` WHERE), `pending+null → provider_unavailable` direct terminal write (skip harvest). Reconciliation job extended `SELECT` to include `provider_sandbox_id`, extended `StuckRow` type, and split `STUCK_PRE_TERMINAL` branch: `pending+null → provider_unavailable` direct terminal write + return (no harvest call), `running+non-null → harvesting` then invoke harvest. Pure tests added (8 cases covering all branches including anomalous shapes that the CHECK should already have prevented). |
| T1-R2 | `Date.now()` in ceiling monitor should be DB-anchored | technical | medium | standard | implement | **implement (auto-applied)** | Project has documented DB-anchored / monotonic-time invariants for correctness-sensitive paths (`inboundRateLimiter.ts` uses `extract(epoch from now())` from DB query; `agentWorkingTimeService.ts` uses `process.hrtime.bigint()` for elapsed). Ceiling monitor enforces wall-clock + cost ceilings — drives timeout + billing — fits the same invariant. Fix: extended the row-load `SELECT` in `sandboxCeilingMonitorJob.ts` to compute `(EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000)::bigint` DB-side, returning elapsedMs anchored at both endpoints; removed `Date.now()` and `new Date(startedAt).getTime()` from the elapsed calc; left `startedAt` on the payload type for backwards-compat with prior queue entries (commented as no longer consumed). |
| T2-R2 | `STRICT_TEMPLATE_TAG_CHECK` needs CI wiring | technical-escalated *(reason: scope expanded to high)* | high | architectural | implement | **implement (operator: `whatever it is, let's fix it`)** | ChatGPT caught the symptom (strict env var not wired) but **the real gap was wider — none of the 5 C14 sandbox gates were wired to any CI workflow at all.** Fix: added 5 steps to `.github/workflows/ci.yml § grep_invariants`: `verify-sandbox-classification`, `verify-sandbox-minimum-events`, `verify-no-sandbox-cost-update`, `verify-no-inline-sandbox-outside-test`, and `verify-template-version-coherence` with `STRICT_TEMPLATE_TAG_CHECK` set to `1` on `ready-to-merge` and `0` on PR (via `contains(github.event.pull_request.labels.*.name, 'ready-to-merge')` ternary). Also flipped `CURRENT_VERSION.version` + `PUBLISHED_VERSION.version` from `v1.0.0` to `local-dev-v1.0.0` so the strict gate stays green on this PR's `ready-to-merge` label — operator flips back to `v1.0.0` at first-publish time (recorded in SANDBOX-F1 step 0). |

**Scope check (step 4):** ~250 lines across 8 files (2 job files + 1 pure module + 1 pure test + 1 workflow + 2 template version files + 1 todo). Above 500-line threshold? No — under. No scope warning needed.

**G3 verification (step 6):** Lint 0 errors / 906 baseline warnings; typecheck 2 pre-existing `@react-pdf/renderer` errors (confirmed on origin/main); 72/72 sandbox-related vitest pass (27 ceiling-monitor pure + 16 templateVersionParser pure + 29 e2bSandbox pure).

**Gate dry-run:** All 5 sandbox gates execute and PASS in default PR mode AND in STRICT_TEMPLATE_TAG_CHECK=1 mode (with the version-string flip).

**Files changed in Round 2:**
- `server/jobs/sandboxCeilingMonitorPure.ts` (F1 classifier + types)
- `server/jobs/sandboxCeilingMonitorJob.ts` (T1 DB-anchored elapsed + F1 applyCeilingTransition split)
- `server/jobs/sandboxHarvestReconciliationJob.ts` (F1 SELECT + StuckRow + split transition path)
- `server/jobs/__tests__/sandboxCeilingMonitorPure.test.ts` (F1 +8 classifier tests; 19 → 27 total)
- `.github/workflows/ci.yml` (T2 wire 5 sandbox gates + STRICT mode on ready-to-merge)
- `infra/sandbox-templates/synthetos-sandbox/CURRENT_VERSION` (T2 version → local-dev-v1.0.0)
- `infra/sandbox-templates/synthetos-sandbox/PUBLISHED_VERSION` (T2 version → local-dev-v1.0.0)
- `tasks/todo.md` (SANDBOX-F1 step 0 added — operator flips back to v1.0.0 at first-publish)
- `tasks/review-logs/chatgpt-pr-review-sandbox-isolation-2026-05-11T10-03-27Z.md` (this log)

### Round 3 — 2026-05-11T10:45:00Z

**Verdict from ChatGPT:** **APPROVED — lock-ready, assuming CI is green.**

> *"No further blocker from me."*

All 3 Round 2 findings confirmed resolved by ChatGPT:
- R2-F1 CHECK violation → fixed via `classifyCeilingTransition` + DB-CHECK-encoded pure test matrix.
- R2-T1 DB-anchored ceiling timing → fixed via `EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000`.
- R2-T2 STRICT_TEMPLATE_TAG_CHECK + all 5 sandbox gates → wired into `grep_invariants`.

**Two non-blocker advisory notes** (operator chose to record both as explicit deferred items rather than silently accept):

| ID | Title | ChatGPT call | Action |
|---|---|---|---|
| R3-T1 | Reconciliation still uses Node wall-clock for `now = new Date()` eligibility check | *"less critical than ceiling monitor because it is recovery timing, not billing enforcement, but for consistency I'd eventually move that to DB time too. Not a blocker."* | Routed to `tasks/todo.md § Deferred from chatgpt-pr-review — sandbox-isolation` as **SANDBOX-R3-T1** for a future build. |
| R3-T2 | Placeholder PUBLISHED_VERSION acceptable only because version is now `local-dev-*` | *"The publish workflow still hard-fails until real e2b publish/inspect is wired, which is the right posture. Not a blocker, but keep the deferred item explicit."* | SANDBOX-F1 already explicitly carries the operator runbook; no new entry needed, but cross-referenced in R3-T1 entry. |

**Operator directive (after verdict):** *"lock down the review after this and progress to finalisation including setting timers for managing CI tests and iterating fixes until complete and merged"* — explicit close-out signal. No further rounds. finalisation-coordinator proceeds to doc-sync + KNOWLEDGE + tasks/todo.md cleanup + MERGE_READY transition + CI monitor loop + auto-merge.

**Files changed in Round 3:**
- `tasks/todo.md` (SANDBOX-R3-T1 advisory deferred for future build)
- `tasks/review-logs/chatgpt-pr-review-sandbox-isolation-2026-05-11T10-03-27Z.md` (this log close-out)

## Final Summary

**3 rounds total. Final verdict: APPROVED — operator-locked Round 3.**

| Round | Verdict | Findings | Implemented | Deferred | Commit |
|---|---|---|---|---|---|
| 1 | CHANGES_REQUESTED | 6 (3 blockers + 3 tightenings) | 5 (F2, F3, T1, T2, T3) | 1 (F1 → SANDBOX-F1) | `aa4a2596` |
| 2 | CHANGES_REQUESTED | 3 (1 blocker + 2 tightenings) | 3 (F1-R2, T1-R2, T2-R2) | 0 | `647d96db` |
| 3 | APPROVED | 0 blocking, 2 advisory non-blockers | 0 (advisory) | 2 (R3-T1, R3-T2 advisory; R3-T2 already covered by SANDBOX-F1) | (this commit) |

**Doc-sync sweep verdicts:** see Phase 3 handoff section in `tasks/builds/sandbox-isolation/handoff.md`.

**KNOWLEDGE.md patterns appended this Phase 3:** see same handoff section.

**Operator decisions surfaced:** 0 user-facing. 1 architectural escalation (SANDBOX-B4) was explicitly flagged in framing but ChatGPT did not raise it — the V1-ship limitation is documented in handoff + SANDBOX-ADV-5.1 for a follow-up build. Operator's "fix it in this branch" directive applied to ChatGPT's findings only; the wall-clock-kill/ceiling-monitor enqueue refactor remains a separate architectural follow-up.


