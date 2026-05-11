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
| 3 | C2 — FailureReason enum extension | done | 1 | `4056f455` | Plan said `shared/iee/failure.ts`; actual enum lives in `shared/iee/failureReason.ts`. Builder routed to correct file. Plan-doc inaccuracy only — not a plan gap. |
| 4 | C3 — llm_requests extension | done | 1 | `58860bcb` | Migration 0324. Two CHECK constraints extended (`llm_requests_attribution_ck` + `llm_requests_execution_phase_ck` — second one was a consequential fix because sandbox rows need execution_phase=NULL). Approved scope expansion: `shared/types/systemPnl.ts` 1-line `InFlightSourceType` superset extension to keep router's `ctx.sourceType: SourceType` assignment typecheck-clean. |
| 5 | C4 — Provider resolver + inlineSandbox | done | 1 | `5651ff45` | Registration-seam pattern (no static import of e2bSandbox/localDocker). 22 test cases cover NODE_ENV × SANDBOX_PROVIDER × SANDBOX_ALLOW_INLINE matrix. Cleaned up 6 stale gitignored `.js` artifacts in `shared/iee/` (pre-April-30, no longer in sync with current `.ts` sources) — unblocks `failure('sandbox_*', ...)` in subsequent chunks' tests. |
| 6 | C12 — Template + CI publish + version parser | done | 1 | `773150ea` | 16 files. synthetos-sandbox template + openclaw-session placeholders + parser + docker-compose + GH workflow + 16 pure tests. CURRENT_VERSION.deps_lockfile_hash = sha256:000... (operator computes real hash before first tag push, per spec §15.2). PUBLISHED_VERSION all-zeros placeholder (CI attestation PR writes real values on first publish). e2b publish CLI invocation is TODO pending e2b account provisioning — workflow structurally complete otherwise. docker-compose uses `sandbox-build` profile (no auto-start). |
| 7 | C5 — SandboxExecutionService skeleton + pure helpers | done | 1 | `53c243eb` | 36 pure tests; 7-case start-claim lease state machine; harvest seam stubbed for C7; ceiling-monitor enqueue stubbed for C11a. Approved scope expansion: `shared/stateMachineGuards.ts` added `sandbox_execution` kind + paired sets/case for `assertValidTransition` per DEVELOPMENT_GUIDELINES §8.18. |
| 8 | C6 — Output validation + redaction wiring | done | 1 | `31cec382` | 3 helpers (composeRedactionPatternSet, classifyHarvestOutcome with 12-step first-failed semantics, validateOutputAgainstSchema). 34 pure tests. redaction.ts +3 sandbox patterns. |
| 9 | C7 — Harvest pipeline (12 ordered steps) | done | 1 | (next) | runHarvest + runHarvestReconciliation. Provider file API calls guarded by providerCallStub with TODO(C8) — replaced when C8 lands. Step 6 has credential-leak defense per spec §11.4. Step 12 wraps assertValidTransition. C6 Pure file extended with 2 new helpers (extractTerminalReasonFromProviderSignal, pickHarvestStepFromError); test file now 61 tests. credentialBrokerService.issueCredential gained optional redactionPattern?: RegExp. resolveOutputSchema is TODO(C7-schema-registry) — returns null falling back to z.unknown(). |
| 10 | C8 — withSandboxProvider + sandboxJobNames | done | 1 | (next) | sandboxJobNames.ts (all 7 queue constants for C11a/C11b consumption). withSandboxProvider with 3-attempt backoff + retry-after + slow-start diagnostics + ambiguous-terminal reconciliation enqueue (string-constant seam, no handler import). withSandboxProviderPure.ts with classifyProviderSignal + extractRetryAfterMs. 17 pure tests. Approved scope: replaced C7's providerCallStub with withSandboxProvider at 4 call sites. Diagnostics emitted as structured log events (not DB rows) — lib wrapper doesn't hold the full HarvestContext that telemetry rows require. |
| 11 | C9 — e2bSandbox provider | done | 1 | (next) | e2bSandbox + e2bSandboxPure (4 helpers: terminal-signal mapper, latest-version guard, metadata-tag builder, credentialAliasPath). 29 pure tests. Module-init registerSandboxProvider('e2b', ...) per F1 fix. e2b SDK is interface-stubbed (real install post-merge once account provisioned); credential value-threading stubbed for C13. SANDBOX-DEF-EGRESS-MECH decision: DEFERRED to actual SDK install (audit-row schema unaffected) — recorded in tasks/todo.md. |
| 12 | C10 — localDockerSandbox provider | done | 1 | (next) | localDockerSandbox + localDockerSandboxPure (dockerExitCodeToTerminal mapper + assertNotLatestLocalTemplateVersion guard). 24 pure tests. docker run --rm --network=none --read-only --stop-timeout via child_process.spawn with SIGTERM forwarding. Zero-cost rows per spec §12.5. Module-init registerSandboxProvider('local_docker', ...). |
| 13 | C11a — Execution-scoped pg-boss jobs | done | 1 | (next) | 4 jobs (harvestReconciliation, ceilingMonitor, wallClockKill, artefactPurge) + 2 pure modules + 2 tests (44 pure-test cases) + queueService.ts and jobConfig.ts wiring. Approved scope: jobConfig.ts inclusion (pg-boss job config registry). Reconciliation cron 5min; ceiling monitor singletonKey = sandbox_execution_id. |
| 14 | C11b — Retention-scoped pg-boss jobs | done | 1 | (next) | 3 prune jobs (telemetry 90d, logs 90d-AND-soft-deleted, egress 180d) + sandboxRetentionPure (UTC-deterministic cutoff helper, 11 pure tests). Daily cron at distinct times (02:00/02:30/03:00 UTC). withAdminConnection + per-org withOrgTx pattern (mirrors fastPathDecisionsPruneJob). Logs prune deletes both age-expired AND `is_active=false` per spec §17.3. |
| 15 | C13 — iee_dev adapter rewiring + classifyExecutionClass | done | 1 | (next) | classifyExecutionClass + ieeDevBackend dispatch rewire. 13 pure tests + 9-assertion dry-run script. Notable finding for spec-conformance: current DevTaskPayload has no sub-kind discriminator — all V1 variants classify as `worker_trusted`, so the sandbox branch is structurally correct but unreachable until future payload variants (Revenue Ops CSV parsing, Research Intelligence PDF, LLM-emitted transforms) add an explicit `kind`/`executionClass` field. Wiring complete; activation deferred to consuming features. |
| 16 | C14 — CI gates + doc-sync (closes the build) | done | 1 | (next) | 5 CI gate scripts (classification, minimum-events, template-version-coherence, no-cost-update, no-inline-outside-test) + architecture.md "Sandbox Isolation primitive" section + docs/capabilities.md vendor-neutral row + docs/env-manifest.json (5 env vars: SANDBOX_PROVIDER, SANDBOX_ALLOW_INLINE, E2B_API_KEY, E2B_PROJECT_PROD, E2B_PROJECT_STAGING) + ADR 0010-sandbox-execution-service.md (spec said 0009 but already taken) + KNOWLEDGE.md +4 patterns. **Notable: verify-sandbox-minimum-events.sh CURRENTLY FAILS** because C9/C10 providers stub SDK calls and don't emit `sandbox_start`/`sandbox_start_failed` events yet — this is a real spec-conformance gap to surface (events should likely be emitted by C5's service layer). |

