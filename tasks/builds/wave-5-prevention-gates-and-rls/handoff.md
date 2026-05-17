# Wave 5 — Prevention Gates + Full Service-Tier RLS Migration — Phase 2 Handoff

**Branch:** `claude/wave-5-prevention-gates-and-rls`
**Slug:** `wave-5-prevention-gates-and-rls`
**Spec:** `tasks/builds/wave-5-prevention-gates-and-rls/spec.md` (LOCKED)
**Plan:** `tasks/builds/wave-5-prevention-gates-and-rls/plan.md`
**Task class:** Major
**PR:** https://github.com/michaelhazza/automation-v1/pull/335

---

## Table of Contents
- Phase 1 (SPEC)
- Phase 2 (BUILD)
- Per-reviewer verdicts
- Fix-loop iterations
- Doc-sync gate
- Migration summary
- P2 gate state
- Prevention gate verdicts
- Open issues for finalisation
- Phase 3 — next

---

## Phase 1 (SPEC) — complete

- spec-reviewer (Codex): 5 iterations, final report committed
- chatgpt-spec-review (manual): 2 rounds — 3 findings applied in round 1, APPROVED in round 2
- Spec status: LOCKED

---

## Phase 2 (BUILD) — complete

**Chunks built:** 18 (Chunk 0 inventory + Chunks 1–17 per plan)
**Branch HEAD at handoff:** `b705e85a`
**G1 attempts (per chunk):** all chunks 1 attempt; Chunk 14 typecheck retried once
**G2 attempts:** 1 (lint 0 errors, typecheck clean, build:server clean)

### Per-reviewer verdicts

| Reviewer | Verdict | Log |
|---|---|---|
| spec-conformance | CONFORMANT (21 PASS / 1 OUT_OF_SCOPE — PP-SK1 deferred per spec §13) | `tasks/review-logs/spec-conformance-log-wave-5-prevention-gates-and-rls-2026-05-17T01-02-20Z.md` |
| adversarial-reviewer | HOLES_FOUND (2 confirmed-holes — both resolved in fix-loop) | `tasks/review-logs/adversarial-review-log-wave-5-prevention-gates-and-rls-2026-05-17T01-20-00Z.md` |
| pr-reviewer R1 | CHANGES_REQUESTED (6 should-fix) | `tasks/review-logs/pr-review-log-wave-5-prevention-gates-and-rls-r1-2026-05-17T01-30-00Z.md` |
| pr-reviewer R2 | APPROVED (3 doc-sync should-fix — addressed) | `tasks/review-logs/pr-review-log-wave-5-prevention-gates-and-rls-r2-2026-05-17T01-50-00Z.md` |
| reality-checker | READY (8/8 spec §9 criteria verified) | `tasks/review-logs/reality-check-log-wave-5-prevention-gates-and-rls-2026-05-17T01-40-00Z.md` |
| dual-reviewer (Codex) | APPROVED (3 iterations — 2 bug classes caught + fixed) | `tasks/review-logs/dual-review-log-wave-5-prevention-gates-and-rls-2026-05-17T02-24-00Z.md` |
| pr-reviewer R3 (post-dual) | APPROVED (2 non-blocking should-fix routed to todo) | `tasks/review-logs/pr-review-log-wave-5-prevention-gates-and-rls-r3-2026-05-17T03-15-00Z.md` |

### Fix-loop iterations

- **R1:** addressed 6 pr-reviewer should-fixes + 2 adversarial confirmed-holes in commit `8b1011ff`. Re-seeded P2 baseline 2153→0; pruned per-file baseline; migrated llmUsageService admin reads to `withAdminConnection + SET LOCAL ROLE admin_role`; added rationale to bare guard-ignore directives; corrected adminDbConnection.ts JSDoc; restored knip candidate dead-code visibility via tasks/todo.md; extracted PP-SK1 pure logic + 15-test Vitest suite.
- **R2:** addressed 3 doc-sync should-fixes in commit `b1735f76`. Corrected JSDoc on AdminConnectionOptions; updated stale baseline comment; persisted review logs.
- **R3 (post-dual-reviewer):** dual-reviewer caught 2 bug classes — boot-time `missing_org_context` in `agentScheduleService.initialize()`, and dual-GUC RLS regression on 6 tables. 8 service files fixed in commit `baa892f9`. pr-reviewer R3 APPROVED.

### REVIEW_GAP entries

None.

### Doc-sync gate

