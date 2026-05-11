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


