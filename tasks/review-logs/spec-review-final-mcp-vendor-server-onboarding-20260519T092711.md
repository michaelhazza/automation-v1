# Spec Review Final Report

**Spec:** `docs/superpowers/specs/2026-05-19-mcp-vendor-server-onboarding-spec.md`
**Spec commit at start:** untracked (new file)
**Spec commit at finish:** `ff540cef` (post-iteration-4)
**Spec-context commit:** `599bcac7` (last reviewed 2026-05-11, 8 days old — green)
**Iterations run:** 4 of 5
**Exit condition:** two-consecutive-mechanical-only (iter 3 and iter 4 both pure mechanical, 0 directional)
**Verdict:** READY_FOR_BUILD

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Auto-decided (framing) | Auto-decided (convention) | AUTO-DECIDED (best-judgment) |
|---|----|----|----|----|----|----|----|
| 1 | 12 | 4 (3 actionable, 1 dropped) | 15 | 0 | 0 | 0 | none |
| 2 | 9 | 0 | 9 | 0 | 0 | 0 | none |
| 3 | 5 | 0 | 5 | 0 | 0 | 0 | none |
| 4 | 2 | 0 | 2 | 0 | 0 | 0 | none |
| **Total** | **28** | **3** | **31** | **0** | **0** | **0** | **none** |

Findings trend: 16 → 9 → 5 → 2. Clear convergence pattern. The spec stabilised on framing in iteration 1; subsequent iterations chased second-order drift introduced by earlier mechanical fixes (especially the iter-3 audit discriminated union split, which iter 4 cleaned up).

---

## Mechanical changes applied

Grouped by spec section:

### Frontmatter
- Status moved from `draft` to `reviewing`.

### §4 Goals
- Audit-event name standardised to dotted form (`mcp.capability.shadowed`).

### §6 Framing assumptions
- Process-level / e2b boundary clarified — V1 process-level only; e2b deferred to Phase 2 (§27 Q1).

### §7 Phase plan
- Phase B prerequisite list extended — §13.1 vendor-verdict resolution required per vendor before enablement.

### §8 Trust boundary model
- Subprocess-trust row rewritten — process-level only, e2b NOT used.
- Network-egress row rewritten — hard enforcement at infra firewall layer; in-process controls labelled best-effort.

### §9.1 HTTP transport
- "Validated end-to-end" rephrased — Phase A is pure-function tests; live Brave Search validation moved to Phase B vendor 1 onboarding.

### §9.3 Subaccount credential scoping
- Cascade-semantics table extended with `shared-read-only-infrastructure` short-circuit row.
- Audit-event name standardised to `mcp.server.unavailable`.

### §9.4 Version pinning + supply chain
- Phase B presets MUST use `command in {npx, node}` — enforced by `verify-mcp-version-pin.sh`.
- Provenance/checksum validation deferred to ADR-level manual review at version-bump time.

### §9.5 Capability routing contract
- Tool-schema source-of-truth now includes `discoveredToolsJson` cache as persisted snapshot.
- PolicyEnvelopeResolver integration clarified — hash-only per invocation; full snapshot lives once at `agent_runs.policyEnvelopeJson`.
- `partial` capability registry mark clarified as boot-time-only.
- Audit-event names standardised to dotted form.

### §9.6 Subprocess isolation
- Filesystem-access bullet expanded with concrete Node primitives (`child_process.spawn`, `fs.mkdtemp`, path-restriction check).
- Network-egress bullet rewritten — hard enforcement at infra firewall; in-process best-effort; `allowedHosts` required for every enabled Phase B vendor regardless of transport.
- New file `server/lib/mcpSubprocessSpawner.ts` added to file inventory.
- Sandbox-relationship clarified — e2b NOT used by this build.

### §10.3 Native-MCP overlap routing
- Audit-event name standardised; no terminal MCP event fires when native shadows MCP.

### §11.1 Risk Tier classification
- Action registry pinned as the runtime enforcing source of truth; `riskTierMapping` redefined as static-gate expectation only.
- Audit-event name `mcp.risk.tier.drift` standardised.

### §11.2 Action registry mapping
- Audit-event name `mcp.tool.unregistered` standardised.

### §12.1 Definition of done — happy path
- Each Phase B vendor needs a fully resolved §13.1 verdict matrix (no `unknown` rows).

### §12.2 Negative-path tests
- Audit-event names standardised throughout.

### §13.1 Vendor compatibility verdicts (new subsection)
- New matrix introduced — per-vendor verdicts against §13 criteria. `unknown` rows treated as blockers until ADR resolves.

### §14 Rollout strategy
- GA criteria extended — write-tier vendors blocked until infra egress firewall rule for `allowedHosts` is in place.

### §16.1 Per-tool allowlist visibility
- Runtime allowlist precedence rule added — preset menu ∩ operator selection.

### §16.4 Routing / audit visibility
- Filter predicate corrected — `eventType = 'mcp.capability.shadowed'` (using a field that exists in `McpAuditEntry`).
- URL example updated.

### §17.1 File inventory (schema + server)
- `mcpServerConfigs.ts` row changed from `no change` to `modify` (type-union extension for `quarantined` status).
- `mcpClientManager.ts` row updated — stdio spawns routed through `mcpSubprocessSpawner`.
- `mcpClientManagerPure.ts` row updated — classifier responsibility removed (consolidated to `mcpVendorErrorClassifier.ts`).
- `mcpPresets.ts` row updated — Phase A is interface extension only; vendor presets land per-vendor in Phase B.
- `mcpServerConfigServicePure.ts` row pinned to `selectMcpCredential(orgConfig, subaccountConfig, runContext, policyClass)` as canonical home.
- `credentialBrokerService.ts` row updated with three explicit runtime branches (shared-system-key / subaccount-or-org / null).
- `credentialBrokerServicePure.ts` row changed to `no change` (consolidation).
- New file `server/lib/mcpSubprocessSpawner.ts` added.