### Pre-existing branch state (informational)

Builder C1a noted two pre-existing typecheck errors unrelated to sandbox-isolation:
- `server/services/reportRenderingService.ts` — `@react-pdf/renderer` types missing
- `server/services/reportTemplates/MacroReport.tsx` — same root cause

Confirmed pre-existing on this branch via stash round-trip. Tracked here for reviewer context (not introduced by this build).

## Environment snapshot
- last_chunk_committed: C14 (commit pending)
- head: 25347817 (C13)
- package_lock_md5: 237aa0e95b01b79c265c819bb3ba6170
- migration_count: 381
- captured_at: 2026-05-11T09:15:00Z

## Phase 2 BUILD complete + branch-level review pass complete

All 16 chunks committed and pushed. Branch-level review pass closed.

### Gate results

| Gate | Verdict | Notes |
|---|---|---|
| G2 (lint + typecheck) | PASS | 0 lint errors / 906 pre-existing warnings; 2 pre-existing typecheck errors (`@react-pdf/renderer` missing types — confirmed on origin/main baseline) |
| Spec-validity checkpoint | autonomous-skip | Operator pre-authorised |
| spec-conformance R1 | NON_CONFORMANT | 3 critical gaps (REQ 11/28/29) + 12 directional + 2 ambiguous |
| spec-conformance R2 | CONFORMANT_AFTER_FIXES | 3 critical gaps closed at `7d12f77f`; 14 deferred items in tasks/todo.md |
| adversarial-reviewer | HOLES_FOUND (advisory) | 2 confirmed + 4 likely + 5 worth-confirming; 11 routed to tasks/todo.md (3 prioritised pre-merge) |
| pr-reviewer R1 | CHANGES_REQUESTED | 5 blocking (B1-B5); 6 strong; 14 nits |
| pr-reviewer R2 (post fix-loop) | APPROVED | 4 blockers fixed at `c5167bc5`; B4 deferred as architectural |
| dual-reviewer (Codex) | APPROVED | 3 iterations, 5 ACCEPT + 1 REJECT; fixes at `37451d8a` (provider bootstrap import, started_at, harvest step 2, reconciliation step 1) |
| pr-reviewer re-review | APPROVED | 0 blocking, 1 strong (test coverage for new branches), 2 non-blocking |
| Final G3 | PASS | Same baseline (0 lint, 2 pre-existing typecheck) |

### Doc-sync gate verdicts (per docs/doc-sync.md)

