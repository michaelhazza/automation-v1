# tasks/todo.md — Triage Inventory (Chunk 13.A)

**Captured:** 2026-05-13
**Source:** `tasks/todo.md` (4,408 lines, read end-to-end)
**Branch:** `codebase-health` worktree
**Method:** Every deferred item (open `- [ ]` checkbox OR labelled "deferred" / "open" / advisory) classified into SHIP / ARCHIVE / ACCEPT. Items already marked `[x]` / CLOSED / RESOLVED / DONE in the source file are NOT inventoried here (they will be bulk-archived at Chunk 13.B time). Items rolled up at section granularity where every item shares the same routing.

## Table of contents

1. Summary tallies
2. ACCEPT — promotions (ADR + KNOWLEDGE.md + architecture.md)
3. SHIP — items that warrant a future spec-stub slug
4. ARCHIVE — stale, superseded, or no-longer-relevant items
5. Special-handling notes

---

## 1. Summary tallies

| End-state | Count (items / rolled-up sections) | Destination |
|---|---|---|
| SHIP | 38 stubs | new `tasks/builds/<slug>/spec.md` stubs (one paragraph each) |
| ARCHIVE | ~142 items | `tasks/todo-archive/2026-Q2.md` with one-line rationale |
| ACCEPT | 9 promotions | `architecture.md` / `KNOWLEDGE.md` / new ADRs |
| **Total deferred items inventoried** | **~189 (after rolling up related polish items)** | |

**ADR candidates:** 5 within cap (slots 0017-0021). 4 additional ACCEPT items routed to KNOWLEDGE.md or architecture.md sections.

**Counting note:** Several sections contain 5-15 related "non-blocking polish" items that all share one destination (ARCHIVE the section with one rationale: "PR-specific polish, not scope creep, not security"). Those are counted as 1 inventory row but the underlying source has many bullets. Single-item rows in this inventory map 1:1 to source items.

## 2. ACCEPT — promotions to architecture.md / KNOWLEDGE.md / new ADRs

### 2.1 ADR candidates (≤ 5 cap, slots 0017-0021)

| item id / heading | domain | end-state | one-line rationale | destination file |
|---|---|---|---|---|
| AKR-EXT-1 — ADR for retrieval/ranker architecture | retrieval / agents | ACCEPT-ADR | Spec vs v1-simplified ranker is the highest-leverage open decision; 5+ deferred items collapse to it. Lock the contract before further retrieval work. | `docs/decisions/0017-retrieval-ranker-v1-simplified.md` (new) |
| CONSOL-FND-DEF-5 — Central overlay manager / stack ownership | frontend | ACCEPT-ADR | Modal/Drawer coordination is convention-driven today; a central manager is a durable architectural choice future consolidation specs will inherit. | `docs/decisions/0018-overlay-stack-ownership.md` (new) |
| CHATGPT-R1-RISK-1 + R3-RISK-1 — Job orchestration contract + review-loop state-machine | workflow-engine / tooling | ACCEPT-ADR | Cross-cutting durable shapes (`JobResult` discriminated union + review-loop status enum). Combined ADR locks the contract before more callers land. | `docs/decisions/0019-job-result-and-review-loop-contracts.md` (new) |
| Test gate policy — "tests live under `__tests__/`, Vitest only, `.js` relative imports under nodenext" | tests / tooling | ACCEPT-ADR | Already enforced by `verify-test-quality.sh` + CLAUDE.md prose; ADR makes the rationale durable. (Sources: TI-001/002/003/005-008 + framework-standalone-repo deferred items + existing CLAUDE.md test-gate policy.) | `docs/decisions/0020-test-conventions-vitest-and-test-folder.md` (new) |
| Workflows V1 → V2 contract — depth cap, lineage-cost budget, two-step migration | workflow-engine | ACCEPT-ADR | Multiple deferrals (W1-F10, REQ 15-7/15-8, R2-4 task_id NOT NULL) converge on "lock the V1→V2 boundary contract before V2 starts". | `docs/decisions/0021-workflows-v1-v2-boundary.md` (new) |

### 2.2 Non-ADR ACCEPT items (promote to KNOWLEDGE.md or architecture.md sections)

