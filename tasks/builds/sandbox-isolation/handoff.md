# Handoff — sandbox-isolation

**Phase complete:** SPEC (Phase 1)
**Next phase:** BUILD (Phase 2 — run `feature-coordinator` in a new Claude Code session)
**Spec path:** `tasks/builds/sandbox-isolation/spec.md`
**Spec status:** `accepted` (locked 2026-05-11 after chatgpt-spec-review Round 3 APPROVED)
**Spec length:** 1679 lines
**Branch:** `claude/evolve-sandbox-isolation-brief-Q51hc`
**Build slug:** `sandbox-isolation`
**UI-touching:** no (V1 has no customer UI per brief §2.8, §4)
**Mockup paths:** n/a (mockup loop skipped — ui_touch=false)
**Anchoring master brief:** `docs/synthetos-governed-agentic-os-brief-v1.2.md`
**Predecessor spec:** `tasks/builds/execution-backend-adapter-contract/spec.md` (shipped PR #281)
**Sibling spec (concurrent):** `tasks/builds/operator-session-identity/` (Spec C, brief locked, in flight)
**Successor:** `tasks/builds/openclaw-adapter/scope.md`

---

## Review summary

| Reviewer | Verdict | Iterations | Findings | Auto-applied | Log |
|---|---|---|---|---|---|
| `spec-reviewer` (Codex) | READY_FOR_BUILD | 4 of 5 | 38 (36 mechanical + 2 deferred) | 36 | `tasks/review-logs/spec-review-final-sandbox-isolation-20260511T000426Z.md` |
| v1.2 master architecture alignment pass | n/a | — | — | (5 sections extended) | inline in spec |
| `chatgpt-spec-review` Round 1 | CHANGES_REQUESTED → resolved | — | 11 (F1-F5 + R1-R6) | 11 | `tasks/review-logs/chatgpt-spec-review-sandbox-isolation-2026-05-11T02-09-36Z.md` |
| `chatgpt-spec-review` Round 2 | CHANGES_REQUESTED → resolved | — | 13 (F1-F3 + R1-R5 + 5 nits) | 13 | same |
| `chatgpt-spec-review` Round 3 | **APPROVED — LOCK** | — | 6 (F1-F2 + R1-R4) | 6 | same |
| **Total** | **LOCKED** | — | **68** | **66** | — |

**Spec-reviewer iterations used:** 4 / 5 (1 reserved for unforeseen build-time spec amendments).

**ChatGPT spec review log:** `tasks/review-logs/chatgpt-spec-review-sandbox-isolation-2026-05-11T02-09-36Z.md`.

**User-facing decisions surfaced:** 0 across all 3 ChatGPT rounds. Every finding was technical (internal-quality, contract shape, file inventory, RLS posture, idempotency mechanics, CHECK constraints, count alignment).

---

## Open questions for Phase 2

**None blocking.** The chatgpt-spec-review process surfaced and locked every architectural decision. The one remaining build-time decision is tracked in `tasks/todo.md`:

- **SANDBOX-DEF-EGRESS-MECH** — choice of egress interception mechanism (e2b SDK hooks vs application-layer proxy vs CNI/eBPF). Audit-row schema is locked in spec §20.6 independent of the mechanism. Decision lands during C12 (template-build chunk) after verifying e2b's exposed hooks. Does NOT block Phase 2 plan authoring or C1-C11.

---

## Decisions made in Phase 1

Every decision below was made autonomously by the spec-coordinator (or by ChatGPT review findings auto-applied as technical fixes). None required operator approval per the chatgpt-spec-review agent's user-opt-out contract.

1. **Spec B is positioned at Layer 4 / Layer 5 of the SynthetOS v1.2 master architecture.** Sandbox Environment capability surface inside IEE Execution Plane.
2. **Risk Tier 4 inherited.** Default approval gate `review` (per master brief §11.2 derivation). Policy rules can override; existing `actions.gateLevel` machinery unchanged.
3. **Controller-style agnostic.** Both Native and Operator Controller dispatch into the same `SandboxExecutionService`.
4. **Three-tier agent model honoured.** Customer subaccount agents + system agents (Dev Agent, Platform Engineering) both consume `SandboxExecutionService` with appropriate tenancy tags.
5. **`SandboxExecutionService` interface declared.** Single approved boundary for untrusted Tier 4 code execution. Three implementations: `e2bSandbox` (prod / staging), `localDockerSandbox` (local dev), `inlineSandbox` (test-only with hard guard).
6. **Output contract pinned.** Four `/workspace/` paths: `output.json` (Zod-validated, redacted, untrusted-until-normalised), `artefacts/`, `logs/stdout.log`, `logs/stderr.log`. Anything outside discarded at sandbox close.
7. **Harvest pipeline 12 ordered steps.** Idempotent at every step. `(sandbox_execution_id, ...)` unique constraints throughout.
8. **`sandbox_logs` table locked** (Round 1 F1, was SANDBOX-DEF-LOG-SCHEMA deferral). Dedicated table; line-level idempotency `UNIQUE (sandbox_execution_id, log_stream, sequence)`; 90d retention; org-boundary RLS.
9. **Cost ceiling fallback estimator** (Round 1 F2). `estimateSandboxCostCents = elapsedMs/1000 × max_cost_cents_per_second`. Worker terminates on estimate ≥ ceiling; final billing reconciles via cost-correction ledger rows on `llm_requests`.
10. **Start-claim lease model** (Round 1 F3). Four new columns on `sandbox_executions`. MAX_START_ATTEMPTS = 3 cap drives `pending → provider_unavailable`. Lease reclaim handles worker-crash-mid-start cases.
11. **RLS posture: organisation-boundary at policy layer + subaccount filtering at service layer** (Round 1 F4). Matches existing app convention (`llm_requests`, `agent_runs`).
12. **Two-job ceiling monitor model** (Round 1 R2). `sandboxCeilingMonitorJob` re-enqueues with `singletonKey = sandbox_execution_id`; paired one-shot `sandboxWallClockKillJob` at `wallClockMs + buffer`.
13. **CURRENT_VERSION + PUBLISHED_VERSION two-file split** (Round 2 F2). CI is the final-digest source of truth. Avoids Docker-build non-determinism failure modes.
14. **`max_cost_cents_per_second` part of CURRENT_VERSION contract** (Round 2 F3). Five-field CURRENT_VERSION shape: version, template_resource_class, max_cost_cents_per_second, base_image_digest, deps_lockfile_hash. Parsed by `templateVersionParserPure.ts`.
15. **CHECK constraints on `sandbox_executions` capture positive invariants** (Round 2 R5). `(status NOT IN ('running', 'harvesting') OR provider_sandbox_id IS NOT NULL)` makes the real invariant grep-able and reviewable.
16. **Single canonical cost-ledger target** (brief §6 invariant). Extends `llm_requests` with `sandbox_compute` + `sandbox_compute_correction` source types. No parallel accounting paths.
17. **Failure-closed provider posture** (brief §2.14 + §6 invariant). No silent fallback to worker or `inlineSandbox` from any code path. CI grep gate enforces.
18. **Closed terminal-state taxonomy: 8 states.** Adding a new value requires a spec amendment.
19. **iee_dev migration is hard-cut, not gradual.** No feature flag for "sometimes sandbox, sometimes worker." The classification table (spec §7.2) is the dispatch rule; CI gate `verify-sandbox-classification` enforces.
20. **Test posture follows `docs/spec-context.md`.** Pure tests only + 5 new CI grep gates. No vitest / supertest / E2E.

---

## Phase 2 entry contract (for `feature-coordinator`)

`feature-coordinator` reads this file at its entry. Required actions:

1. **Restore Phase 1 context.** Read this handoff, then read the spec at `tasks/builds/sandbox-isolation/spec.md` end-to-end. Spec is 1679 lines; budget accordingly.
2. **S1 branch sync.** Re-fetch `origin/main` and check for new commits since this handoff (committed at the end of Phase 1).
3. **Invoke `architect`** to produce `tasks/builds/sandbox-isolation/plan.md`. The architect should consume:
   - The spec (`spec.md`) end-to-end.
   - The master brief (`docs/synthetos-governed-agentic-os-brief-v1.2.md`).
   - The §23 chunk pre-plan as a starting point (not a final plan — the architect decides whether 14 chunks is right or whether to merge / split).
4. **Run `chatgpt-plan-review`** on the architect's plan. Same manual-paste mechanics as `chatgpt-spec-review`. Operator drives the loop.
5. **Plan gate.** Present the finalised plan to the operator and STOP. Per CLAUDE.md model guidance, the operator manually switches to Sonnet at this gate before proceeding to chunked execution.
6. **Builder loop on Sonnet.** Each of the 14 chunks goes through G1 (lint + typecheck + build:server + build:client + targeted pure tests for that chunk's new pure functions).
7. **G2 gate after all chunks built.** Integrated-state checks.
8. **Branch-level review pass.** `spec-conformance` → `pr-reviewer` → `dual-reviewer` (if Codex available) → `adversarial-reviewer` (Phase 1 advisory).
9. **Doc-sync gate.** Per `docs/doc-sync.md`.
10. **Phase 3 handoff write.**

---

## Cross-coordination with Spec C (operator-session-identity)

Spec C runs concurrently on a separate branch. Per spec §26.1, code surfaces do not overlap:

- **Spec B:** `server/services/sandbox*`, `server/services/executionBackends/ieeDev*`, `server/db/schema/sandbox*`, `infra/sandbox-templates/`, `server/lib/withSandboxProvider.ts`, `server/lib/sandboxRetentionConstants.ts`, `server/jobs/sandbox*`, 4 SQL migrations + 1 sequencing script extending `llm_requests`.
- **Spec C:** `server/services/credentialBroker*`, OAuth callback handlers, new consent-log table, connection UI.

Shared design points (no blocking conflicts):
- `llm_requests.sourceType` enum — B adds `sandbox_compute` + `sandbox_compute_correction`; C adds `subscription_mediated`. Each spec's migration extends independently.
- Sub-account scoping — both enforce. B threads `subaccountId` through every new sandbox table; C inherits from existing CredentialBroker behaviour (PR #279).
- Credential redaction patterns — first to land defines the shared bundle; second consumes. Spec B's redaction logic is in `server/lib/redaction.ts` extensions per §11.3.

If both PRs reach merge queue simultaneously, second-to-merge rebases (mechanical conflicts: migration numbering, enum append-order).

---

## End of Phase 1 handoff

Phase 1 closed. Phase 2 ran inline under `feature-coordinator` autonomous mode.

---

## Phase 2 (BUILD) — complete

**Plan path:** tasks/builds/sandbox-isolation/plan.md (16 chunks, 2 rounds chatgpt-plan-review APPROVED)
**Chunks built:** 16 / 16
**Branch HEAD at handoff:** (Phase 2 close commit, set by Step 12)
**Total commits this phase:** 22 (chunk commits + plan + review logs + spec-conformance fix + adversarial routing + pr-reviewer fix-loop + dual-reviewer fixes)

### G1 attempts per chunk

All chunks: **1 attempt** (every builder pass landed on first try). Pre-existing `@react-pdf/renderer` typecheck errors confirmed unrelated; do not affect G1/G2/G3.

| Chunk | Commit | Files | Notes |
|---|---|---|---|
| C1a | `babc3354` | 1 | shared/types/sandbox.ts (254 lines, 19 exports) |
| C1b | `951e62cb` | 13 | 5 schemas + 3 migrations 0321/0322/0323 + manifest |
| C2 | `4056f455` | 1 | FailureReason +8 sandbox values |
| C3 | `58860bcb` | 4 | llm_requests migration 0324 + 1 type-superset fix |
| C4 | `5651ff45` | 3 | provider resolver + inlineSandbox + 22-case tests |
| C12 | `773150ea` | 17 | template + CI workflow + parser + 16 pure tests |
| C5 | `53c243eb` | 4 | SandboxExecutionService skeleton + 3 pure helpers + 36 tests |
| C6 | `31cec382` | 3 | output validation + redaction + 34 tests |
| C7 | `b2934f3e` | 4 | 12-step harvest pipeline + 29 new pure tests |
| C8 | `08629201` | 6 | withSandboxProvider + sandboxJobNames + 17 tests |
| C9 | `178c865e` | 4 | e2bSandbox (SDK stubbed) + 29 tests |
| C10 | `26a87f7a` | 4 | localDockerSandbox + 24 tests |
| C11a | `3139de24` | 11 | 4 execution-scoped jobs + 44 tests + queueService wiring |
| C11b | `ae7bdafd` | 8 | 3 retention jobs + 11 tests |
| C13 | `25347817` | 6 | iee_dev adapter rewiring + dry-run script |
| C14 | `455feb17` | 11 | 5 CI gates + 4 doc-sync files + ADR 0010 + KNOWLEDGE +4 |

### G2 attempts

**1 attempt → PASS.** 0 lint errors, 906 pre-existing warnings; 2 pre-existing typecheck errors (`@react-pdf/renderer`) confirmed on origin/main baseline; not introduced by this build.

### Branch-level review verdicts

| Reviewer | Verdict | Iterations | Log |
|---|---|---|---|
| spec-conformance R1 | NON_CONFORMANT | 1 | `tasks/review-logs/spec-conformance-log-sandbox-isolation-2026-05-11T08-06-30Z.md` |
| (fix landed `7d12f77f`) | — | — | REQ #11 harvest wiring + REQ #28/29 telemetry events |
| spec-conformance R2 | CONFORMANT_AFTER_FIXES | 2 | `tasks/review-logs/spec-conformance-log-sandbox-isolation-2026-05-11T08-35-46Z.md` |
| adversarial-reviewer | HOLES_FOUND (advisory) | 1 | `tasks/review-logs/adversarial-review-log-sandbox-isolation-2026-05-11T08-47-38Z.md` |
| pr-reviewer R1 | CHANGES_REQUESTED | 1 | `tasks/review-logs/pr-review-log-sandbox-isolation-2026-05-11T09-14-11Z.md` |
| pr-reviewer fix-loop R1 fixes | — | — | `c5167bc5` (B1 column rename + B2 providerOutput persistence + B3 reconciliation withOrgTx + B5 case-insensitive filter) |
| pr-reviewer R2 | APPROVED | 2 | same log |
| dual-reviewer (Codex) | APPROVED | 3 | `tasks/review-logs/dual-review-log-sandbox-isolation-2026-05-11T09-42-07Z.md` |
| pr-reviewer re-review | APPROVED | 1 (of 3 cap) | `tasks/review-logs/pr-review-log-sandbox-isolation-post-dual-2026-05-11T10-18-00Z.md` |

**Final G3:** PASS (same baseline).

### Deferred items routed to tasks/todo.md

- **Spec-conformance R1:** 14 directional + ambiguous items routed under "Deferred from spec-conformance review — sandbox-isolation (2026-05-11)"
- **Adversarial-reviewer:** 11 advisory findings routed under "Deferred from adversarial-reviewer review — sandbox-isolation (2026-05-11)"
- **pr-reviewer / dual-reviewer:** S1-S6, S-NEW1/2, N1-N14, N-NEW1/2 routed for chatgpt-pr-review pass in Phase 3

### Doc-sync gate

PASS (all 13 registered docs have explicit verdicts; 4 updated + 9 n/a with rationale). See `progress.md § Doc-sync gate verdicts`.

### CRITICAL — known architectural follow-up

**SANDBOX-B4 — Ceiling-monitor + wall-clock-kill enqueue.** The current provider interface is synchronous (`provider.runTask` blocks until terminal), making pre-start monitor enqueue impossible without a refactor. Wall-clock + cost ceilings rely solely on provider-side enforcement (best-effort) in V1.

**Real fix requires** splitting the provider interface into async `startTask` / `getProviderSignal` / `terminateTask` / `readFiles` seams. This is non-trivial refactor across `e2bSandbox`, `localDockerSandbox`, `inlineSandbox`, and `sandboxExecutionService.runTask`'s state-machine orchestration.

Operator and Phase 3 chatgpt-pr-review must decide:
- (a) Ship V1 with this limitation + tasks/todo.md SANDBOX-ADV-5.1 for follow-up build
- (b) Block merge until a follow-up build delivers the async provider interface
- (c) Spec amendment narrowing V1 scope to acknowledge the limitation explicitly

### Open issues for Phase 3 finalisation

1. **SANDBOX-B4 architectural follow-up** (see above)
2. **e2b SDK installation** (currently interface-stubbed; operator post-merge once e2b account provisioned; SANDBOX-DEF-EGRESS-MECH decision lands at SDK install time)
3. **`verify-sandbox-minimum-events.sh` CI gate** — was failing pre-fix because C5's runTask didn't emit `sandbox_start`/`sandbox_start_failed`. Fixed at `7d12f77f`. Should pass in Phase 3 CI but worth verifying.
4. **classifyExecutionClass unreachable sandbox branch** — all V1 DevTaskPayload variants route to `worker_trusted`. Sandbox dispatch is structurally complete but unreachable until future payload variants (Revenue Ops, Research Intel, LLM-emitted transforms) add an explicit executionClass field. Not a blocker for ship.
5. **Pre-existing typecheck errors** (`@react-pdf/renderer` missing types in 2 report-rendering files). Confirmed on origin/main; unrelated to this build but operator may want to fix before merge so the typecheck gate isn't perpetually red.

### Sub-agent / playbook deviations recorded

- **spec-conformance dispatched as sub-agent** (playbook says "in-session"). Context-management reason; agent doesn't dispatch further sub-agents so runtime restriction doesn't apply. The TodoWrite visibility benefit was sacrificed for context budget. Documented here for transparency.
- **Plan-gate (Step 5) operator confirmation skipped.** Operator pre-authorised proceed under autonomous mode ("don't ask questions - just continue until done").
- **Post-G2 spec-validity checkpoint skipped.** Same autonomous-mode preauth.

### Pipeline-state summary at handoff

- Branch state: clean (working tree empty post-Step-12 close commit)
- All chunks done; all reviewers APPROVED; doc-sync PASS
- 25+ deferred items in tasks/todo.md awaiting Phase 3 chatgpt-pr-review triage + operator post-merge prioritisation
- 1 architectural follow-up (SANDBOX-B4) explicitly flagged for operator decision

Phase 2 closed. Next: operator runs `launch finalisation` in a new Claude Code session for Phase 3 (S2 sync + G4 regression guard + chatgpt-pr-review + MERGE_READY transition).

---

## Phase 3 (FINALISATION) — complete

**PR number:** #287
**chatgpt-pr-review log:** `tasks/review-logs/chatgpt-pr-review-sandbox-isolation-2026-05-11T10-03-27Z.md`
**spec_deviations reviewed:** yes (SANDBOX-B4 architectural follow-up framed in Round 1 kickoff; ChatGPT did not raise as blocker; V1-ship limitation documented in `tasks/todo.md § SANDBOX-ADV-5.1`)

### S2 sync + G4 regression guard

- S2: 0 commits behind `origin/main`; clean no-op. No migration collisions (this branch adds 0321/0322/0323/0324; main tops out at 0320).
- G4: lint 0 errors / 906 baseline warnings; typecheck 2 pre-existing `@react-pdf/renderer` errors confirmed on origin/main baseline. No regressions introduced.

### chatgpt-pr-review rounds

| Round | Verdict | Findings | Implemented | Deferred | Commit |
|---|---|---|---|---|---|
| 1 | CHANGES_REQUESTED | 6 (3 blockers + 3 tightenings) | 5 (F2, F3, T1, T2, T3) | 1 (F1 → SANDBOX-F1) | `aa4a2596` |
| 2 | CHANGES_REQUESTED | 3 (1 blocker + 2 tightenings) | 3 (F1-R2, T1-R2, T2-R2) | 0 | `647d96db` |
| 3 | **APPROVED** | 0 blocking; 2 advisory non-blockers | 0 (advisory) | 2 (R3-T1, R3-T2 — R3-T2 covered by SANDBOX-F1) | (this commit) |

**Operator directive in Round 2:** *"whatever it is, let's fix it in this branch"* — overrode any defer instinct for that round. All 3 R2 findings implemented in-branch.

### Doc-sync sweep verdicts (per `docs/doc-sync.md`)

| Doc | Verdict |
|---|---|
| `architecture.md` | **yes** (§ Sandbox Isolation primitive § Provider selection — strengthened to document fail-fast guard, added § Application-level invariant for DB CHECK constraints, § CI integration, § Time-source for correctness-sensitive paths) |
| `docs/capabilities.md` | n/a — no capability / agency-capability / skill / integration add/remove/rename in Phase 3 (already covered Phase 2) |
| `docs/integration-reference.md` | n/a — e2b is internal sandbox infra, not a customer-exposed integration in the integration-reference sense |
| `CLAUDE.md` / `DEVELOPMENT_GUIDELINES.md` | n/a — no build discipline / convention / agent fleet / review pipeline changes in Phase 3 |
| `CONTRIBUTING.md` | n/a — no lint-suppression / comment-format changes |
| `docs/frontend-design-principles.md` | n/a — no UI changes (ui_touch=false per brief §2.8, §4) |
| `KNOWLEDGE.md` | **yes** (+4 patterns: DB CHECK constraint application classifier; DB-anchored elapsed time in correctness-sensitive paths; CI gates authored without workflow wiring; strict CI gates require pre-publish version-string convention) |
| `docs/spec-context.md` | n/a — spec-review sessions only |
| `docs/decisions/` | n/a — Phase 3 work is bug fixes + CI hygiene, not new ADR-worthy decisions (ADR 0010 covers SandboxExecutionService boundary from Phase 2) |
| `docs/context-packs/` | n/a — no architecture.md section-anchor changes invalidating existing packs |
| `references/test-gate-policy.md` | n/a — no test-gate posture change; the 5 sandbox gates are project-specific grep gates |
| `references/spec-review-directional-signals.md` | n/a — not a spec-review session |
| `.claude/FRAMEWORK_VERSION` + `.claude/CHANGELOG.md` | n/a — repo-specific feature work, not framework-level |

**Doc-sync gate: PASS** (all 13 registered docs have explicit verdicts; 2 updated + 11 n/a with rationale).

### KNOWLEDGE.md entries added: 4

1. **DB CHECK constraints require a pure application-level transition classifier** — generalises from `classifyCeilingTransition`.
2. **DB-anchored elapsed time in correctness-sensitive paths (ceiling monitor)** — extends existing `inboundRateLimiter` / `agentWorkingTimeService` pattern.
3. **CI grep gates authored in code must be wired into a workflow before merge** — process gap caught by Round 2 T2 (scope expansion).
4. **Strict CI gates require pre-publish version-string convention to avoid blocking ship** — `local-dev-*` prefix as the "not yet published" sentinel.

### tasks/todo.md items removed/closed

0 items closed by this Phase 3 (this is a build-finalisation pass; deferred items from spec-conformance, adversarial-reviewer, pr-reviewer, dual-reviewer, and chatgpt-pr-review remain explicit follow-ups for future builds).

Items added in Phase 3:
- **SANDBOX-F1** (deferred operator runbook for first-publish work — flip versions, compute real hashes, wire e2b CLI, push tag).
- **SANDBOX-R3-T1** (advisory — reconciliation eligibility uses Node wall-clock).
- **SANDBOX-R3-T2** (advisory cross-reference — covered by SANDBOX-F1).

### ready-to-merge label applied at: 2026-05-11T10:38:04Z

### Open issues at MERGE_READY

1. **SANDBOX-B4 architectural follow-up** — ceiling-monitor + wall-clock-kill jobs cannot be pre-start enqueued with the current synchronous `provider.runTask` interface. V1 ships with provider-side best-effort enforcement; tracked as `SANDBOX-ADV-5.1` in `tasks/todo.md` for a follow-up build that delivers async `startTask`/`getProviderSignal`/`terminateTask`/`readFiles` seams.
2. **e2b SDK installation** — interface-stubbed in V1. SANDBOX-F1 runbook covers operator post-merge work once the e2b account is provisioned.
3. **`@react-pdf/renderer` typecheck errors** — pre-existing on origin/main (confirmed); not introduced by this build, but operator may want to fix before the typecheck gate becomes load-bearing on every PR.

### Pipeline summary at handoff

- Branch state: clean (working tree empty post-Phase-3 commit)
- All 3 chatgpt-pr-review rounds closed (verdict APPROVED on Round 3)
- 9 chatgpt-pr-review findings closed in-branch (6 R1 + 3 R2); 2 R3 advisory routed
- 25+ deferred items in `tasks/todo.md` for post-merge backlog; 1 architectural follow-up (SANDBOX-B4) explicitly flagged

Phase 3 closed. Next: CI monitor loop drives green, then auto-merge.