| Doc | Verdict |
|---|---|
| architecture.md | no — checked getOrgScopedDb, withAdminConnection, withOrgTx, RLS_PROTECTED_TABLES, PP-SK1 references; existing references remain accurate; no new patterns or primitives introduced (this build mass-applied existing primitives) |
| docs/capabilities.md | n/a: internal refactor with no capability surface change |
| docs/integration-reference.md | no — checked calendar, slack, crm, ghl, integration; no scope/status/skill/OAuth provider/MCP preset/capability slug/alias changes — only internal db-handle migration |
| CLAUDE.md / DEVELOPMENT_GUIDELINES.md | no — checked getOrgScopedDb, withAdminConnection, guard-ignore, PP-SK1, verify-skill-registry-alignment; §2 and §8.40 already document the required patterns; the tracked-exception note for tick.ts/watchdog.ts already present |
| CONTRIBUTING.md | n/a — no lint-suppression policy or // reason: comment-format changes |
| docs/frontend-design-principles.md | n/a — no UI / frontend / hard-rule / worked-example changes |
| KNOWLEDGE.md | yes (2 entries) — appended "[2026-05-17] Pattern — Service-tier migrations must verify dual-GUC tables and boot paths separately" and "[2026-05-17] Pattern — Knip ignore-list silencing is not triage" |
| docs/spec-context.md | n/a — feature pipeline, not spec-review session |
| docs/decisions/ | no — this build implements existing primitives at scale; no new architectural choice locked |
| docs/context-packs/ | n/a — no architecture.md section anchors changed |
| references/test-gate-policy.md | no — no umbrella-command change; new PP-SK1 pure helper test follows existing per-helper vitest pattern |
| references/spec-review-directional-signals.md | n/a — spec-reviewer not surfacing repeat signals |
| docs/incident-response.md | n/a — no SEV / oncall / timeline-log / post-mortem changes |
| docs/testing-transition-plan.md | n/a — no migration-trigger or phasing changes |
| .claude/FRAMEWORK_VERSION + CHANGELOG.md | n/a — no agent-fleet or conventions-layer change |
| scripts/verify-* gates | yes — added scripts/verify-skill-registry-alignment.sh (PP-SK1, HELD pending Session K); promoted scripts/verify-duplicate-blocks.sh (PP-DUP1) to exit-1 error mode; cleared PP-SK2 baseline; re-seeded P2 baseline in scripts/guard-baselines.json |

### Migration summary

- **Files reviewed:** 332 (server/services/ files importing db, including tests)
- **Production service files with raw-db callsites (pre-migration):** 190
- **Raw-`db` callsites found:** 586
- **Tier 1 callsites migrated:** ~410 (across ~130 files)
- **Tier 1 callsites blocked:** 0 — F3/F4/F7 closeable
- **Tier 2 callsites migrated to `withAdminConnection`:** ~90 across ~40 files
- **Tier 2 residue annotated with guard-ignore:** 148 across 16 files
- **Tier 3 callsites (already clean):** 116+ files

### P2 gate state

- Pre-migration numeric baseline: 2153
- Post-migration numeric baseline: 0 (re-seeded 2026-05-17)
- P2 gate result: 1178 files scanned, 0 violations found
- Per-file baseline: header-only (pruned)
- Ratchet: enforceable; CI sets `GUARD_BASELINE=true`

### Prevention gate verdicts

| Gate | Script | Baseline | Exit mode | State |
|---|---|---|---|---|
| PP-CD1 | verify-no-new-cycles.sh | cycle-count:0 | error | VERIFIED |
| PP-DUP1 | verify-duplicate-blocks.sh | clone-count:9334 | error | RE-SEEDED + PROMOTED |
| PP-SK1 | verify-skill-registry-alignment.sh | (held — no baseline) | (not yet wired) | SCRIPT AUTHORED — HELD pending Session K W4AA-DEBT-1 |
| PP-SK2 | verify-universal-skill-sync.sh | header-only (cleared) | error | RESOLVED (source alignment applied) |
| PP-FE2 | verify-frontend-design-budget.sh | empty | error | VERIFIED (no extension needed) |
| PP-MC2 | verify-critical-path-coverage.sh | (schema gate, no baseline) | error | VERIFIED (already closed:pr:332) |

### Open issues for finalisation

- **PP-SK1 follow-up:** when Session K W4AA-DEBT-1 lands on main, a separate PR seeds PP-SK1 baseline at `mismatch-count:0` and wires it. Does NOT block this PR.
- **Routed to tasks/todo.md § Wave 5 follow-ups:**
  - 138 candidate dead-code files (knip flag triage)
  - GHL location-scoped webhook conditional HMAC verification (pre-existing)
  - X-Organisation-Id system_admin trust validation (pre-existing)
  - Manual `db.transaction + withOrgTx` third-entrypoint pattern recognition (githubWebhookService, ghlAgencyOauthService)
  - pg-boss schedule call inside per-org db.transaction atomicity (R3 SF1)
  - Regression test for boot-path `missing_org_context` (R3 SF2)
  - Defence-in-depth predicate sweep on dual-GUC tables (R3 C2)

### G2 / G3 state at Phase 2 close

- `npm run lint` → exits 0 (0 errors, 881 warnings pre-existing)
- `npm run typecheck` → exits 0
- `npm run build:server` → exits 0
- `bash scripts/verify-with-org-tx-or-scoped-db.sh` → exits 0 (1178 files / 0 violations)

