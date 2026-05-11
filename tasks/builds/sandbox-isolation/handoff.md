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

## End of handoff

Phase 1 closed. `feature-coordinator` may proceed with Phase 2 in a new Claude Code session per CLAUDE.md model guidance (Opus for spec authoring + plan gate; Sonnet for chunked execution).
