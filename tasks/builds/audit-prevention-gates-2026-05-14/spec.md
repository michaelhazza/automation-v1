# Spec — Audit Prevention Gates (2026-05-14)

| Field | Value |
|---|---|
| Slug | `audit-prevention-gates-2026-05-14` |
| Class | **Major** (cross-cutting; introduces 16 CI gates + 8 doc/knowledge entries) |
| Author | Claude Code (main session, audit-runner findings) |
| Source audit | `tasks/review-logs/codebase-audit-log-pre-v1-lockdown-2026-05-14T04-49-08Z.md` |
| Authorship date | 2026-05-14 |
| Status | Draft — pending spec-reviewer + chatgpt-spec-review |
| Pairs with | `docs/codebase-audit-framework.md` Rule 16; `tasks/todo.md` § Prevention proposals from codebase audit — 2026-05-14 |

---

## Table of Contents

1. Brief
2. Domain model
3. Service contracts — Shared infrastructure
4. Service contracts — Tier 1 (Gates, 16 proposals)
5. Service contracts — Tier 2 (Documentation rules, 4 proposals)
6. Service contracts — Tier 3 (Knowledge / decision, 4 proposals)
7. Data model
8. Integration boundaries
9. Acceptance criteria
10. Out of scope
11. Risks
12. Chunk plan (architect input)
13. Open questions for spec-reviewer / chatgpt-spec-review
14. Linked artefacts

---

## 1. Brief

The 2026-05-14 pre-v1 lockdown audit (24 symptom findings + 4 informational positives across Layer 1 Areas 1-10 and Layer 2 Modules I/J/K/L/M/C) produced 24 Rule 16 prevention proposals. They shift the codebase from symptom-fixing to write-time prevention.

Each individual proposal is small (most are a single shell-script gate + a CI hook + an exemption mechanism). Collectively they are too wide to land via individual PRs — every gate addition is a CI-policy change with operator-review overhead. A single batched build:

1. Lands 16 CI gates as a sequenced set with shared infrastructure (baselines, suppression-annotation grammar, error-message style).
2. Lands 4 documentation rules (Tier 2) in `architecture.md`, `CLAUDE.md`, and `docs/capabilities.md`.
3. Lands 3 `KNOWLEDGE.md` pattern entries (Tier 3 — append-only).
4. Lands 1 ADR (Tier 3 — service-layer extraction policy for routes touching `db/schema/`).

The build closes the 24 prevention-proposal items tagged `[origin:audit:prevention:pre-v1-lockdown:2026-05-14T04-49-08Z]` in `tasks/todo.md`.

**Non-goals.** This spec does NOT fix the audit's symptom findings (tracked separately under `## Deferred from codebase audit — 2026-05-14` in `tasks/todo.md`, e.g. the `supportAgentRoutes.ts` Route → DB breach). It builds the gates that will *prevent* similar findings in future code; existing symptom violations are baselined at gate landing time, with each baseline entry carrying an expiry mechanism.

---

## 2. Domain model

This is an infrastructure / CI build. There is no user-facing domain model. Artefacts produced:

| Artefact class | Where it lives | Count |
|---|---|---|
| Gate script | `scripts/verify-*.sh` (existing convention) | 14 new + 2 tightened |
| Shared gate utility | `scripts/lib/guard-utils.sh` (existing) — extended | 1 |
| Suppression annotation grammar | `// guard-ignore: <guard-id> reason="<rationale>"` (existing pattern, formalised) | 1 spec page |
| Baseline file | `scripts/.gate-baselines/<guard-id>.txt` | 16 (one per gate) |
| CI hook | `.github/workflows/*.yml` (whichever orchestrates `scripts/run-all-gates.sh`) — append new gates | 1 |
| Documentation rule | `CLAUDE.md`, `architecture.md`, `docs/capabilities.md` updates | 4 sections edited |
| Knowledge entry | `KNOWLEDGE.md` (append-only) | 3 patterns |
| ADR | `docs/decisions/00XX-service-layer-extraction-for-routes-touching-db.md` | 1 |

---

## 3. Service contracts — Shared infrastructure