| item id / heading | domain | end-state | one-line rationale | destination file |
|---|---|---|---|---|
| Pattern — "Suppression is success" for single-writer event emitters (line 434, codified elsewhere including AR-3.1) | workflow-engine | ACCEPT-KNOWLEDGE | Already partially in `architecture.md § Home dashboard live reactivity`; promote to a first-class KNOWLEDGE.md entry + a `DEVELOPMENT_GUIDELINES.md §8` rule. ChatGPT flagged repeatedly; ADR 0013 exists but lint guard / KNOWLEDGE cross-ref missing. | `KNOWLEDGE.md` (append entry); update `ADR 0013` references |
| Pattern — "Closed-enum service-boundary mapping for typed error.code" (CONSOL-GOV-DEF-9 closed note, line 3249) | routes/services | ACCEPT-KNOWLEDGE | Reusable mapping pattern surfaced during consolidation-govern; partially in KNOWLEDGE.md; ensure cross-link from architecture.md service-layer section. | `KNOWLEDGE.md` (verify entry present); cross-link from `architecture.md § Service layer` |
| Architecture rule — agent-execution-events FK ON DELETE policy (cascade vs set null for pointer columns) | schema / migrations | ACCEPT-ARCH | Builder system prompt § Step 3 gate #4 flags this; lock the policy in architecture.md so every migration author follows it. | `architecture.md § Schema invariants` |
| Architecture rule — `withOrgTx({ tx: db })` fakes ALS context (KNOWLEDGE 2026-05-05 entry already shipped, line 2989; OSI-DEF-1 same pattern line 4203) | auth | ACCEPT-ARCH | Already in KNOWLEDGE.md; promote a one-line pointer to `architecture.md § Layer 4` so future builders find it via the canonical doc. | `architecture.md § Layer 4` cross-link |

## 3. SHIP — items that warrant a future spec-stub slug

Each row below lands as `tasks/builds/<slug>/spec.md` (one-paragraph stub naming the trigger and scope).

