# Progress — sandbox-isolation

**Build slug:** sandbox-isolation
**Spec B parent strategy:** `tasks/builds/sandbox-and-executionbackend-strategy/brief.md` (Decision 1)
**Predecessor:** Spec A — `tasks/builds/execution-backend-adapter-contract/spec.md` (shipped PR #281)
**Sibling (concurrent):** Spec C — `tasks/builds/operator-session-identity/brief.md`
**Successor:** OpenClaw adapter — `tasks/builds/openclaw-adapter/scope.md`
**Anchoring brief:** `docs/synthetos-governed-agentic-os-brief-v1.2.md`

---

## Phase 1 — SPEC (COMPLETE)

| Step | Status | Notes |
|---|---|---|
| Brief intake | done | Brief v5 (2026-05-10). Major scope, ui_touch=false. |
| Branch-sync S0 | done | Initial: 0 behind. Mid-flow re-sync after PR #284 (3 commits): merged clean (2 conflicts resolved in `tasks/todo.md` and `current-focus.md`). |
| Build slug + directory | done | Slug `sandbox-isolation` clean. |
| Mockup loop | skipped | ui_touch=false (V1 has no customer UI per brief §2.8, §4). |
| Spec authoring | done | 1679 lines at lock. Source: brief v5; rigorous spec-authoring-checklist coverage. |
| spec-reviewer (Codex) | done | 4 iterations, READY_FOR_BUILD. 36 mechanical fixes auto-applied. 2 directional items routed to `tasks/todo.md` (SANDBOX-DEF-EGRESS-MECH still open; SANDBOX-DEF-LOG-SCHEMA closed in Round 1 F1). |
| v1.2 master architecture alignment | done | Anchored Spec B to `docs/synthetos-governed-agentic-os-brief-v1.2.md`. Added §4.1 layer mapping, §6 primitives table extensions, §7.2 controller-agnostic + system-agent notes, §14.4a Run Trace virtual view, §22 IEE delegation lifecycle note. |
| chatgpt-spec-review | done | 3 rounds, 30 findings total (11 + 13 + 6), all auto-applied as technical fixes. Zero user-facing decisions. Round 3 verdict: APPROVED — LOCK. Log: `tasks/review-logs/chatgpt-spec-review-sandbox-isolation-2026-05-11T02-09-36Z.md`. |
| Handoff | done | `tasks/builds/sandbox-isolation/handoff.md` (feature-coordinator entry contract). |
| current-focus.md → BUILDING | done | Lock transitioned at Phase 1 closeout. |
| Auto-commit + push | done | Phase 1 bundle committed by spec-coordinator playbook Step 11. |

---

## Decision log (Phase 1)

- **Architecture alignment locked to SynthetOS v1.2 master brief.** Spec B sits at Layer 4 (Sandbox Environment) within Layer 5 (IEE Execution Plane). Risk Tier 4. Policy Envelope integration via `agent_runs.policy_envelope_snapshot` (PR #279). Run Trace virtual view extended with 5 new sandbox ledgers. Controller-style agnostic. Three-tier agent model honoured (customer subaccount agents + system agents both dispatch into the same primitive).
- **SANDBOX-DEF-LOG-SCHEMA closed at chatgpt-spec-review Round 1 F1.** Locked to dedicated `sandbox_logs` table (line-level idempotency via `UNIQUE (sandbox_execution_id, log_stream, sequence)`; cleaner RLS surface symmetric with the other four sandbox tables; 90d retention decoupled from general app log layer).
- **CURRENT_VERSION + PUBLISHED_VERSION two-file split adopted at Round 2 F2.** `CURRENT_VERSION` is human-committed pre-build (version, template_resource_class, max_cost_cents_per_second, base_image_digest, deps_lockfile_hash). `PUBLISHED_VERSION` is CI-attestation-PR-committed post-build (image_digest from actual CI build). CI is the final-digest source of truth — avoids Docker-build non-determinism failure modes.
- **Cost ceiling enforcement via upper-bound estimator (Round 1 F2).** Pure helper `estimateSandboxCostCents = elapsedMs/1000 × maxCostCentsPerSecond`. Provider real-time cost API is best-effort; worker terminates on estimate ≥ ceiling; final billing reconciles via cost-correction ledger rows.
- **Start-claim lease model for pending → running (Round 1 F3).** 4 new columns on `sandbox_executions`: `provider_sandbox_id`, `start_claimed_at`, `start_claim_expires_at`, `start_attempt_count`. MAX_START_ATTEMPTS = 3 cap drives `pending → provider_unavailable`. Lease reclaim path handles worker-crash-mid-start cases.
- **RLS posture clarified at Round 1 F4.** Organisation boundary enforced at the RLS policy layer (matching existing app convention); subaccount filtering enforced at the service layer. Both layers required to satisfy brief §2.12.
- **Two-job ceiling monitor model (Round 1 R2).** `sandboxCeilingMonitorJob` re-enqueues every `monitorIntervalMs` with `singletonKey = sandbox_execution_id`. Paired one-shot `sandboxWallClockKillJob` belt-and-braces at `wallClockMs + buffer`.

---

## Open items routed to `tasks/todo.md`

- **SANDBOX-DEF-EGRESS-MECH** — build-time choice of egress interception mechanism (e2b SDK hooks vs application-layer proxy vs CNI/eBPF). Audit-row schema is locked in §20.6 independent of the mechanism. Decision lands during C12 template-build chunk after verifying e2b's exposed hooks.

---

## Phase 2 — BUILD (in progress)

**Coordinator:** feature-coordinator (inline in main session, Opus)
**Mode:** autonomous (operator pre-authorised proceed at plan-gate; no per-chunk confirmation)
**Started:** 2026-05-11T03:25:00Z

### Plan authoring + review

| Step | Status | Notes |
|---|---|---|
| S1 branch sync | done | 0 behind origin/main; no migration collisions; no merge needed |
| architect plan authoring | done | 16 chunks (split spec §23's 14: C1→C1a/C1b; C11→C11a/C11b). ≈56 files. Plan: `tasks/builds/sandbox-isolation/plan.md` |
| chatgpt-plan-review | done | 2 rounds, 16 findings auto-applied (10 Round 1 + 6 Round 2). Verdict APPROVED. Log: `tasks/review-logs/chatgpt-plan-review-sandbox-isolation-2026-05-11T03-53-38Z.md` |
| Plan gate | autonomous-skip | Operator pre-authorised proceed; no manual confirmation required |

### Chunk progress

| # | Chunk | Status | G1 attempts | Commit | Notes |
|---|---|---|---|---|---|
| 1 | C1a — Shared types + scaffolding | done | 1 | `babc3354` | 254 lines, 19 exports; tasks/current-focus.md was already at BUILDING (no-op for that file) |
| 2 | C1b — 5 Drizzle schemas + 3 SQL migrations + RLS manifest | done | 1 | `951e62cb` | Migrations 0321/0322/0323; sandbox_logs MAX_LOG_LINE_BYTES intentionally deferred from DB CHECK to service-layer truncation (write-amplification avoidance); flag for spec-conformance |
| 3 | C2 — FailureReason enum extension | done | 1 | (next) | Plan said `shared/iee/failure.ts`; actual enum lives in `shared/iee/failureReason.ts`. Builder routed to correct file. Plan-doc inaccuracy only — not a plan gap. |
| 4 | C3 — llm_requests extension | done | 1 | (next) | Migration 0324. Two CHECK constraints extended (`llm_requests_attribution_ck` + `llm_requests_execution_phase_ck` — second one was a consequential fix because sandbox rows need execution_phase=NULL). Approved scope expansion: `shared/types/systemPnl.ts` 1-line `InFlightSourceType` superset extension to keep router's `ctx.sourceType: SourceType` assignment typecheck-clean. |
| 5 | C4 — Provider resolver + inlineSandbox | done | 1 | (next) | Registration-seam pattern (no static import of e2bSandbox/localDocker). 22 test cases cover NODE_ENV × SANDBOX_PROVIDER × SANDBOX_ALLOW_INLINE matrix. Cleaned up 6 stale gitignored `.js` artifacts in `shared/iee/` (pre-April-30, no longer in sync with current `.ts` sources) — unblocks `failure('sandbox_*', ...)` in subsequent chunks' tests. |
| 6 | C12 — Template + CI publish + version parser | pending | — | — | — |
| 7 | C5 — SandboxExecutionService skeleton + pure helpers | pending | — | — | — |
| 8 | C6 — Output validation + redaction wiring | pending | — | — | — |
| 9 | C7 — Harvest pipeline | pending | — | — | — |
| 10 | C8 — withSandboxProvider + sandboxJobNames | pending | — | — | — |
| 11 | C9 — e2bSandbox provider | pending | — | — | — |
| 12 | C10 — localDockerSandbox provider | pending | — | — | — |
| 13 | C11a — Execution-scoped pg-boss jobs | pending | — | — | — |
| 14 | C11b — Retention-scoped pg-boss jobs | pending | — | — | — |
| 15 | C13 — iee_dev adapter rewiring | pending | — | — | — |
| 16 | C14 — CI gates + doc-sync | pending | — | — | — |

### Pre-existing branch state (informational)

Builder C1a noted two pre-existing typecheck errors unrelated to sandbox-isolation:
- `server/services/reportRenderingService.ts` — `@react-pdf/renderer` types missing
- `server/services/reportTemplates/MacroReport.tsx` — same root cause

Confirmed pre-existing on this branch via stash round-trip. Tracked here for reviewer context (not introduced by this build).

## Environment snapshot
- last_chunk_committed: C4 (commit pending)
- head: 58860bcb (C3)
- package_lock_md5: 237aa0e95b01b79c265c819bb3ba6170
- migration_count: 381
- captured_at: 2026-05-11T05:10:00Z

---

## Phase 3 — FINALISATION (queued)

Awaits Phase 2 completion.