**Suppression annotation grammar (formalise existing pattern).** Every Tier-1 gate accepts an inline suppression of the form:

```
// guard-ignore: <guard-id> reason="<short rationale, ≤ 120 chars>"
```

Co-located on or immediately above the line being suppressed. The reason field is mandatory and free-text; tooling does not parse it but it must be present for diff review.

Legacy T0 shape `// guard-ignore: <guard-id>` (no reason) is deprecated; gates emit `error` severity on T0-only suppressions to drive migration.

ADR shape `// guard-ignore: <guard-id> ADR-<id> <rationale>` is also accepted (introduced by P2's "ADR required for new baseline entries" change).

**Baseline file format (`scripts/.gate-baselines/<guard-id>.txt`).** One violation site per line, format `<relative-path>:<line-number>:<one-line-message>`. Lines beginning with `#` are comments. Each baseline entry MUST carry an `# expires: YYYY-MM-DD` directive on the preceding line. Gates emit `warning` severity on expired entries and `error` after 30 days post-expiry.

This formalises the lesson from the 2026-05-14 audit's `supportAgentRoutes.ts` finding: baselines without expiry become permanent exemptions (see KNOWLEDGE.md Pattern *Gate baselines must expire, not just exist*).

**Common CI exit codes.** All gates use `check_baseline` exit conventions from `scripts/lib/guard-utils.sh`:
- `0` — pass
- `1` — new violation (above baseline)
- `2` — baseline-only violations (warning; pre-existing)
- `3` — expired baseline entry (warning at first run, error after 30 days)

---

## 4. Service contracts — Tier 1 (Gates, 16 proposals)

Each gate lives at `scripts/verify-<id>.sh`, follows the existing `guard-utils.sh` convention, emits violations in the shared format, and is wired into `scripts/run-all-gates.sh`. The spec below names what the gate enforces; the implementation plan (separate `plan.md` produced by the architect) decomposes each into chunks.

| ID | Gate | Enforces | Allow-list / suppression |
|---|---|---|---|
| P1 | `verify-no-missing-deps.sh` | `depcheck --skip-missing=false --json` — every imported package is in `package.json` (any tier) | Per-file `guard-ignore` for dynamic-only optional deps; alternative: declare in `optionalDependencies` |
| P2 | `verify-no-db-in-routes.sh` (tighten existing) | (a) Skip `import type` lines; (b) refuse new baseline entries unless commit body includes `ADR-<id>`; (c) NEW companion `verify-with-org-tx-or-scoped-db.sh` walks every `db.select/insert/update/delete` and confirms enclosing `withOrgTx` or `getOrgScopedDb` scope | `guard-ignore: no-db-in-routes ADR-<id> reason="..."` |
| P3 | `verify-loc-cap.sh` | Per-layer caps from `docs/codebase-audit-framework.md` Area 10; soft-cap = warning, hard-cap = error. Excludes `server/db/schema/*.ts`, `server/config/rlsProtectedTables.ts`, generated files (`*.generated.ts` and files with `// AUTO-GENERATED` header) | ADR with split plan to add file to hard-cap allow-list |
| P4 | `verify-no-silent-catch.sh` | `.catch(() => {})` and empty `catch {}` require `guard-ignore: no-silent-failures` | Per-line annotation |
| P5 | `verify-canonical-retry.sh` | `retryCount`-style loops outside `server/lib/withBackoff.ts` require `guard-ignore: canonical-retry` | Per-loop annotation |
| P6 | `verify-canonical-logger.sh` | `console.(log\|warn\|error)` in `server/services` and `server/routes` requires `guard-ignore: canonical-logger`. Scope: production code only (excludes `__tests__/`, `scripts/`) | Per-line annotation |
| P7 | `verify-universal-skill-sync.sh` | `UNIVERSAL_SKILL_NAMES` ↔ `ACTION_REGISTRY` bidirectional: every entry in `server/config/universalSkills.ts` has matching `ACTION_REGISTRY` row with `isUniversal: true` and vice versa | No suppression — must stay in sync |
| P8 | `verify-frontend-design-budget.sh` | Pages importing `KpiCard`/`KpiTile`/`Sparkline`/chart components require entry in admin-only allow-list at `docs/frontend-design-allowlist.json` | Allow-list entry |
| P9 | `verify-any-budget.sh` | Per-file `: any` / `as any` count is non-growing relative to `scripts/.gate-baselines/any-budget.txt`. New instances require `guard-ignore: type-strengthening` | Per-line annotation |
| P10 | `verify-marker-budget.sh` | Per-file TODO/FIXME/HACK/TEMP/LEGACY/DEPRECATED count is non-growing relative to baseline. New markers require justification in commit body matching `Marker-Reason: <rationale>` | Commit-body trailer |
| P11 | `verify-no-new-cycles.sh` | `madge --circular --json` cycle count is non-growing relative to `scripts/.gate-baselines/circular-deps.txt` | Add to baseline only via PR description with rationale |
| P12 | `verify-duplicate-blocks.sh` | `jscpd --min-tokens 15` clone-density is non-growing relative to `scripts/.gate-baselines/duplicate-blocks.txt` | Same as P11 |
| P13 | `verify-framework-context-block.sh` | Parses `docs/codebase-audit-framework.md` §2 rows against `package.json` scripts; fails CI on drift (e.g. §2 says "no Vitest" but `package.json` declares `vitest run`) | No suppression — must stay in sync |
| P14 | `verify-types-used.sh` | Walks `shared/types/*`; every exported event type either appears in a discriminated union OR is referenced from code | `guard-ignore: types-used reason="..."` on the export line |
| P15 | `verify-no-orphan-react-component.sh` | Walks React Router tree from `client/src/App.tsx`; flags pages/components with zero ingress | Allow-list at `client/.orphan-allowlist.json` for intentional-but-unrouted components (e.g. Storybook fixtures) |
| P16 | `verify-knip-config.sh` | Asserts `knip.json` exists and registers every dynamic entry surface (server entry, client entry, worker, `.claude/hooks/*.js`, all `server/config/*.ts` registries, `scripts/__fixtures__/*`) | No suppression — generates a fresh advisory list |

---

## 5. Service contracts — Tier 2 (Documentation rules, 4 proposals)

| ID | File | Change |
|---|---|---|
| P17 | `architecture.md` | Add sub-section under § Tenant Scoping titled "Single org-id source": `req.user.organisationId` is read **only** inside `server/middleware/auth.ts`; all other code reads `req.orgId`. Cross-reference `verify-org-id-source.sh` |
| P18 | `CLAUDE.md` § Comments | Append example: "Comments describing a *completed* refactor are residue — the commit message is the right home. Anchor case: `server/services/agentExecutionService.ts:72-116` (cluster of explanatory comments about an import-removal refactor that shipped in migration 0106)" |
| P19 | `CLAUDE.md` § Frontend Design Principles | Append rule: "Prefer named exports for React components. Default-and-named dual exports create ambiguity that knip cannot reliably trace. Rename-shim cases (e.g. the subaccount-vs-client transition in `client/src/lib/auth.ts`) are exceptions with a documented sunset date" |
| P20 | `docs/capabilities.md` § Editorial Rules | Extend with three enumerations: (a) "Always-OK industry terms" — OAuth, HTTP, webhook, Docker, Playwright, REST, GraphQL, SAML, SSO, OIDC; (b) "Provider names allowed only in factual sections" — explicit Skills Reference + Integrations Reference scope; (c) "Borderline cases that require human judgement" — partner-name mentions outside factual sections (e.g. "Google Docs as a knowledge source") |

---

## 6. Service contracts — Tier 3 (Knowledge / decision, 4 proposals)

| ID | Target | Content |
|---|---|---|
| P21 | `KNOWLEDGE.md` pattern | "Per-critical-path coverage tier matrix" — list each critical path with its tier (`gates only` / `gates + unit` / `gates + trajectory`). Initial matrix: RLS context propagation = `gates + unit`; agentRunVisibility = `gates + unit`; idempotency-key dedup = `gates + sparse unit`; cost-breaker invocation = `gates only`. Refresh quarterly |
| P22 | `KNOWLEDGE.md` pattern | "Custom retry loops are pass-3 even when they look right" — already drafted in audit log; append to KNOWLEDGE on landing |
| P23 | `KNOWLEDGE.md` pattern | "Handoff depth-cap rejections need structured events, not `console.warn`" — already drafted; append |
| P24 | `docs/decisions/00XX-service-layer-extraction-for-routes-touching-db.md` | New ADR. Decision: routes that need a row type from `db/schema/*.ts` MUST import via `shared/types/`. Routes that need to run a query MUST go through a service. Rationale: the 2026-05-14 audit's `supportAgentRoutes.ts` finding showed how the type-import-with-baseline pattern masked a layer breach for weeks. Status: Accepted. Date: 2026-05-14 |

---

## 7. Data model

No schema changes. All artefacts are CI / docs / knowledge.

The only persistent state is the baseline files in `scripts/.gate-baselines/*.txt`. These follow the format defined in §3 Shared infrastructure.

---

## 8. Integration boundaries

| Boundary | Treatment |
|---|---|
| CI (GitHub Actions) | `scripts/run-all-gates.sh` orchestrates; new gates wired in. No new workflow file |
| Local dev | Gates remain CI-only per `CLAUDE.md` "Test gates are CI-only" — local dev runs `npm run lint` + `npm run build:server` + targeted Vitest only |
| Existing baselines | The gate being tightened (P2) keeps its baseline but gains expiry directives |
| Documentation propagation | `docs/doc-sync.md` updated to list the new gates as triggers for `architecture.md` / `CLAUDE.md` updates |

---

## 9. Acceptance criteria

This build is complete when **all** of the following are true:

1. All 16 Tier-1 gate scripts exist at `scripts/verify-*.sh` with executable permissions, follow the existing `guard-utils.sh` pattern, and are listed in `scripts/run-all-gates.sh`.
2. Each gate has a corresponding baseline file at `scripts/.gate-baselines/<guard-id>.txt` (empty file if no current violations) with at least one `# expires: YYYY-MM-DD` directive for any pre-existing violations.
3. The shared suppression-annotation grammar is documented in `scripts/lib/guard-utils.sh` and referenced by every gate's error message.
4. Documentation updates P17-P20 land in `architecture.md`, `CLAUDE.md`, and `docs/capabilities.md` per the descriptions above.
5. `KNOWLEDGE.md` is appended with the three pattern entries from P21-P23. Append-only — no edits to existing entries.
6. ADR P24 is written at `docs/decisions/00XX-service-layer-extraction-for-routes-touching-db.md` (next available number) with status `Accepted`.
7. All 24 prevention-proposal todos in `tasks/todo.md` are checked off (`[x]`) and reference the closing PR by number.
8. `docs/doc-sync.md` lists the new gates.
9. `pr-reviewer` + `spec-conformance` (if any spec contract is touched) approve the branch.

---

## 10. Out of scope

- **Symptom fixes from the parent audit.** Tracked separately in `## Deferred from codebase audit — 2026-05-14`.
- **God-file refactors** (`skillExecutor.ts`, `workflowEngineService.ts`, etc.). Each is its own ADR + plan + chunks. The P3 gate registers them; it does NOT split them.
- **The remaining hotspot audits** (`hotspot skills`, `hotspot frontend`, `hotspot agent-execution`, `hotspot duplication`, `hotspot circular-deps`). They run independently against their own branches.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Landing 16 gates simultaneously could spike CI false-positive rates (unrelated PRs failing because they touch a gate-targeted pattern incidentally) | Each gate ships with baseline pre-populated from existing violations; only NEW violations fail. Phased rollout: land gates as `warning` for one week, then promote to `error` |
| Suppression annotation grammar drift | Gate output messages include the exact suppression syntax; `guard-utils.sh` exposes a `format_suppression` helper |
| `verify-with-org-tx-or-scoped-db.sh` (P2 companion) requires AST-level analysis, not regex | Implementation chunk for P2 must use `ts-morph` (already in deps); plan should chunk this as one of the larger items |
| Knip + jscpd + madge baselines drift quietly | P11/P12/P16 gates report baseline diff in CI logs; a quarterly review item lands in `tasks/todo.md` |
| Doc updates (P17-P20) introduce drift between rules and gates | `docs/doc-sync.md` lists every new gate's paired doc anchor; `chatgpt-spec-review` checks alignment |
| 30-day expiry promotion is too aggressive for legacy baselines | Operator-controlled: per-baseline `# expires:` directive lets a team set a longer window per entry; review the policy quarterly |

---

## 12. Chunk plan (architect input)

The architect should decompose this spec into chunks roughly along these lines (final breakdown is the architect's call):

1. **Shared infrastructure** — extend `scripts/lib/guard-utils.sh` with `check_expiring_baseline`, `format_suppression`; document suppression grammar.
2. **Tier 1 batch A — small static-analysis gates** (P4 silent catch, P5 canonical retry, P6 canonical logger, P9 any-budget, P10 marker-budget). Each is a small grep-and-annotate gate.
3. **Tier 1 batch B — sync gates** (P7 universal-skill sync, P13 framework-context-block, P14 types-used). Each is a JSON/AST cross-reference.
4. **Tier 1 batch C — tool-baselined gates** (P11 madge cycles, P12 jscpd duplicates, P16 knip config). Each wraps an external tool + baseline.
5. **Tier 1 batch D — gates needing AST work** (P2 tighten + companion, P15 React Router walk). Uses `ts-morph`.
6. **Tier 1 batch E — gates needing depcheck / loc / frontend** (P1 missing-deps, P3 loc-cap, P8 frontend-design-budget). Mostly static.
7. **Documentation updates** (P17-P20). Single commit per file.
8. **Knowledge entries** (P21-P23). Single append-only commit.
9. **ADR** (P24). Single commit.
10. **Wiring** — `docs/doc-sync.md` + `scripts/run-all-gates.sh` + CI promotion (warning → error). Final commit.

The architect produces the per-chunk `plan.md` after this spec is approved by `spec-reviewer` and `chatgpt-spec-review`.

---

## 13. Open questions for spec-reviewer / chatgpt-spec-review

1. **Baseline expiry policy.** Is 30 days post-expiry the right grace window for "warning → error" promotion? Alternative: per-baseline expiry severity (some entries auto-promote at expiry; others remain warnings until human review).
2. **P15 allow-list shape.** Per-component allow-list at `client/.orphan-allowlist.json` — is JSON the right format vs. a code annotation `// orphan-allowed: <reason>`? JSON is centralised but a comment is co-located.
3. **P10 commit-body trailer parsing.** Should `Marker-Reason:` be enforced at PR-time (Action / lint-staged hook) or only at gate-time (after push)? Gate-time only is simpler but accumulates rework.
4. **P3 schema-file exclusion completeness.** Spec excludes `server/db/schema/*.ts` and generated files. Should it ALSO exclude `migrations/*.sql` (sealed)? Probably yes — confirm.
5. **CI promotion timeline.** "One week as warning, then promote to error" — does the operator want manual promotion (a PR per gate) or automatic (calendar-based)? Manual gives more control; automatic gives forcing-function consistency.
6. **Concurrent gate landing.** The chunk plan ships gates in batches A-E. Should each batch land as a separate PR (smaller blast radius, more review touchpoints) or all in one PR (lower coordination cost)? Recommend batch-per-PR with the operator gating each promotion to `error`.

---

## 14. Linked artefacts

- **Source audit log**: `tasks/review-logs/codebase-audit-log-pre-v1-lockdown-2026-05-14T04-49-08Z.md`
- **Audit branch**: `audit/full-pre-v1-lockdown-2026-05-14`
- **Pass 3 backlog (parent)**: `tasks/todo.md` § Prevention proposals from codebase audit — 2026-05-14
- **Framework reference**: `docs/codebase-audit-framework.md` Rule 16 (Prevent the next occurrence)
- **Doc-sync canonical**: `docs/doc-sync.md`
- **KNOWLEDGE.md anchors**: four patterns appended 2026-05-14 (§2 staleness; gate baselines must expire; custom retry loops; build-stream consolidations need a delete task)