| item id / heading | domain | end-state | one-line rationale | destination slug |
|---|---|---|---|---|
| LAEL-P1-1 — llmRouter llm.requested/completed + payload writer | agents / observability | SHIP | Highest-leverage open LAEL deferral. Without it the Live Log timeline has no "doing" phase. | `lael-llm-request-emission` |
| LAEL-P1-2 — Remaining P1 emission sites | agents / observability | SHIP | Six emission sites named in spec §5.3, all queued for the same chunk. | `lael-p1-emissions` |
| LAEL-P2 — Edit audit trail | agents / observability | SHIP | Migration 0194 + new table + UI banner; named in §8 Phase 2. | `lael-edit-audit-trail` |
| LAEL-P3 — Retention tiering | agents / observability | SHIP | Migration 0193 + archive worker; named in §8 Phase 3. | `lael-retention-tiering` |
| External Call Safety Contract abstraction (line 364) | workflow-engine | SHIP | Cross-feature reusable primitive; named explicitly as "no spec yet". | `external-call-safety-contract` |
| Workflows V1 follow-ups — Chunk 9-15 conformance gaps (REQ 9-9 / 9-10 / 9-11 / 9-12 / 9-14 / 11-extra / 12-11 / 13-9 / 14b-extra / 15-7 / 15-8) | workflow-engine | SHIP | 11 inter-related Phase 2 gaps need one consolidated build, not 11 micro-fixes. | `workflows-v1-phase-2-gaps` |
| Trust Verification Layer follow-ups — TVL-DG-2/4/5/6/7/8/9, TVL-AM-1/2, AR-TVL-2/4 | tests / agents | SHIP | Bench/scorecard contract divergence is structural; needs a small consolidation pass not piecemeal fixes. | `tvl-contract-alignment` |
| Auto-Knowledge-Retrieval ranker realignment (AKR-CONF-1/2/5/6/9, PR-REV-B2/B3/S2/S4/S6) | retrieval | SHIP | All depend on the AKR-EXT-1 ADR decision (see ACCEPT block); once ADR locks direction, this is a focused build. | `auto-knowledge-retrieval-v2-ranker` |
| Operator Session Identity follow-ups (OSI-DEF-1 through OSI-DEF-13) | auth | SHIP | 13 items deferred from the V1 ship; cohesive enough to warrant one Phase 2 spec. | `operator-session-identity-v2` |
| Sandbox Isolation critical-path completion (REQ #11, #28, #29, #6, #20, #31, #35, #36, #55, #57; SANDBOX-ADV-1.1, 4.1, 5.1) | workflow-engine / tooling | SHIP | Single coherent "make sandbox actually work end-to-end" build. | `sandbox-isolation-mvp` |
| Phase-1 Showcase MVPs critical-path (REQ #4 / 5 / 27 / 40 / 41 / 49 / 52) | agents | SHIP | 7 wiring gaps that all unblock end-to-end functioning of the Support Agent. | `phase-1-showcase-mvps-wiring` |
| Support Desk Canonical follow-ups (SDC-OVERRIDE-1 + REQ #45 / #49 / #50 / #52a / #55 / #56) | agents / canonical-data | SHIP | High-severity collision-window check missing + action-attempts ledger never wired. | `support-desk-canonical-phase-2` |
| Workspace email & calendar Phase E (D15 + Phase E pre-reqs still open) | integrations / auth | SHIP | D15 needs CI infra; rest tied to Phase E plan. | `workspace-email-phase-e` |
| GHL OAuth + auto-onboard hardening (multiple PR #254 + pre-launch entries) | auth / integrations | SHIP | Several items converge on "GHL agency OAuth + auto-start onboarding": agent-triggered resume, cluster-safe state store, slug collision tier, cascade soft-delete. | `ghl-oauth-hardening-v2` |
| Test infra TI-006 / 007 / 008 (canonical UUID, conventions doc, non-superuser CI role) | tests / tooling | SHIP | All three named with concrete effort estimates; one short build. | `integration-test-infra-hardening` |
| Verify-script consolidation + index README (CHATGPT-R1-PH3-3, CHATGPT-R1-PH3-2, GATES-2026-04-26-2, scripts/README) | tooling | SHIP | 4+ items converge on "make the verify-*.sh fleet self-documenting and consistent". | `verify-scripts-fleet-hygiene` |
| State-machine guards extension (CHATGPT-PR211-F6 remaining sites) | workflow-engine | SHIP | Helper exists; the work is extending coverage to ~5-7 remaining sites + tightening transition tables. | `state-machine-guard-coverage` |
| Run-debugger view (CHATGPT-PR211-R4-RUN-DEBUGGER-VIEW, line 1151) | observability | SHIP | New product surface explicitly named "next bottleneck is operability" by reviewer; warrants its own spec. | `run-debugger-view` |
| pdf-parse dependency + PDF support hardening (REQ #C12 line 1965) | tests / dependencies | SHIP | Single dependency-add + spec amendment; needs HITL approval. | `pdf-parse-dependency-addition` |
| Code-graph refactor split (line 1377) | tooling | SHIP | 1,113-line file; split into extractor/cache/watcher. Concrete refactor with clear shape. | `code-graph-module-split` |
| Mission Control parallel-build parser support (PARALLEL-BUILD-DASHBOARD-VISIBILITY, line 3131) | tooling | SHIP | Single tool file extension; clean scope. | `mission-control-parallel-builds` |
| Lint-typecheck CI concurrency guard + Eslint disable CI gate (CGPT P2.1-R3 + lint-typecheck deferred concurrency) | tooling | SHIP | Two CI-hygiene items that ship together. | `ci-hygiene-concurrency-and-eslint-disable-gate` |
| Subaccount-optimiser severity drift (REQ #B1-B14) | agents | SHIP | 14 spec-vs-implementation drifts in one section; one rationalisation pass. | `subaccount-optimiser-severity-alignment` |
| Subaccount-optimiser orchestrator wiring (REQ #B7, OPS orphan schedules, DG-4, DG-6) | agents / cron | SHIP | Critical wiring gap (`runOptimiser` never invoked) + orphan schedules + UTC timezone. | `subaccount-optimiser-wiring-fix` |
| workspaceMemoryService vitest cleanup (TI-005 original tail) | tests | SHIP | Module-level `await client.end()` runs at module load; converted partially but two files remain. | `workspace-memory-service-vitest-cleanup` |
| Code-intel watcher Phase 1 hardening (cache/shard race + topology-change discrimination + alias re-resolution) | tooling | SHIP | Three reviewer-flagged Phase 1 items that ship together. | `code-intel-watcher-phase-1` |
| Cached-context isolation enforcement (CHATGPT-PR211-F2a + F2b) | workflow-engine / RLS | SHIP | Spec § 8.7 locks the design; this is the enforcement-primitive build for read AND write. | `cached-context-isolation-guards` |
| Quality-signals taxonomy + structured correction shape (CHATGPT-R2-RISK-1, R1-RISK-2) | agents | SHIP | Taxonomy doc + structured correction shape; cohesive scope. | `quality-signals-taxonomy` |
| Universal Brief follow-ups (S2 / S3 / S4 / S6, N1-N6, DR1, DR3) | brief / orchestrator | SHIP | Coherent finishing pass on Universal Brief; mostly mechanical with a few design decisions. | `universal-brief-followups` |
| Riley Observations Phase 2 (W1-29 + W1-43 / 44 + W1-52 / 53 + W1-38) | workflow-engine | SHIP | Four deferred items in the riley-observations build that share a Phase 2 framing. | `riley-observations-phase-2` |
| Paperclip-hierarchy chunk 4a tests + REQ #C4a-6 return-shape contract | agents | SHIP | 6 missing tests + 1 contract decision; one focused chunk. | `paperclip-hierarchy-test-coverage` |
| Spec coverage + drift detection meta-tooling (PR #174 deferred items, line 561) | tooling | SHIP | Three related "build the meta-tooling around specs" features. | `spec-coverage-and-drift-tooling` |
| Hermes Tier 2 follow-ups (§6.8 errorMessage gap + H1/H2/H3) | agents | SHIP | Four related items; clean Tier 2 scope. | `hermes-tier-2-followups` |
| Soft-delete join gaps follow-up (fix-logical-deletes-2, line 1523) | schema / services | SHIP | 24 explicit join sites with deletedAt missing — already inventoried; one focused build. | `fix-logical-deletes-2` |
| Canonical-registry 3-set drift test upgrade (C3 metadata follow-up, line 1035) | tests / canonical | SHIP | Named test upgrade + 2-set → 3-set comparison. | `canonical-registry-three-set-drift-test` |
| Brief creation unify endpoints (PR #233 F1 / F5 / F6 / F7 / F8 / F15) | brief / routes | SHIP | Six related architectural items for `/api/briefs` + `/api/session/message`. | `brief-creation-unify` |
| Workflows V2 strategic follow-ups (R3-RISK-2, R2-RISK-2, R1-RISK-5) | workflow-engine / observability | SHIP | Three long-horizon items that need spec stubs to anchor future thinking. | `workflows-v2-strategic-followups` |
| Workflows V1 runtime quotas (M1-M4, F21, F23, F24, F38, F40, F42 from workflows-dev-spec) | workflow-engine | SHIP | 10 architect-time quotas, all bundled per spec; needs one decision-making spec. | `workflows-v1-runtime-quotas` |
| BYOB / scheduler claim-pattern (D.6 advisory-lock refactor, line 954) | tooling / scheduler | SHIP | Reviewer-flagged refactor — wrap `tick()` differently for shorter held-lock window. Its own spec under `tasks/builds/scheduler-claim-pattern`. | `scheduler-claim-pattern` |

## 4. ARCHIVE — stale, superseded, or no-longer-relevant items

Routed to `tasks/todo-archive/2026-Q2.md` with one-line rationale. Grouped by source section for a readable archive.

### 4.1 Pre-testing audit (lines 1-66) — historical pre-launch context

| section | rationale |
|---|---|
| Items #1-11 (Critical Findings) | ARCHIVE — All shipped or routed to specific later phases; pre-test-hardening series covers the residue. |
| Items #12-18 (Important Findings) | ARCHIVE — Same. Pre-launch + pre-test-hardening sprints absorbed the remainder. |
| Items #19-27 (Security Findings) | ARCHIVE — Each row carries `[CLOSED]` or routes to a named follow-on spec already shipped. |
| "Noted" residual items | ARCHIVE — Each is either fully addressed by pre-test-hardening or rolled into the routes/cascade backlog (SHIP `fix-logical-deletes-2`). |

### 4.2 Spec-reviewer auto-decided items (multiple sections)

| section | rationale |
|---|---|
| Riley Observations 8 AUTO-DECIDED items (lines 610-617) | ARCHIVE — "human to confirm spec mechanics"; all 2+ months old; accept as final unless re-surfaced. |
| Hierarchical-delegation 4 AUTO-DECIDED items (lines 629-633) | ARCHIVE — Spec locked; decisions implicitly accepted by merge. |
| CRM Query Planner spec self-contradiction REQ #64 (line 518) | ARCHIVE — One-line spec fix the next CRM-touching PR can fold in. |
| Subaccount-optimiser F2-AD-1/2/3 + F8/10/14, R2-F3/F7, R3-F3/F4/F7, R4-F5 | ARCHIVE — "Reconsider on telemetry trigger" items; watchlist-only. |
| Workflows-dev-spec D-W1-C2/C3/I6/I7/R2/R4 (lines 2089-2131) | ARCHIVE — Auto-decided spec changes accepted by merge; no action. |
| Dev-pipeline-coordinators 3 auto-decided + 4 spec-review items (lines 2287-2331) | ARCHIVE — All addressed via spec text edits or accepted as locked decisions. |
| Synthetos-foundation-refactor R-G + SCD-1 (lines 3727-3736) | ARCHIVE — Naming polish, no behaviour impact. |
| PSM-D1 / PSM-D2 (phase-1-showcase-mvps spec review, lines 3795-3805) | ARCHIVE — Auto-rejected per framing; spec locked. |
| Sandbox-isolation D-EGRESS-MECH + F1 (lines 4279-4295) | ARCHIVE — Operator runbook tasks ("when e2b account provisioned"), not deferred items. |

### 4.3 Per-PR polish items — bulk archive

(Each row here represents 3-15 underlying ARCHIVE-class items from one PR's deferred section.)

| section | rationale |
|---|---|
| Hermes Tier 1 reviewer N1-N8 items | ARCHIVE — Minor polish on closed work. |
| Universal Brief CGF1 / CGF4b / CGF6 (lines 569-575) | ARCHIVE — Round-2/3 work no longer relevant given subsequent feature evolution. |
| PR #185 skill-analyser items (lines 769-776) | ARCHIVE — Bug-fix PR follow-ups, low-value polish. |
| PR #226 monitoring-logging N1-N2 + R2 deferred (lines 426-429) | ARCHIVE — Small CI hygiene items folded into SHIP `verify-scripts-fleet-hygiene`. |
| PR #239 vitest-migration F1-F6 | ARCHIVE — All closed by TI-005 brief; archived as historical context. |
| PR #244 tier-1-ui-uplift R3-R5 items (lines 397-406) | ARCHIVE — UX polish on shipped UI. |
| PR #247 R1-F3a/F3b/F4/F6 (lines 391-395) | ARCHIVE — Round-1 review minutiae. |
| PR #250 F9/F10 + AC-ADV-1 through AC-ADV-11 + AC-CGPT-1/2/3 + AC-CGPT-R2-1/2/3/4 + AC-CGPT-R3-1/2/3 | ARCHIVE — Agentic-commerce review tail (~25 items); branch shipped; nothing time-critical. |
| PR #269 F5 + F2-R2 (lines 382-383) | ARCHIVE — Observability polish, gate-on-trigger. |
| PR #270 CONSOL-FND-DEF-1/2/3/4/6 | ARCHIVE — Consolidation-foundation review tail; ship-as-you-touch items. |
| CONSOL-GOV-DEF-2 through DEF-17 (except items already routed to SHIP/ACCEPT) | ARCHIVE — Most are contract-correctness polish that the next consolidation-govern PR picks up. |
| CONSOL-OPER OPER-DEF-1 / 2 / 3 / 4 | ARCHIVE — Operate-page polish; tied to next operate-page sprint. |
| Subaccount-artefacts REQ #43-extension (line 3003) | ARCHIVE — Spec/impl divergence resolvable inline next time the file is touched. |
| Sandbox-isolation SANDBOX-ADV-1.2 / 2.1 / 2.2 / 3.1 / 3.2 / 4.2 / 5.1 / 5.2 / 6.1 + R3-T1 / T2 | ARCHIVE — Advisory-only per reviewer framing; surface on next sandbox build. |
| Sandbox-isolation REQ #6 (line 4321) | ARCHIVE — DB CHECK constraint; defence-in-depth, low-priority. |
| AGW-DEF-1 / 2 / 4 / 5 (line 3563) | ARCHIVE — Agent-workspace polish; next agent-workspace sprint absorbs. |
| Trust-verification AR-TVL-2 | ARCHIVE — Flip validate mode warn → enforce; trivial next-touch fix. |
| Phase-1-showcase-mvps Medium / Low-priority items (REQ #28 - #42 + PR-N1-N7) | ARCHIVE — Polish on shipped MVP; next Phase 1.5 absorbs. |
| Operator-session-identity Chunk 8/9/10 REQ items + chunk-level branch-review N1/N2/N4 | ARCHIVE — V1 limitations explicitly accepted by operator; no urgent action. |
| Workflows V1 Tier C + Tier D (~30 items, lines 2879-2922) | ARCHIVE — All "polish + hardening" or "cosmetic NIT"; explicitly out of scope for the main workflows-v1 build. |
| GHL ChatGPT round 1 F5-F7 + round 2 items (lines 2602-2616) | ARCHIVE — GHL OAuth polish; absorbed by SHIP `ghl-oauth-hardening-v2`. |
| Pre-prod-tenancy F2b/F3 (line 1582) | ARCHIVE — Phase 4 hardening absorbed by pre-launch-phase series. |
| Phase 4 deferred plan items (P3-H4 through P3-L10, lines 932-983, except items absorbed into SHIPs) | ARCHIVE — Explicit Phase 4 backlog from the 2026-04-25 audit; most items ARCHIVE as "trigger-on-incident". |
| Setup-refactor 8 audit items (lines 2653-2678) | ARCHIVE — Long-horizon framework evolution; not blockers. |
| Doc-sync drift items (REQ #69 support-desk-canonical, REQ X-1/X-2/X-3 pre-test-brief-and-ux, others) | ARCHIVE — Fold into next docs-sync sweep; not a dedicated build. |
| ChatGPT Round-3 Phase-3 P1/P2/P3 + R2-PH4-1 (lines 3186-3201) | ARCHIVE — Phase 4 candidates; track on watchlist, no spec yet. |
| Two test-deferred items F14 + F28 (lines 2249-2250) | ARCHIVE — Testing-posture-gated; land when posture changes per spec-context.md. |
| Spec-review backlog items for agentic-commerce / consolidation-foundation / consolidation-govern / pre-launch-phase-3 backlog (lines 2445-2464) | ARCHIVE — All "reconsider when X" items, no urgent spec. |
| Various PR-review N-1 through N-13 items (50+ across many sections) | ARCHIVE — Universal polish-on-touch items. |
| Mission control / dev-mission-control / context-pack-loader follow-ups (lines 1418-1428) | ARCHIVE — Convenience items, all opt-in. |
| Code-graph-health-check ChatGPT R2 + R4 followups (lines 1431-1479) | ARCHIVE — All explicitly tagged "defer; nice to have; not blocking". |
| Pre-test-brief-and-ux REQ S3-8 / S8-10/11/12 / DR2-8/10 / X-1/2/3 / N7-11 (lines 1208-1252) | ARCHIVE — Manual-smoke and tickoff items, mostly process. |
| Pre-test-backend-hardening N1/N2/N3/N4 + S4 + chatgpt R1 items (lines 1304-1348) | ARCHIVE — Fixed-or-noted; no further action. |
| External-doc-references REQ #C1-C11 + D-R1-F5 + D-GPT-1 through D-GPT-5 + D1-D4 (lines 1899-2038) | ARCHIVE — Most are gate-on-trigger; pdf-parse separately routed to SHIP. |
| Code-intel-phase-0 ChatGPT R1 items (lines 1359-1380) | ARCHIVE — Code-intel watcher Phase 1 SHIP covers the important ones; rest are polish. |
| Workflow chunks 5-6 minor cleanup (line 2781) | ARCHIVE — Clearly polish, "non-blocking". |
| Adversarial-reviewer worth-confirming + likely-hole items where not routed to a SHIP | ARCHIVE — Phase 1 advisory non-blocking per playbook §8.2. |
| Crm-query-planner deferred testing + REQ #20 + Finding #20 | ARCHIVE — Integration test deferred until DB harness lands; rest spec-only. |
| Spec-reviewer review of system-monitoring-coverage / agentic-engineering-notes / lint-typecheck-post-merge | ARCHIVE — Auto-decided, all spec mechanics. |
| LAEL-FUTURE-1 through FUTURE-6 (lines 224-258) | ARCHIVE — All explicitly "Not blocking. Trigger to ship: …"; track on a separate watchlist. |
| EBAC-DG-1 + DG-2 (line 3962) | ARCHIVE — Execution-backend-adapter polish. |
| EBAC-ADV-2 + ADV-3 + PR3-S1 | ARCHIVE — Confirm-as-you-touch. |
| Support-desk SDC-PR-1 through SDC-PR-14 | ARCHIVE — Most polish; SDC-PR-3/4/5 absorbed by SHIP `support-desk-canonical-phase-2`. |
| Trust-verification ChatGPT R1-R3 risks 1-5 + R2-RISK-1/2 + R3-RISK-1/2 | ARCHIVE — Long-horizon strategic items, not actionable today; track on a watchlist. |

### 4.4 Bulk-closed historical rows (separate sweep recommended)

| section | rationale |
|---|---|
| All `[x]` / CLOSED / RESOLVED / DONE rows in `tasks/todo.md` (~80 items) | ARCHIVE — Historical record only; recommend a single bulk sweep in Chunk 13.B to move ALL `[x]` rows to `tasks/todo-archive/2026-Q2.md` under a "## Bulk closed items — 2026-05-13 sweep" section, without per-item rationale (rows already carry their own closing context inline). |

## 5. Special-handling notes

### 5.1 Items not classified

None. Every open `- [ ]` row in the source file received a verdict above. Where a section had 5+ related polish items, they were rolled up into one ARCHIVE row pointing at the section header.

### 5.2 Bulk-archive sweep for `[x]` rows

The source file carries ~80 `[x]` rows (DONE/CLOSED/RESOLVED) intermingled with open items. A separate one-shot sweep at Chunk 13.B time should move ALL `[x]` rows to `tasks/todo-archive/2026-Q2.md` under a "## Bulk closed items archive — 2026-05-13 sweep" heading. Source rows already carry their own closing context inline, so no per-item rationale needed. This keeps `tasks/todo.md` as a live-backlog-only document going forward.

### 5.3 ADR cap discipline

5 new ADRs (0017-0021) is exactly at the cap. No "Defer ADR (under cap)" section needed — every ACCEPT promotion either fits in the 5 ADRs or routes to KNOWLEDGE.md / architecture.md.

### 5.4 Editorial routing rule for SHIP stubs

For the SHIP stubs, each gets a one-paragraph spec at `tasks/builds/<slug>/spec.md` per Chunk 13.B's contract. The stub names the trigger condition (when to actually pick up the work) and a one-line scope statement. No deeper specification at stub time — the architect agent expands at activation time.

### 5.5 Total live items after Chunk 13.B sweep (projected)

If Chunk 13.B archives every ARCHIVE row, promotes every ACCEPT row, and creates SHIP stubs for every SHIP row:

- `tasks/todo.md` shrinks from 4,408 → estimated 200-400 lines (only the SHIP stubs' cross-reference links + the residual mid-flight backlog from sprints in progress as of 2026-05-13).
- `tasks/todo-archive/2026-Q2.md` grows by ~142 archived rows + ~80 already-closed historical rows.
- 5 new ADRs ship in `docs/decisions/`.
- 38 new spec-stub slugs land under `tasks/builds/`.
- `architecture.md` gains 3 cross-references; `KNOWLEDGE.md` gains 2 promoted patterns.