### §17.3 CI gates
- `verify-mcp-allowlist-coverage.sh` extended — every `allowedTools` entry must resolve to an action-registry entry with matching Risk Tier.
- `verify-mcp-version-pin.sh` extended — Phase B presets must use `command in {npx, node}`.

### §17.7 Files explicitly NOT touched
- `mcpServerConfigs.ts` removed from the list (it's a modify now).

### §18.1 `McpPreset` extended interface
- `riskTierMapping` Consumer field corrected — static gate + drift detector, NOT `resolveGateLevel`.
- `allowedHosts` requirement universalised — required for every Phase B enabled vendor regardless of transport.

### §18.2 Subaccount cascade — collision semantics
- Signature updated to include `policyClass`.
- Added `shared-read-only-infrastructure` short-circuit row.
- Added `credentialCascadeResult` column to the cases table.

### §18.4 MCP audit-log entry shape
- Split into a discriminated union: `McpAuditTerminalEntry` (5 terminal event types) + `McpAuditAuxiliaryEntry` (3 auxiliary event types).
- Terminal entries carry `status` + `invocationSequence`; auxiliary entries do not.
- Terminal-entry `routingDecision` narrowed to literal `'mcp'`; native-shadow routing handled exclusively by the auxiliary `mcp.capability.shadowed` event.
- Added `mcp.risk.tier.drift` to the auxiliary union.

### §18.6 Source-of-truth precedence
- Tool-schema row expanded — live (in-memory) > persisted `discoveredToolsJson` > preset declaration.
- New row added — per-tool allowlist (preset menu ∩ operator selection).

### §22.3 Concurrency guards
- Per-node and per-org semaphore ceilings pinned to `mcpSubprocessSpawner`.

### §23 Deferred items
- `mcp.capability.shadowed` dashboard wording updated to dotted form.
- Phase A → Phase B mention fixed (Phase B enables the 5 presets, not Phase A).
- Added: Egress firewall / NetworkPolicy wiring deferred to infra; per-vendor enablement gate for write-tier vendors.
- Added: Automated npm provenance gate (`verify-mcp-provenance.sh`) deferred until npm CLI surface stabilises.

### §24 Self-consistency pass result
- Numeric reconciliation updated — schema is `modify` (type-union extension), audit event types 5 terminal + 3 auxiliary, cascade cases 6 user-visible / 5 function-return.
- File inventory drift list updated to include `mcpSubprocessSpawner.ts`.

### §26 Risks
- Action-registry coverage row updated — gate enforces both preset coverage AND action-registry resolution per tool entry.

### §27 Open questions
- `mcp.capability.shadowed` dashboard wording updated to dotted form.

---

## Rejected findings

None. Every finding raised by Codex and every rubric finding was either accepted-as-mechanical or dropped on re-classification (one rubric finding R4 about §7/§14 feature-flag terminology — dropped because the spec already self-justifies the behaviour-mode framing in §14).

---

## Directional and ambiguous findings (autonomously decided)

None. The spec's framing (pre-production, static-gates-primary, no e2e/contract/frontend tests, no feature-flag rollouts, prefer-existing-primitives) was respected by every Codex iteration. No findings recommended adding feature flags for rollout, frontend tests, e2e tests, API contract tests, performance baselines, staged rollouts, or new abstractions that duplicate existing primitives. The pre-loop framing-injection in each iteration's prompt successfully kept Codex within the project's posture.

No `tasks/todo.md` entries were created.

---

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and against Codex's best-effort review across 4 iterations. Every finding surfaced was a consistency/contract/mechanism gap, not a directional disagreement. The spec aligns with the framing in `docs/spec-context.md`.

However:

- The review did not re-verify the framing assumptions in the spec's body (Lifecycle Declaration, ABCd Estimate, Phase plan posture, Implementation philosophy). If the product context has shifted since the spec was written, re-read §3–§7 yourself before calling the spec implementation-ready.
- The review did not catch directional findings that Codex and the rubric did not see. Automated review converges on known classes of problem; it does not generate insight from product judgement.
- The review did not prescribe what to build next. Sprint sequencing within Phase A (seven prereqs, dependency graph in §21) and Phase B (vendor order in §10), scope trade-offs, and priority decisions are still the human's job.
- The §13.1 vendor compatibility matrix has `unknown` verdicts on maintenance, license, telemetry-callback, and tool-count rows for the four stdio vendors. The spec correctly treats these as blockers for Phase B enablement, but the procurement ADR (separately authored) needs to resolve them to `pass` / `fail` before any vendor enables.
- The §23 deferred-item gate (egress firewall infra for write-tier vendors) places a hard dependency on infra work outside this codebase. The spec correctly blocks write-tier vendor enablement on this gate; the actual infra build is the operator's responsibility.

**Recommended next step:** read the spec's framing sections (§3 Lifecycle Declaration, §6 Framing assumptions, §7 Phase plan) one more time, confirm the headline phasing (Phase A = 7 prereqs as internal release, Phase B = 5 vendors one at a time after Phase A merges) matches your current intent, and then start implementation with Phase A.