- **architecture.md updated:** yes (new section "Sandbox Isolation primitive — SandboxExecutionService" under Layer 4 / Execution Backends; ieeDevBackend cross-link)
- **docs/capabilities.md updated:** yes (Tier 4 Isolated Code Execution agency capability row, vendor-neutral phrasing)
- **docs/integration-reference.md updated:** n/a — no customer-facing integration scope/skill/OAuth/MCP/alias changes. e2b is internal sandbox infrastructure, not a customer-exposed integration in the integration-reference sense.
- **CLAUDE.md / DEVELOPMENT_GUIDELINES.md updated:** n/a — checked for changes to build discipline, conventions, agent fleet, review pipeline, locked rules; sandbox build follows existing patterns without new conventions.
- **CONTRIBUTING.md updated:** n/a — no lint-suppression policy, comment-format, or contributor-convention changes.
- **docs/frontend-design-principles.md updated:** n/a — Spec B has no UI in V1 (ui_touch=false per brief §2.8, §4).
- **KNOWLEDGE.md updated:** yes (4 patterns appended: registration-seam pattern, string-constant queue-name module, stale gitignored .js intercept, OR-clause chunk cohesion)
- **docs/spec-context.md updated:** n/a per playbook (feature pipelines record n/a; spec-review sessions only).
- **docs/decisions/ updated:** yes (new ADR `0010-sandbox-execution-service.md` — vendor-adapter pattern, SandboxExecutionService boundary, no-silent-fallback decision)
- **docs/context-packs/ updated:** n/a — no architecture.md section-anchor changes that would invalidate existing packs.
- **references/test-gate-policy.md updated:** n/a — test posture unchanged (pure-tests-only + 5 new CI grep gates added per spec, not a policy change).
- **references/spec-review-directional-signals.md updated:** n/a — not a spec-review session.
- **.claude/FRAMEWORK_VERSION + .claude/CHANGELOG.md updated:** n/a — no framework-level changes; this is repo-specific feature work.

Doc-sync gate: **PASS** (all 13 registered docs have explicit verdicts; 4 updated + 9 n/a with rationale).

### Known architectural follow-up (must be addressed by a subsequent build)

**SANDBOX-B4 — Ceiling-monitor + wall-clock-kill jobs never enqueued.** The current `provider.runTask` implementation in `e2bSandbox` / `localDockerSandbox` is synchronous (start + run + return-on-terminal in one call). This means:
- Pre-start monitor enqueue (the spec's intent) would deadlock — the monitor would find the row still `pending` and never trigger.
- Post-start enqueue (which COULD work after the row transitions to `running`) doesn't currently happen because the row goes `pending → harvesting` directly (skipping `running` entirely).

**Real fix requires:** Refactor provider interface from `runTask(input): Promise<SandboxRunTaskOutput>` to async start/poll/terminate seams:
- `startTask(input): Promise<{ providerSandboxId }>`
- `getProviderSignal(providerSandboxId): Promise<ProviderSignal | null>`
- `terminateTask(providerSandboxId): Promise<void>`
- `readFiles(providerSandboxId, path): Promise<ProviderFileResult>` (called by harvest)

Then `sandboxExecutionService.runTask` becomes a state-machine orchestrator that:
1. Calls `provider.startTask` → row goes pending → running
2. Enqueues `sandboxCeilingMonitorJob` (singleton on sandbox_execution_id)
3. Enqueues `sandboxWallClockKillJob` (one-shot, scheduled with `startAfter = wallClockMs + buffer`)
4. Polls `provider.getProviderSignal` until terminal OR ceiling-monitor terminates
5. Transitions row to `harvesting` and calls `runHarvest`

Until this refactor lands, wall-clock + cost ceiling enforcement is provider-side only (best-effort). Tenant code can run beyond spec §10.1 30-minute hard cap if e2b SDK timeout is bypassed or misbehaves. Resource-abuse vector acknowledged.

**Acceptance for V1 ship:** documented in this handoff + `tasks/todo.md` SANDBOX-ADV-5.1. Operator and Phase 3 chatgpt-pr-review decide whether to ship V1 with this limitation or block on the architectural follow-up.

### Known issues to surface at spec-conformance review

1. **verify-sandbox-minimum-events.sh fails** — providers stub SDK calls; `sandbox_start`/`sandbox_start_failed` events not emitted by C5's service layer. Likely fix: extend C5's runTask to emit these telemetry events at the appropriate state transitions.
2. **MAX_LOG_LINE_BYTES (spec §20.8)** intentionally deferred from DB CHECK to service-layer truncation in C7.
3. **Pre-existing branch typecheck errors** — `@react-pdf/renderer` missing types in 2 report files. Confirmed pre-existing on branch since before Phase 2 started.
4. **e2b SDK stub** — real installation deferred post-merge pending account provisioning.
5. **SANDBOX-DEF-EGRESS-MECH** — decision deferred to actual SDK install (audit-row schema unaffected by mechanism choice).
6. **classifyExecutionClass currently routes all V1 DevTaskPayload variants to `worker_trusted`** — sandbox branch is structurally complete but unreachable until future payload variants add an explicit executionClass field.

---

## Phase 3 — FINALISATION (queued)

Awaits Phase 2 completion.