---

## Phase 3 — next

Run finalisation-coordinator: S2 sync + G4 regression guard + ChatGPT PR review manual rounds + KNOWLEDGE.md sweep + tasks/todo.md cleanup + Capability Registration (verdict: `n/a: internal refactor with no capability surface change`) + Compound Learning Feedback + MERGE_READY.

The user requested STOP at chatgpt-pr-review manual rounds.

---

## Phase 3 (FINALISATION) — complete

**PR number:** #335
**chatgpt-pr-review log:** tasks/review-logs/chatgpt-pr-review-wave-5-prevention-gates-and-rls-2026-05-17T02-56-35Z.md (Verdict: APPROVED — 2 rounds, R1 4 findings triaged, R2 verify-clean)
**spec_deviations reviewed:** n/a (none recorded in Phase 2)

**S2 round 2:** absorbed PR #337 (`wave-5-session-m` LAEL Phase 1+2 + Hermes Tier 1 H1) via merge commit `37fb1550`. 3 known-shape conflicts auto-resolved; 4 code-area conflicts manually resolved (scripts/guard-baselines.json, server/services/memoryBlockService.ts, server/services/skillExecutor/pipeline.ts, server/services/workspaceMemoryService/read.ts) combining wave-5's `getOrgScopedDb` migration with main's LAEL emissions / audit-row plumbing.

**G4 regression guard (post-S2-round-2):** PASS — lint exit 0 (0 errors, 882 warnings — pre-existing), typecheck exit 0.

**Doc-sync sweep verdicts (16 docs):**
- architecture.md — yes (Service-layer access patterns rule 4: extended to make boot-time per-org sweeps explicit; named `definePruneJob.ts` + `agentScheduleService.registerAllOptimiserSchedules` as canonical precedents — closes R1 F2 doc-tightening)
- docs/capabilities.md — **§6.2.1 verdict: `n/a: internal refactor with no capability surface change`** (no Asset Register row created/mutated/split/merged; build mass-applies existing primitives only)
- docs/integration-reference.md — no (checked calendar/slack/crm/ghl/integration grep terms; no scope/status/skill/OAuth provider/MCP preset/capability slug/alias changes)
- CLAUDE.md / DEVELOPMENT_GUIDELINES.md — no (§2 service-layer access patterns and §8.40 RLS contract compliance already document the required patterns; the architecture.md rule 4 extension supersedes any per-doc embedding)
- CONTRIBUTING.md — n/a (no lint-suppression policy or comment-format changes)
- docs/frontend-design-principles.md — n/a (no UI / frontend / hard-rule / worked-example changes)
- KNOWLEDGE.md — yes (3 entries total — 2 from Phase 2: "Service-tier migrations must verify dual-GUC tables and boot paths separately" + "Knip ignore-list silencing is not triage"; 1 extension from R1 F3: the entry-list variant of the knip-silencing anti-pattern)
- docs/spec-context.md — n/a (feature pipeline, not spec-review session)
- docs/decisions/ — no (this build implements existing primitives at scale; no new architectural choice locked)
- docs/context-packs/ — n/a (no architecture.md section anchors changed)
- references/test-gate-policy.md — no (no umbrella-command change; PP-SK1 pure helper test follows existing per-helper vitest pattern)
- references/spec-review-directional-signals.md — n/a (spec-reviewer not surfacing repeat signals)
- docs/incident-response.md — n/a (no SEV / oncall / timeline-log / post-mortem changes)
- docs/testing-transition-plan.md — n/a (no migration-trigger or phasing changes)
- .claude/FRAMEWORK_VERSION + CHANGELOG.md — n/a (no agent-fleet or conventions-layer change)
- scripts/verify-* gates — yes (added `verify-skill-registry-alignment.sh` HELD pending Session K; promoted `verify-duplicate-blocks.sh` to exit-1 error mode; cleared PP-SK2 baseline; re-seeded P2 baseline `with-org-tx-or-scoped-db=0` in `guard-baselines.json`)

**KNOWLEDGE.md entries added:** 3 (2 Phase 2 + 1 Phase 3 extension paragraph)
**tasks/todo.md items removed/closed:** 8 (PP-CD1, PP-DUP1, PP-SK2, PP-FE2, knip-306, F3, F4, F7 — placeholder `pr:tbd-wave-5` rewritten to `pr:335`). PP-SK1 remains `status:open` per spec §13 deferral; PP-MC2 already `pr:332`.
**Compound Learning Feedback proposals emitted:** 3 (see `tasks/builds/wave-5-prevention-gates-and-rls/progress.md` § "Phase 3 — Compound Learning Feedback proposals"; targets: regression-test, agent-instruction, spec-authoring-instructions)
**ready-to-merge label applied at:** 2026-05-17T03:41:40Z
