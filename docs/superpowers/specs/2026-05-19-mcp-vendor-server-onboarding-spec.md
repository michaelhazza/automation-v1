**Status:** accepted
**Spec date:** 2026-05-19
**Last updated:** 2026-05-19 (ChatGPT R2 — APPROVED; 1 finding applied)
**Author:** Claude (spec-coordinator, Opus)
**Build slug:** mcp-vendor-server-onboarding

# MCP Vendor Server Onboarding — Specification

## Lifecycle Declaration

| Field | Value |
|---|---|
| Capability cluster | Integrations, Agent Runtime, Audit & Governance, Approvals |
| Capability owner | platform |
| Lifecycle state on launch | Growth |
| Risk surface | server/db/schema, server/routes, auth/permission services, middleware, RLS migrations, agent runtime, approvals, external messaging |
| Review cadence | quarterly (CVE-triggered freezes per `Risk Tier` of the affected vendor) |

This build extends the existing `integration-framework` capability (Cluster: Integrations, Lifecycle: Mature) by adding vendor-provided MCP servers behind the same governance surface. The Asset Register row for `integration-framework` is updated rather than replaced; no new top-level capability row is created.

## ABCd Lifecycle Estimate

| Dimension | Sizing | Notes |
|---|---|---|
| Acquire | L | Five vendor servers across two transports plus seven prereq surfaces; vendor procurement ADR, supply-chain pinning, version-bump cadence |
| Build | L | Seven prereq surfaces (HTTP transport with security posture, env mapping, subaccount scoping, version pinning, capability routing, subprocess isolation, observability) gating five vendor onboardings; 4–5 engineering weeks for one engineer |
| Carry | M | Quarterly vendor version reviews, CVE-triggered freezes, per-vendor allowlist maintenance, subprocess concurrency tuning, observability dashboards |
| decommission | M | Per-vendor disable + credential revocation already in admin UI; removing the seven prereq surfaces would touch credential broker, schema, routes — non-trivial but bounded |

---

## Table of contents

- §4. Goals
- §5. Non-goals
- §6. Framing assumptions
- §7. Phase plan
- §8. Trust boundary model
- §9. Phase A — Cross-cutting prerequisites
  - §9.1 Prereq 1 — HTTP transport with security posture
  - §9.2 Prereq 2 — Env-var name remapping
  - §9.3 Prereq 3 — Subaccount credential scoping
  - §9.4 Prereq 4 — Version pinning + supply-chain guard
  - §9.5 Prereq 5 — Capability routing contract
  - §9.6 Prereq 6 — Subprocess isolation
  - §9.7 Prereq 7 — Observability and telemetry
- §10. Phase B — Vendor server onboardings
  - §10.1 Brave Search — shared-credential trade-off
  - §10.2 GitHub, Notion, Stripe, Slack — per-tenant credential vendors
  - §10.3 Native-MCP overlap routing
- §11. Governance integration
  - §11.1 Risk Tier classification by tool type
  - §11.2 Action registry mapping
  - §11.3 Risk Tier classification granularity
  - §11.4 Per-tool allowlisting
  - §11.5 Policy inheritance
  - §11.6 Capability explosion control
  - §11.7 Approval gate wiring
- §12. Definition of done
  - §12.1 Happy path
  - §12.2 Required negative-path tests
  - §12.3 Out-of-scope tests
- §13. MCP server compatibility criteria
  - §13.1 Phase B vendor compatibility verdicts
- §14. Rollout strategy
- §15. Operational ownership
- §16. UI surface
  - §16.1 Per-tool allowlist visibility
  - §16.2 Shared-credential disclosure
  - §16.3 Server status indicators
  - §16.4 Routing / audit visibility
- §17. File inventory lock
  - §17.1 Phase A — schema + server
  - §17.2 Phase A — observability
  - §17.3 Phase A — CI gates
  - §17.4 Phase A — UI
  - §17.5 Phase A — docs
  - §17.6 Phase B — vendor onboardings
  - §17.7 Files explicitly NOT touched
- §18. Contracts
  - §18.1 `McpPreset` extended interface
  - §18.2 Subaccount credential cascade — collision semantics
  - §18.3 Vendor-error classifier — closed taxonomy
  - §18.4 MCP audit-log entry shape
  - §18.5 Capability registry — `vendor-mcp` source marker
  - §18.6 Source-of-truth precedence — multi-representation
- §19. Permissions / RLS checklist
- §20. Execution model
- §21. Phase sequencing — dependency graph
- §22. Execution-safety contracts
  - §22.1 Idempotency posture
  - §22.2 Retry classification
  - §22.3 Concurrency guards
  - §22.4 Terminal event guarantee
  - §22.5 No-silent-partial-success
  - §22.6 Unique-constraint-to-HTTP mapping
  - §22.7 State machine — server status
- §23. Deferred items
- §24. Self-consistency pass result
- §25. Testing posture statement
- §26. Risks
- §27. Open questions

---

## §4. Goals

1. Ship the seven cross-cutting MCP prerequisites as a single internal release: HTTP transport with full security posture, env-var name remapping, subaccount-scoped credential cascade, version pinning with supply-chain guard, capability routing contract, subprocess isolation, observability and telemetry.
2. Onboard five vendor MCP servers in production behind the prerequisite gates: Brave Search, GitHub, Notion, Stripe, Slack — each version-pinned, per-tool allowlisted, governance-gated through `PolicyEnvelopeResolver`, and per-tenant credential-scoped.
3. Add four small additions to the existing Connections page (no restructure): per-tool allowlist visibility, shared-credential disclosure for the `shared-read-only-infrastructure` policy class, server status indicators (quarantine / disabled distinct from error), and a filtered audit-log view for `mcp.capability.shadowed` events.
4. Author the vendor-procurement ADR codifying the `shared-read-only-infrastructure` policy class, version-pin policy, and CVE response workflow.
5. Update the `integration-framework` Asset Register row to reflect MCP vendor onboarding capability without creating a new top-level row.

## §5. Non-goals

- Native integration replacement. Where a native integration exists (Gmail, HubSpot, Slack native, GHL, Stripe Agent), native always wins for routing. MCP-based vendor servers serve as supplements only.
- Third-party MCP hosting (Smithery, mcp.so). Every MCP server runs on Synthetos infrastructure.
- Composio or other integration-broker platforms.
- Externally hosted MCP HTTP endpoints. Only Synthetos-controlled or vendor-published-and-self-hosted servers are eligible.
- Restructural changes to the Connections page. Brief author confirmed wire notes only.
- New `Risk Tier` enum values. The existing 0–6 ceiling carries all vendor tool classifications.
- Per-skill engineering for vendor capabilities. Onboarding a vendor server unlocks its tools through the governance pipeline, not through one-off skill code.

## §6. Framing assumptions

- The MCP TypeScript SDK already supports `StreamableHTTPClientTransport`. Only client wiring and transport-selector logic are missing.
- The `transport` column on `mcp_server_configs` already exists (typed `'stdio' | 'http'`); only the runtime selector and security posture are missing.
- The `envEncrypted` JSONB column on `mcp_server_configs` already accepts per-config env values; the env-var name remapping adds a derived projection at spawn time, not a new column.
- `policyEnvelopeJson` is persisted to `agent_runs` before the agent loop runs (per `synthetos-foundation-refactor`); MCP tool invocations consume the run-snapshot, not a per-call resolver call.
- The existing `actionService.proposeAction` → `resolveGateLevel` → `policyEngineService.evaluatePolicy` chain is the gate path for MCP tool invocations. Risk tier is the gate input.
- Process-level filesystem and network-egress restriction is the V1 trust boundary for semi-trusted MCP subprocesses; the e2b runtime pool is NOT used by this build. Sandboxed-runtime (IEE / e2b) migration remains an open Phase 2 option — not pre-committed here (§27 Q1, §23 deferred item).
- Subaccount credential cascade semantics (subaccount-first, fall through to org on disabled, fresh-per-run resolution) are an extension of the existing credential broker contract, not a rewrite.
- The four UI additions in §16 fit inside `AppIntegrationsTab` of the existing Connections page (`/connections` route). No new pages.
- The `verify-mcp-version-pin` CI gate is a new grep-style invariant in the same shape as the existing `verify-no-direct-boss-work` and `verify-rls-coverage` gates.
- Per `docs/spec-context.md`: testing posture is `static_gates_primary` + pure-function runtime tests. No frontend tests, no API-contract tests, no e2e tests of own app. Negative-path tests for vendor onboarding ship as pure-function tests at the prereq boundary.

## §7. Phase plan

This build ships in two sequential phases.

| Phase | Slug | Scope | Dependency |
|---|---|---|---|
| Phase A | prereqs | All seven cross-cutting prerequisites, vendor-procurement ADR, capability-routing contract, observability schema. No vendor server enabled in production. | None — entry point |
| Phase B | vendor-onboardings | Five vendor MCP servers onboarded in order: Brave Search, GitHub, Notion, Stripe, Slack. Each one ships behind a feature flag gating tenant access. | Phase A complete and merged |

Phase A is the **internal release** — all seven prereqs ship together so vendor onboardings can land incrementally on a stable base. Phase B servers ship one at a time per the §10 order, each gated by tenant feature flag until that vendor's negative-path tests, observability **instrumentation** (the structured-log + audit-event surface emitted at every MCP boundary per §9.7 / §18.4), governance mappings, AND the §13.1 compatibility-verdict matrix all pass for that vendor. Dashboards consuming the instrumentation are **not** a Phase B gate — they are deferred per §23 until production traffic exists to calibrate thresholds. A `unknown` verdict on any §13.1 row for a vendor blocks that vendor's Phase B enablement until the procurement ADR records a `pass` or a documented `fail`-with-exception.

The two-phase split exists because shipping any vendor server without all seven prereqs in place creates avoidable rework — the credential cascade, capability routing contract, and subprocess isolation interact across every vendor's onboarding path.

---

## §8. Trust boundary model

Vendor MCP servers are **semi-trusted subprocesses**. They run on Synthetos infrastructure but execute third-party code with credentials in their environment. The trust boundary sits between the Synthetos orchestrator (trusted) and each spawned MCP subprocess (untrusted until its outputs are processed through the existing tool-output pipeline).

| Surface | Posture |
|---|---|
| Filesystem access | Per-run temporary working directory; no access to `/server`, `/client`, or app data directories. Enforcement: process-level working-directory + path restriction, not container isolation. |
| Network egress | Hard enforcement at the infra firewall / NetworkPolicy layer (outside this codebase). Best-effort in-process assistance via HTTP transport `allowedHosts` pre-connect validation (Prereq 1) and `HTTPS_PROXY` env injection for stdio servers (Prereq 6). Outbound connection to unlisted hosts is blocked by the firewall, not by the child process (which can ignore `HTTPS_PROXY`). |
| Credential visibility | Credentials injected as env vars scoped to the subprocess; not visible to sibling processes; env vars not written to disk; core dumps disabled; OS process teardown clears env on exit; credentials resolved fresh per run. |
| Prompt injection | All tool outputs treated as untrusted; not interpolated into system prompts without sanitisation. |
| Logging | All tool calls and outputs logged to the audit trail; credentials redacted via the existing `redaction.ts` bundle. |
| Subprocess trust | V1 boundary is process-level only: per-run `cwd` + path restriction, per-process domain allowlist, env-var scoping, OS-level process teardown. The e2b sandbox runtime pool is **not** used in this build; migration into the pool is an open Phase 2 option (§27 Q1). Stdio MCP processes are treated as semi-trusted subprocesses, not as e2b-sandboxed code. |

The orchestrator is trusted; the MCP server and all data it returns are untrusted until processed.

---

## §9. Phase A — Cross-cutting prerequisites

All seven prerequisites ship as one internal release. Each is sized in §17 file inventory and bounded by the contracts in §18.

### §9.1 Prereq 1 — HTTP transport with security posture (1–2 days)

Add HTTP transport selection to `mcpClientManager._connectSingleServer()` keyed off the existing `mcp_server_configs.transport` column. The selector instantiates `StreamableHTTPClientTransport` instead of `StdioClientTransport` when `transport === 'http'`. The selector ships **with** the full security posture below; no incremental security hardening on a follow-up build.

**Required HTTP transport security posture (all of these, on day one):**

- **TLS enforced.** Plaintext HTTP rejected at connection time. No `--allow-plaintext` flag.
- **Host allowlist.** Only declared preset domains accepted. Outbound connection to unlisted hosts blocked. SSRF prevention enforced at the process level (network egress restriction), not only at config validation. Allowlist mechanism: per-preset `allowedHosts` array enforced before the transport opens the connection.
- **Request timeout.** Default 30s, configurable per preset via a new `requestTimeoutMs` preset field. Hard ceiling 120s; values above ceiling are rejected at preset load.
- **Retry semantics.** Exponential backoff with jitter, max 3 attempts. Non-idempotent tool calls are not retried — the preset declares idempotency per tool variant in `riskTierMapping`.
- **Auth-header handling.** Bearer tokens injected server-side via the credential broker. Client requests never forward auth headers to the MCP transport.
- **Streaming cancellation.** `AbortController` wired to the agent run lifecycle. On run termination (success, failure, or operator cancel), the active HTTP stream is aborted and cleaned up. No orphaned streams.

Phase A validation: pure-function tests against the transport selector and security-posture helpers (no live server). Live validation against the Brave Search server (the first HTTP-only vendor) happens during Phase B vendor 1 onboarding (§10.1) as part of that vendor's manual beta-tenant validation — not as a Phase A acceptance criterion.

### §9.2 Prereq 2 — Env-var name remapping (1 day)

Today `mcpClientManager._connectSingleServer()` sets `env.ACCESS_TOKEN` at the env-construction site inside `_connectSingleServer` (grep `env.ACCESS_TOKEN` within that function). Vendor servers expect vendor-specific env-var names: `GITHUB_TOKEN`, `STRIPE_SECRET_KEY`, `SLACK_BOT_TOKEN`, `NOTION_TOKEN`, `BRAVE_SEARCH_API_KEY`.

Add an `envVarMapping` field to the `McpPreset` type and apply the mapping at spawn time, projecting the resolved credential into the vendor's expected env-var name(s). The mapping is **preset-level metadata** (static); applied at the `env` construction site inside `_connectSingleServer`. No change to the `envEncrypted` column shape.

Mapping shape (full contract in §18):

```
envVarMapping: {
  accessToken?: string;   // e.g. 'GITHUB_TOKEN'
  refreshToken?: string;  // e.g. 'GITHUB_REFRESH_TOKEN' — most vendors omit
  apiKey?: string;        // e.g. 'BRAVE_SEARCH_API_KEY' for static-key vendors
}
```

If `envVarMapping` is omitted on a preset, the legacy `ACCESS_TOKEN` / `REFRESH_TOKEN` projection applies (backwards compatibility for the existing 28 placeholder presets until they are pruned).

### §9.3 Prereq 3 — Subaccount credential scoping (1 day)

`mcpServerConfigService.listForAgent(agentId, organisationId)` (grep for the function definition by name) filters MCP visibility only by `organisationId`. For multi-subaccount agencies (the common case), agents in subaccount A can currently see MCP server configs scoped to subaccount B in the same org. Add a subaccount filter to the `innerJoin` predicate.

**Subaccount cascade semantics (the explicit contract is in §18.2):**

| Case | Resolution |
|---|---|
| Preset is in the `shared-read-only-infrastructure` policy class (e.g. Brave Search) | System-level API key used; per-tenant cascade bypassed; `credentialCascadeResult = 'shared-system-key'` (§10.1, §18.4) |
| Both org and subaccount configs exist | Subaccount config takes precedence; org config ignored for this agent |
| Subaccount config exists but credential is disabled | Fall through to org config; do not silently fail |
| Org credential revoked, active subaccount credential | Subaccount credential used; org revocation does not propagate down |
| No org, no subaccount credential | Server unavailable for this run; logged as `mcp.server.unavailable`; run continues without it |
| Agent reassigned between subaccounts | Credential resolved fresh per run against the current subaccount; no caching of prior resolution |

Backward compatibility: existing `MCP_SERVERS_VIEW` and `MCP_SERVERS_MANAGE` permissions retain their meaning. The cascade is enforced at the `listForAgent` boundary; route-level permission guards do not change.

**Run-failure semantics (the explicit scope distinction is in §12.2):**

- "Server unavailable for this run" (no credentials / connection failure / server marked unavailable by the cascade returning `null`) → the server is **not in the available-tool set** for this run. The agent run continues normally if it does not need this server. If the agent attempts to invoke a tool on this server during the run, the invocation returns `mcp.server.unavailable` to the orchestrator (terminal event); whether the agent run as a whole fails or continues is the **orchestrator's** decision based on agent-level retry / fallback logic — not a server-level decision.
- "Tool invocation failed" (vendor auth error mid-call, vendor 5xx, schema mismatch, process crash mid-call) → the **specific tool invocation** is marked failed via `mcp.tool.failed` with a classified `vendorErrorClass` (§18.3). The agent run continues unless the orchestrator's per-skill policy treats the failure as fatal.
- The MCP layer never marks the parent agent run as failed. Run-level failure is decided one level up by the orchestrator / skill executor based on the agent's tool-dependency contract.

### §9.4 Prereq 4 — Version pinning + supply-chain guard (1 day)

Current preset `args` use `npx -y @vendor/server@latest`, which auto-updates on every run. Pin every preset to an exact semver. Add a new CI gate `verify-mcp-version-pin` that fails the build if any preset arg contains `@latest`, a bare package name without `@x.y.z`, or a git URL.

**Version policy operational contract:**

- All presets pinned to exact semver (e.g. `@notionhq/notion-mcp-server@1.1.0`). No range operators (`^`, `~`).
- Upgrade path: manual bump in preset + vendor changelog reviewed + re-test before merge.
- Rollback: revert the preset version string. No runtime state to unwind.
- Vulnerability response: CVE triggers immediate version freeze (no upgrade until the incident-response runbook clears the vendor) and on-call review per §15.
- Package source allowlist: npm registry only for Phase B vendor presets. No git URLs, no `file:` paths, no private registries. `MCP_ALLOWED_COMMANDS` (currently `{npx, node, docker, uvx, python3}`) is unchanged at the runtime layer so future vendors can ship on alternative runtimes via a fresh procurement ADR, BUT every Phase B vendor preset MUST set `command` to `npx` or `node` — enforced by `verify-mcp-version-pin.sh` (§17.3), which rejects any Phase B preset whose `command` is not in `{npx, node}` in addition to its version-pin checks.
- Checksum/signature validation: deferred to the procurement ADR's per-vendor manual review at version-bump time (not CI-enforced in Phase A). Where npm provenance is available, the ADR reviewer verifies the published attestation manually before approving the bump; a follow-up build may automate this as a new CI gate `verify-mcp-provenance.sh` once the npm CLI surface stabilises. See §23 deferred items.

Full operational contract in the procurement ADR (§17 File inventory: `docs/decisions/<next>-mcp-vendor-procurement.md`).

### §9.5 Prereq 5 — Capability routing contract (1 day)

Extend `docs/capabilities.md` schema to allow a `source: 'vendor-mcp'` capability marker on Asset Register rows. Add one entry per onboarded server. Define the routing-and-discovery contract that orchestrators follow when an MCP server's tools are invoked.

**Capability routing and discovery contract:**

- Tool schemas discovered from the MCP server at client initialisation (stdio: on spawn; HTTP: on first connection). Schemas cached in memory for the run. The existing `mcp_server_configs.discoveredToolsJson` + `discoveredToolsHash` columns are written through on every connection (existing behaviour preserved) and act as the persisted snapshot for the orchestrator's static capability registry hint; the in-memory cache wins for invocation within a single run.
- If the MCP connection drops and reconnects mid-run, the schema is re-fetched from the live server; the prior snapshot is not reused. The schema at first successful invocation is what is recorded in the audit log for replay.
- On schema fetch failure, the server is marked unavailable for the run and the orchestrator routes around it. No fallback to a stale schema.
- Orchestrator capability lookup uses the static capability registry for routing decisions; the runtime tool list is used for invocation. Discrepancies (preset declares tool X that the live server does not expose) are logged as `mcp.schema.drift`.
- Startup validation: at boot, the registry is loaded once per the §22.3 single-writer pattern; if a preset declares tools the live server does not expose at registration time, the delta is logged and the capability entry is marked `partial` in the registry. This `partial` flag is a **boot-time-only** outcome — once the registry is loaded it is read-only for the process lifetime.
- Stale capability removal: capabilities are removed from the registry when the backing preset is disabled or deleted (this triggers a fresh boot-time load on the next deploy / restart). No runtime registry mutation; no auto-removal on transient server timeout. Runtime schema drift between preset and live server surfaces as `mcp.schema.drift` audit events (§18.4), not as registry mutations.

**PolicyEnvelopeResolver integration:** MCP tool invocations inherit the `policyEnvelopeJson` snapshot persisted on `agent_runs` at run start. The snapshot's policy fields (budget constraints, domain restrictions, operator-defined action policies) apply to every MCP tool call within that run. Per-invocation audit-log entries record `policyEnvelopeJsonHash` only (§18.4), not the full snapshot — the full snapshot lives once at `agent_runs.policyEnvelopeJson` and is referenced by hash for replay. No mid-run re-resolution (§18.6).

### §9.6 Prereq 6 — Subprocess isolation (1–2 days)

Vendor MCP servers run as spawned child processes. The following runtime isolation requirements apply before any server reaches production.

**What Phase A actually ships vs what is deferred to infra (§23):**

- **Phase A (in-process layer, this build):** spawner-side `cwd` + path restriction, `HTTPS_PROXY` env injection for stdio servers, `allowedHosts` pre-flight validation for HTTP servers, per-node and per-org semaphore-based concurrency limits, ulimit memory cap, post-run reaper sweep, all the §18.4 audit events on spawn / exit / crash.
- **Deferred to infra (§23 — outside this codebase):** hard egress firewall / Kubernetes NetworkPolicy rules covering the union of declared `allowedHosts` plus the per-org egress proxy. A subprocess can ignore `HTTPS_PROXY` — only the firewall layer is actually binding.

The combination of Phase A in-process controls + the §23 deferred infra rule is what the spec calls "subprocess isolation". Phase A merges and Phase B Brave Search can enable on the read-only `shared-read-only-infrastructure` policy class with best-effort controls only (procurement ADR records the gap per §23). **Write-capable Phase B vendors (Stripe, GitHub write surface, Notion write surface, Slack) are BLOCKED from enablement until the §23 infra rule for their `allowedHosts` is in place** — gate enforced at §14 GA criteria.

- **Filesystem access:** restricted to a per-run temporary working directory created by the spawner wrapper (`server/lib/mcpSubprocessSpawner.ts` — see §17.1). Mechanism: Node `child_process.spawn` invoked with `cwd` set to a per-run temp directory created via `fs.mkdtemp(...)`, plus the spawner's path-restriction check that rejects any preset `args` containing `..` or absolute paths outside the temp dir. No access to `/server`, `/client`, or app data directories. Whether this becomes a long-term boundary or whether MCP execution should eventually migrate into the existing e2b sandbox runtime pool is an **open question** (see §27); this spec commits to the process-level boundary for V1 only.
- **Network egress:** the actual enforcing boundary is the host / container outbound-firewall layer outside this codebase (Kubernetes NetworkPolicy or host-level iptables rules restricting egress to the union of declared `allowedHosts` plus the per-org egress proxy). In-process controls are best-effort proxy-assistance only: the HTTP transport (Prereq 1) validates the destination URL against the preset's `allowedHosts` before opening the connection, and for stdio servers the spawner injects an `HTTPS_PROXY` env-var pointing at the per-org egress proxy. A subprocess can ignore `HTTPS_PROXY` — the firewall layer is what makes the allowlist binding. **`allowedHosts` is required on every Phase B enabled vendor preset regardless of transport** (§18.1): HTTP presets use it for the in-transport SSRF guard; stdio presets use it as the source-of-truth list for generating the infra firewall rule (§23 deferred-item gate). Phase A placeholder presets are exempt until they are promoted to Phase B. Presets without an `allowedHosts` entry are rejected at preset-load validation. The egress-proxy and firewall infra wiring live outside this codebase; this spec pins the in-process injection / validation points and explicitly delegates hard enforcement to infra.
- **Process cleanup:** child process killed and all stdio streams closed on run termination (success, error, timeout, operator cancel). No orphaned processes. Validated by a post-run reaper sweep.
- **Memory / CPU ceilings:** MCP processes accounted under the existing per-run resource budgets in `server/config/limits.ts` (`MAX_MCP_TOOLS_PER_RUN`, `MAX_MCP_CALLS_PER_RUN`, `MCP_CALL_TIMEOUT_MS`, etc.). Per-process memory ceiling enforced via `ulimit` at spawn time.
- **Concurrent-session isolation:** each run gets an independent child process. No shared subprocess state between concurrent runs.
- **Concurrency ceiling:** maximum concurrent MCP subprocesses per node configurable. Initial default 4 per node (open question §27 — finalised in the ADR or revisited under load testing). Per-org ceiling enforced so a single org cannot monopolise subprocess slots.
- **Sandbox relationship:** Phase A does NOT use the existing e2b runtime pool. Stdio MCP processes are spawned as semi-trusted subprocesses with the process-level controls listed above (`cwd` + path restriction, domain allowlist, env scoping, OS teardown). Migration of MCP execution into the e2b pool is an open Phase 2 option (§27 Q1, §23 deferred item).

### §9.7 Prereq 7 — Observability and telemetry (1 day)

Existing Synthetos architecture enforces auditability. MCP tool calls must meet the same standard.

**Required telemetry per MCP tool invocation:**

- Structured log entry containing `runId`, `agentId`, `orgId`, `subaccountId`, `serverId`, `toolName`, `durationMs`, `statusCode`. Full contract in §18.4.
- Credential-use audit trail: which credential resolved, which subaccount scope, timestamp. Credential values never logged.
- Vendor API failure classification: distinguish `timeout`, `auth_failure`, `rate_limit`, `upstream_error`, `schema_mismatch`. The classifier is a pure helper exported from `mcpVendorErrorClassifier.ts` so tests can pin it.
- MCP server health: startup success/failure logged; process exit codes and crash signals captured.
- Correlation: all MCP log entries carry the parent `runId` for end-to-end trace reconstruction.
- Latency and error metrics: emitted to the existing telemetry pipeline. Dashboards TBD post-onboarding (deferred per §23).

---

## §10. Phase B — Vendor server onboardings

Five vendor MCP servers ship one at a time on top of the Phase A foundation. Order is deliberate: validate each capability surface incrementally.

| # | Server | Transport | Effort | Why this order |
|---|---|---|---|---|
| 1 | Brave Search | HTTP | 0.5 day | Validates HTTP transport (Prereq 1). No per-tenant credentials (system-level API key — see §10.1). |
| 2 | GitHub | stdio | 1 day | OAuth scope plumbing exists. High technical-account value. |
| 3 | Notion | stdio | 1 day | Integration token (not OAuth). Validates non-OAuth env mapping. |
| 4 | Stripe | stdio | 2–3 days | Restricted-key per tenant. Sets the write-gated approval pattern for financially consequential vendors. |
| 5 | Slack | stdio | 3–5 days | Per-workspace bot OAuth. Rate limits. Workspace-scoped credential pattern. |

Total Phase B: 8–11 engineering days after Phase A merges.

### §10.1 Brave Search — shared-credential trade-off

Brave Search uses a single system-level API key. There is no per-tenant credential. Implications:

- All tenant searches share a pool quota. Tenant search inputs are not isolated at the vendor API level (Brave receives the search query but no Synthetos tenant identifier).
- No write actions, no PII submitted. The risk profile is read-only.
- Privacy disclosure required in the Connections UI before activation (the `shared-read-only-infrastructure` policy class — see §16.2).
- Codified in the vendor-procurement ADR as a **named policy class** so future low-risk providers can be evaluated against it without a fresh governance decision.

**`shared-read-only-infrastructure` eligibility criteria (codified in the ADR):**

- No write actions of any kind.
- No PII submitted to the vendor as part of any tool call.
- Pool-quota cost model acceptable (per-tenant attribution not required).
- No tenant-scoped audit trail at the vendor side (Synthetos-side audit is sufficient).
- Vendor must be MIT/Apache-licensed or vendor-supported under equivalent permissive terms.

Any vendor failing any criterion falls back to the per-tenant credential cascade (§9.3).

### §10.2 GitHub, Notion, Stripe, Slack — per-tenant credential vendors

Each ships with:

- Vendor-pinned semver in the preset (`@github/github-mcp-server@x.y.z`, `@notionhq/notion-mcp-server@x.y.z`, `@stripe/mcp-server@x.y.z`, `@slack/mcp-server@x.y.z` — exact strings finalised at the procurement ADR).
- Per-tool allowlist explicit in the preset (`allowedTools` field on `McpPreset`). No tool surfaced to the orchestrator without explicit operator enablement.
- Risk-tier mapping declared per logical action variant in `riskTierMapping`. Tools that bundle read+write under one callable register as separate action-registry entries (see §11.3).
- Negative-path tests (§12.2) passing locally + in CI before tenant-level enablement.

### §10.3 Native-MCP overlap routing

Where a native integration (Stripe Agent, Slack native, Gmail) and a vendor MCP server for the same provider coexist:

- Native is always preferred for routing.
- MCP server tools are invoked only when no native capability covers the requested action.
- Duplicate capability resolution: native capability entry takes precedence in `docs/capabilities.md`; MCP entry marked `supplement`.
- Operator UX: one connection surface per vendor; backend routes transparently.
- Observability: when a native integration shadows an MCP tool, the auxiliary event `mcp.capability.shadowed` (§18.4) is emitted with the native capability ID and the bypassed MCP tool name. No terminal MCP event fires for the shadowed call because MCP did not actually run — terminal events represent actual MCP invocations only (§22.4). Operators can filter audit logs to see routing-decision history (§16.4).

---

## §11. Governance integration

Vendor MCP tool invocations inherit Synthetos governance controls. The following mappings are required **before any server with write actions is enabled in production**.

### §11.1 Risk Tier classification by tool type

| Tool category | Risk Tier | Approval requirement |
|---|---|---|
| Read-only data fetch (search, list, get) | Low (Tier 0–1) | Auto-approve |
| Write to third-party SaaS (post, create, update) | Medium (Tier 2–3) | Operator approval gate via `actionService.proposeAction` |
| Financially consequential write (refund, charge, invoice) | High (Tier 4–5) | Two-step approval with reason capture |
| Destructive action (delete, revoke, archive) | High (Tier 5–6) | Two-step approval with reason capture |

Risk tier maps to the existing 0–6 enum (no new values introduced). The **action registry** (§11.2) is the single enforcing source of truth at gate-evaluation time. The preset's `riskTierMapping` field is the **static-gate expectation** — checked by `verify-mcp-allowlist-coverage.sh` (§17.3) against the action-registry entries; a mismatch at runtime is logged as `mcp.risk.tier.drift` (§18.4 / §18.6). Source-of-truth precedence: action-registry entry > `riskTierMapping`.

### §11.2 Action registry mapping

Each onboarded tool must be registered in the action registry (`server/config/actionRegistry/`) with its Risk Tier, required approval level, and whether the action is reversible. **Tools not in the registry are blocked by the orchestrator.** The block surface is precise:

- **To the vendor MCP server: silent.** The orchestrator never invokes the tool. No request reaches the vendor.
- **To the agent loop: typed orchestrator error.** Treated like any other tool-invocation failure; the agent can react per its skill-level policy (retry, fallback, fail).
- **To operators / audit: not silent.** A `mcp.tool.unregistered` audit event is emitted for forensics. The Connections audit-log view surfaces it on demand.

### §11.3 Risk Tier classification granularity

Classification applies **per registered tool entry**, not per invocation parameter. For tools that bundle read and write operations under a single callable (common in Stripe and Slack SDKs), each logical action variant must be registered as a separate action-registry entry with its own Risk Tier. If a vendor tool does not expose distinct variants, it inherits the highest Risk Tier of any operation it can perform.

Tools that bundle read+write under one callable WITHOUT distinct variants are flagged at preset load as `requires_explicit_variant_review`. The procurement ADR documents the per-vendor review pass.

### §11.4 Per-tool allowlisting

Onboarding a vendor server does **not** expose all its tools. Each preset declares an explicit `allowedTools` list. Tools not in the list are not surfaced to the orchestrator. Default is **deny-all**; operators enable per tool via the UI (§16.1).

### §11.5 Policy inheritance

All MCP tool invocations inherit the `policyEnvelopeJson` output for the parent run, including budget constraints, domain restrictions, and operator-defined action policies. The snapshot is read from `agent_runs.policyEnvelopeJson` at invocation time; no per-call resolver invocation.

### §11.6 Capability explosion control

No server with more than 50 exposed tools may be onboarded **without** a per-tool review and explicit allowlist. Brave Search is confirmed under the cap at 2 tools (§13.1). Tool counts for GitHub, Notion, Stripe, and Slack are confirmed during the procurement ADR's per-vendor pass (§13.1 rows currently marked `unknown — confirm at ADR`); any vendor exceeding 50 tools requires the explicit allowlist review before Phase B enablement. Operator UI shows enabled tools per server. The procurement ADR documents the dangerous-tool suppression playbook.

### §11.7 Approval gate wiring

MCP tool invocations enter the existing approval gate path:

`mcpClientManager.callTool()` → action proposed via `actionService.proposeAction()` → `resolveGateLevel()` → `policyEngineService.evaluatePolicy()` → either auto-approved (Tier 0–1) or routed to the review queue (Tier 2+). Two-step approval (Tier 4–6) requires reason capture per the existing pattern.

No changes to the gate path itself. The wiring change is at the MCP invocation boundary inside `mcpClientManager`.

---

## §12. Definition of done

### §12.1 Happy path

- All seven prereqs (§9) shipped with the static gates and pure-function tests that the existing testing posture requires.
- Five vendor MCP servers (§10) in production, version-pinned, with at least one beta tenant validation per server AND a fully resolved §13.1 verdict matrix (no `unknown` rows) for each vendor.
- Each server has a capability entry in `docs/capabilities.md` Asset Register or under the updated `integration-framework` row's notes column, with Risk Tier and `allowedTools` list.
- Operator can connect each vendor end-to-end via the existing Connections page.
- Credentials correctly scoped per tenant per the §9.3 collision-semantics contract.
- Vendor-procurement ADR merged at `docs/decisions/<next>-mcp-vendor-procurement.md`.
- `KNOWLEDGE.md` entry documents the onboarding playbook.
- `PolicyEnvelopeResolver` integration verified per run via the audit-log entry shape (§18.4).

### §12.2 Required negative-path tests

Every test below ships as a pure-function test (`*Pure.ts` + `__tests__/*.test.ts`) per the static-gates-primary posture. Must pass before each server is tenant-enabled.

- **Invalid credentials:** vendor returns auth error on tool invocation; the **tool invocation** is marked failed with `vendorErrorClass: 'auth_failure'` and emits `mcp.tool.failed`; no retry with bad credential. The agent run continues; orchestrator-level retry / fallback decides whether the run as a whole survives the failure (§9.3 run-failure semantics).
- **Expired OAuth token:** detected at connection time; operator notified via the existing connection status surface; server marked unavailable for the run (§9.3). Subsequent tool invocations against this server emit `mcp.server.unavailable`.
- **Revoked integration:** credential-cascade falls through correctly per §9.3 and §18.2 (cascade through `revoked` to the next tier).
- **MCP process crash:** subprocess exit captured; in-flight **tool invocation** fails with `mcp.tool.failed`; no orphaned process (verified by the post-run reaper sweep). Subsequent tool calls to the same server cause re-spawn attempts subject to the circuit-breaker (§22.2). The agent run is not marked failed at the MCP layer.
- **HTTP timeout:** request aborted at timeout ceiling; classified as `timeout`, not `upstream_error`.
- **Partial tool-schema load:** delta logged as `mcp.schema.drift`; available tools still routable.
- **Rate-limit exhaustion:** classified as `rate_limit`; not retried immediately; logged.
- **Tenant-isolation regression:** subaccount A cannot see or invoke tools configured for subaccount B (subaccount cascade unit test).
- **Per-tool allowlist enforcement:** tool not in `allowedTools` is blocked at the orchestrator boundary with `mcp.tool.disallowed` audit event.
- **Risk Tier mis-classification:** a Tier 4 tool invoked without two-step approval is blocked at `resolveGateLevel`.

### §12.3 Out-of-scope tests

Per `docs/spec-context.md`:

- E2E tests against the running app.
- Frontend unit tests for the four UI additions.
- API-contract tests for the MCP routes (`mcpServers.ts` route handlers).
- Performance baselines for the HTTP transport.

These are deferred per the framing posture. If a test in any of these categories proves cheap and high-value during Phase B, it ships as a static-gate equivalent (pure function + grep gate) rather than introducing a new test framework.

---

## §13. MCP server compatibility criteria

A vendor server is **eligible for onboarding** if it meets all of the following. Criteria are codified in the procurement ADR and verified at preset-load time where mechanical.

- Supports stdio transport (required) and/or `StreamableHTTPClientTransport` (required for HTTP-only servers).
- Authentication via env-var injection (Bearer token, API key, OAuth token). No custom handshake protocols.
- Actively maintained: last release within 6 months; open-source or vendor-supported.
- Licensing: MIT, Apache 2.0, or equivalent permissive licence. No copyleft that affects Synthetos distribution.
- No telemetry callbacks or analytics reporting from within the MCP server process. Network egress limited to the declared vendor API.
- All execution on Synthetos infrastructure. Externally hosted MCP endpoints are not supported.
- Runtime: Node.js (npm) preferred. Python (uvx) evaluated case-by-case. Other runtimes require ADR.
- Package source: npm registry only. No git URLs, no private registries, no `file:` paths.
- Tool count: servers exposing more than 50 tools require a pre-onboarding allowlist review.

### §13.1 Phase B vendor compatibility verdicts

Each Phase B vendor is verified against the §13 criteria below. An `unknown` verdict on any row is a blocker — the vendor cannot tenant-enable until the verdict is `pass` or the procurement ADR records the exception. Exact version strings, license confirmations, and tool counts are finalised in the procurement ADR; the matrix here records the current best-effort verdict at spec-authoring time.

| Criterion | Brave Search | GitHub | Notion | Stripe | Slack |
|---|---|---|---|---|---|
| Stdio or `StreamableHTTPClientTransport` | pass (HTTP) | pass (stdio) | pass (stdio) | pass (stdio) | pass (stdio) |
| Env-var auth (no custom handshake) | pass (API key) | pass (OAuth token) | pass (integration token) | pass (restricted key) | pass (OAuth bot token) |
| Actively maintained (last release within 6 months) | unknown — confirm at ADR | unknown — confirm at ADR | unknown — confirm at ADR | unknown — confirm at ADR | unknown — confirm at ADR |
| License (MIT / Apache 2.0 / equivalent permissive) | unknown — confirm at ADR | unknown — confirm at ADR | unknown — confirm at ADR | unknown — confirm at ADR | unknown — confirm at ADR |
| No telemetry/analytics callbacks from inside server | unknown — confirm at ADR via vendor README / source audit | unknown — confirm at ADR | unknown — confirm at ADR | unknown — confirm at ADR | unknown — confirm at ADR |
| Synthetos-hosted (not externally hosted) | pass | pass | pass | pass | pass |
| Runtime (Node.js / npm preferred) | pass (npm) | pass (npm) | pass (npm) | pass (npm) | pass (npm) |
| Package source (npm registry only) | pass | pass | pass | pass | pass |
| Tool count (≤50 without allowlist review) | pass (2 tools) | unknown — confirm at ADR; if >50, allowlist review required per §11.6 | unknown — confirm at ADR | unknown — confirm at ADR | unknown — confirm at ADR |

`unknown` rows convert to `pass` / `fail` during the procurement ADR's per-vendor review pass (§15). A `fail` verdict on any row blocks Phase B enablement for that vendor; the vendor either drops out of Phase B or the spec is amended to record the exception with a documented mitigation.

---

## §14. Rollout strategy

- **Staged rollout — Phase A:** prereqs ship as a single internal release. No vendor server enabled in production until Phase A merges.
- **Tenant allowlisting — Phase B:** each vendor server is gated behind an org-level feature flag before GA. Beta orgs enrolled manually. Feature flag is **behaviour-mode** only (vendor enabled / disabled per org), not a percentage rollout — consistent with `docs/spec-context.md` `feature_flags: only_for_behaviour_modes`.
- **Kill switch:** per-server disable in the Connections page without code deploy. Credential revocation triggers immediate server deactivation across all dependent agent runs.
- **Vendor-specific quarantine:** if a server exhibits unexpected behaviour (unexpected egress, crash rate, auth failures), it can be quarantined (connections closed, capability marked unavailable) without affecting other servers. Quarantine surface is the operator-visible status indicator in the UI (§16.3).
- **GA criteria:** for each vendor server — negative-path tests passing, observability instrumentation live, governance mappings complete, at least one beta tenant validation, native-overlap routing verified, AND (for vendors with any `write` / `financial` / `destructive` Risk Tier action) the infra egress firewall rule covering that vendor's `allowedHosts` is in place per §23 deferred-item gate.

---

## §15. Operational ownership

| Responsibility | Owner | Cadence |
|---|---|---|
| Vendor version maintenance and upgrade reviews | Platform team | Quarterly or on CVE |
| Deprecation handling (vendor EOLs a server) | Platform team | Minimum 30-day tenant notice |
| Broken server escalation | On-call engineer | P2 if write-action server; P3 if read-only |
| Procurement review cadence | Platform + security | Annual; on new server onboarding |
| Security advisories | Platform team | CVE triggers immediate version freeze |
| Compatibility testing on Node/runtime upgrade | Platform team | Part of standard upgrade checklist |
| Per-tool allowlist drift review | Platform + each tenant | Tenant-driven; platform supplies the diff view |
| Subprocess concurrency tuning | Platform team | Per node-class change |

---

## §16. UI surface

The existing Connections page (`/connections` route, `client/src/pages/govern/ConnectionsPage.tsx`) is reused without structural changes. All four additions hang off `AppIntegrationsTab` within the MCP server management section.

### §16.1 Per-tool allowlist visibility

Operator can see which tools are enabled per server and toggle them. Default is **deny-all** (no tools enabled until the operator opts in per tool). Toggle persists to `mcp_server_configs.allowedTools` (existing column). Toggling a tool surfaces the tool's Risk Tier so the operator sees the approval implication.

**Runtime allowlist precedence** (also in §18.6): the runtime allowlist is the intersection of (a) the preset's `allowedTools` field — the **eligible set / menu** — and (b) `mcp_server_configs.allowedTools` — the **operator-enabled set / selection**. Tools in the operator selection but not in the preset menu are silently ignored (a preset is the authoritative menu); tools in the preset menu but not in the operator selection are blocked at the orchestrator with `mcp.tool.disallowed`. Removing a tool from the preset menu in a later release does NOT auto-prune the DB column — the orchestrator's intersection logic handles drift naturally; the operator can re-toggle to clean up.

Pattern: collapsible "Tools" panel inside each MCP server card. Tools grouped by category (read / write / financial / destructive) with the Risk Tier pill inline.

### §16.2 Shared-credential disclosure

Before activating a server in the `shared-read-only-infrastructure` policy class (Brave Search initially), a privacy notice is shown explaining the pool-quota cost model and the absence of per-tenant credential isolation. Notice persists per user (dismissable), gating the activation toggle.

Pattern: inline disclosure card with `Acknowledge` checkbox required before the Activate button enables. Notice copy lives in the preset's `setupNotes` field (existing column).

### §16.3 Server status indicators

Quarantine and disabled states surfaced in the server list, distinct from the existing error state. Three states:

- `quarantined` — server administratively disabled by the platform team (e.g. unexpected egress detected). Reason visible to operators. Tools unavailable.
- `disabled` — operator-initiated disable. Tools unavailable. Re-enabling is operator-initiated.
- `error` — existing transient state (process crash, connection failure). Auto-recoverable.

Visual: status dot + label per existing pattern. No new status pills are introduced; the three states use existing dot colours (red / grey / amber).

### §16.4 Routing / audit visibility

Where a native integration has shadowed an MCP tool, the auxiliary `mcp.capability.shadowed` audit event is emitted (§18.4) — terminal MCP events do NOT fire when native shadowing bypasses MCP (§22.4). The audit log UI surfaces the shadowed events as a filtered view. No new page. The filter predicate is `eventType = 'mcp.capability.shadowed'` against the existing audit-log query — `routingDecision` is always `'mcp_shadowed_by_native'` on these entries by definition (§18.4).

Pattern: pre-filtered URL the operator can bookmark, e.g. `/connections/audit?eventType=mcp.capability.shadowed&serverId=<id>`.

---

## §17. File inventory lock

Every file the build touches is listed below. Prose references elsewhere in the spec that imply a file change without an inventory entry are a self-consistency failure — surface in the self-consistency pass (§24) before review.

### §17.1 Phase A — schema + server

| File | Action | Notes |
|---|---|---|
| `server/services/mcpClientManager.ts` | modify | Transport selector at `_connectSingleServer` (§9.1); env-var remapping at env construction site (§9.2); HTTP security posture wiring (§9.1); stdio spawns routed through `mcpSubprocessSpawner` for `cwd`, path restriction, egress proxy, ulimit, and the per-node / per-org semaphore (§9.6, §22.3). |
| `server/services/mcpClientManagerPure.ts` | new | Pure helpers for transport selection and env mapping projection. Vendor-error classification lives in `server/lib/mcpVendorErrorClassifier.ts` (single source — `mcpClientManagerPure.ts` consumes it). |
| `server/config/mcpPresets.ts` | modify | Phase A: extend `McpPreset` interface with `envVarMapping`, `allowedTools`, `riskTierMapping`, `versionPin`, `policyClass`, `requestTimeoutMs`, `allowedHosts`. No vendor preset entries are replaced in Phase A — placeholder entries remain. Real vendor preset entries (Brave / GitHub / Notion / Stripe / Slack) land per-vendor in Phase B (§17.6). Other 23 placeholder presets out of scope — handled in a follow-up cleanup build. |
| `server/services/mcpServerConfigService.ts` | modify | Add subaccount filter to `listForAgent` predicate (§9.3). |
| `server/services/mcpServerConfigServicePure.ts` | new | Pure helper `selectMcpCredential(orgConfig, subaccountConfig, runContext, policyClass)` implementing the §18.2 cascade (including the `shared-read-only-infrastructure` short-circuit) and any other config-selection logic for the §9.3 collision-semantics table. This file is the canonical home for cascade-selection logic. |
| `server/services/credentialBrokerService.ts` | modify | Add `issueCredentialForMcp(serverId, runContext)` method that calls `selectMcpCredential` (from `mcpServerConfigServicePure.ts`) to choose the cascade outcome. Three runtime branches: (a) `shared-system-key` → resolve the API key from a system env var named by the preset (e.g. `BRAVE_SEARCH_API_KEY`), bypassing per-tenant credential issuance; (b) `subaccount` / `org` → delegate to the existing `issueCredential` with the chosen config row; (c) `null` → throw a typed `MCP_SERVER_UNAVAILABLE` error and emit `mcp.server.unavailable`. |
| `server/services/credentialBrokerServicePure.ts` | no change | No new helper here — `selectMcpCredential` lives in `mcpServerConfigServicePure.ts` (canonical config-selection home). |
| `server/config/limits.ts` | modify | Add `MAX_MCP_SUBPROCESSES_PER_NODE` (default 4) and `MAX_MCP_SUBPROCESSES_PER_ORG` (default 2). No change to existing MCP budget constants. |
| `server/db/schema/mcpServerConfigs.ts` | modify | Extend `status` `$type` union from `'active' \| 'disabled' \| 'error'` to `'active' \| 'disabled' \| 'error' \| 'quarantined'` (per §22.7 state machine). No new column; `allowedTools` and `blockedTools` columns reused for the per-tool allowlist; `envEncrypted` covers env values. Type-only change — no migration required because the underlying column is `text`. **Reference-site coverage** (required, enforced by `verify-mcp-status-coverage.sh` per §17.3): any `z.enum([...])` validator in `server/routes/mcpServers.ts` that mirrors the status union; any service-layer guard / transition validator (e.g. in `mcpServerConfigService.ts`) keyed on status; the client-side status-mapping helper (icon / label / dot colour resolver) consumed by `client/src/components/connections/McpServerCard.tsx`; the §16.3 UI mapping. All four `'active' \| 'disabled' \| 'error' \| 'quarantined'` strings must appear in lockstep across server + client. |
| `server/services/policyEnvelopeResolver.ts` | no change | MCP invocations consume `agent_runs.policyEnvelopeJson` snapshot at invocation time. |
| `server/services/actionService.ts` | no change | Existing `proposeAction` → `resolveGateLevel` path is the gate. Wiring change is at the MCP boundary in `mcpClientManager`. |
| `server/routes/mcpServers.ts` | modify | No new routes. Existing `PATCH` adds per-tool allowlist via `allowedTools` field on the request body. |
| `server/lib/mcpSubprocessSpawner.ts` | new | Spawner wrapper owning per-run `cwd` via `fs.mkdtemp(...)`, path-restriction check on preset `args`, `HTTPS_PROXY` env injection for the per-org egress proxy, `ulimit`-style memory cap, and the per-node / per-org semaphore acquire/release (§22.3). Invoked from `mcpClientManager._connectSingleServer` in place of a direct `child_process.spawn` call. |
| `server/lib/mcpSubprocessReaper.ts` | new | Post-run reaper sweep; verifies no orphaned MCP subprocesses; runs at run termination boundary. |
| `server/lib/mcpVendorErrorClassifier.ts` | new | Pure classifier (`timeout` / `auth_failure` / `rate_limit` / `upstream_error` / `schema_mismatch` / `unknown`). |

### §17.2 Phase A — observability

| File | Action | Notes |
|---|---|---|
| `server/services/mcpAuditService.ts` | new | Structured-log emission for every MCP tool invocation per §9.7 contract. Wraps the existing audit-event emission. |
| `server/services/mcpAuditServicePure.ts` | new | Pure helper for audit-event shape construction. |

### §17.3 Phase A — CI gates

| File | Action | Notes |
|---|---|---|
| `scripts/gates/verify-mcp-version-pin.sh` | new | Greps preset args; fails on `@latest`, bare package names without `@x.y.z`, or git URLs. Additionally rejects any Phase B vendor preset whose `command` is not in `{npx, node}` (per §9.4 Phase B npm-only constraint). |
| `scripts/gates/verify-mcp-allowlist-coverage.sh` | new | Verifies every Phase B vendor preset (a) declares `allowedTools` (non-empty) and `riskTierMapping`, AND (b) every tool name in `allowedTools` resolves to a registered entry in `server/config/actionRegistry/mcp*.ts` with a Risk Tier that matches the `riskTierMapping` value. A tool listed in `allowedTools` without an action-registry entry fails the gate; a Risk Tier mismatch fails the gate. |
| `scripts/gates/verify-mcp-status-coverage.sh` | new | Greps for the four canonical status strings (`'active'`, `'disabled'`, `'error'`, `'quarantined'`) across `server/db/schema/mcpServerConfigs.ts`, `server/routes/mcpServers.ts`, `server/services/mcpServerConfigService.ts`, and `client/src/components/connections/McpServerCard.tsx` (plus any sibling status-mapper helper). Fails if any one site is missing a member. Closes the §22.7 state-set drift class. |
| `package.json` | modify | Wire the three new gates into the CI script set. |
| `.github/workflows/ci.yml` | modify | Add the three new gates to the Grep invariants job (or the closest existing equivalent). |

### §17.4 Phase A — UI

| File | Action | Notes |
|---|---|---|
| `client/src/pages/govern/ConnectionsPage.tsx` | no change | Reused without structural change. |
| `client/src/pages/govern/connections/AppIntegrationsTab.tsx` | modify | Add MCP server management section additions (§16). |
| `client/src/components/connections/McpServerCard.tsx` | new | Per-server card with collapsible tools panel + per-tool toggle + status indicator + shared-credential disclosure. |
| `client/src/components/connections/McpToolToggle.tsx` | new | Per-tool toggle component with Risk Tier pill. |

### §17.5 Phase A — docs

| File | Action | Notes |
|---|---|---|
| `docs/decisions/<next>-mcp-vendor-procurement.md` | new | ADR — version policy, `shared-read-only-infrastructure` policy class, vendor procurement workflow, CVE response. |
| `docs/capabilities.md` | modify | Update `integration-framework` Asset Register row Launch source + Last review + Carry notes to reference this build. Add MCP vendor onboarding capability under existing row's notes column. |
| `architecture.md` | modify | Update Key files per domain (MCP section) with the new files. Add subsection under "Integrations layer" describing the vendor MCP server onboarding path. |
| `KNOWLEDGE.md` | modify | Append onboarding playbook + dangerous-tool suppression patterns. |
| `server/config/rlsProtectedTables.ts` | no change | No new tenant-scoped tables introduced. |

### §17.6 Phase B — vendor onboardings

| File | Action | Notes |
|---|---|---|
| `server/config/mcpPresets.ts` | modify | Phase B incremental: each vendor preset enabled one at a time (Brave Search → GitHub → Notion → Stripe → Slack). Replacing the placeholder preset entries inline. |
| `server/config/actionRegistry/mcpBraveSearch.ts` | new | Brave Search action registry entries (read-only). |
| `server/config/actionRegistry/mcpGithub.ts` | new | GitHub action registry entries (read + write + destructive variants). |
| `server/config/actionRegistry/mcpNotion.ts` | new | Notion action registry entries. |
| `server/config/actionRegistry/mcpStripe.ts` | new | Stripe action registry entries (read + write + financial variants). |
| `server/config/actionRegistry/mcpSlack.ts` | new | Slack action registry entries (per-workspace OAuth + rate-limit awareness). |

### §17.7 Files explicitly NOT touched

- `server/middleware/orgScoping.ts` — no change. Subaccount cascade handled at the service-layer boundary, not via a new GUC.
- `server/services/connectionTokenService.ts` — no change. Existing AES-256-GCM credential storage is sufficient.
- `server/mcp/mcpServer.ts` and `server/routes/mcp.ts` — Synthetos-as-MCP-server, not Synthetos-as-MCP-client. Out of scope.

Note: `server/db/schema/mcpServerConfigs.ts` is a `modify` in §17.1 (type-union extension only — no migration). It is not in this "explicitly NOT touched" list.

---

## §18. Contracts

### §18.1 `McpPreset` extended interface

The `McpPreset` interface in `server/config/mcpPresets.ts` extends with these fields. Backwards compatible: existing 28 placeholder presets continue to load without setting the new fields (which default to safe values).

| Field | Type | Required | Default | Producer | Consumer |
|---|---|---|---|---|---|
| `envVarMapping` | `{ accessToken?: string; refreshToken?: string; apiKey?: string }` | no | `{ accessToken: 'ACCESS_TOKEN', refreshToken: 'REFRESH_TOKEN' }` (legacy) | preset definition | `mcpClientManager._connectSingleServer` env construction |
| `allowedTools` | `string[]` (tool names) | yes for Phase B vendors | `[]` (deny-all) | preset definition | orchestrator tool-list filter |
| `riskTierMapping` | `Record<string, RiskTier>` keyed by tool name | yes for Phase B vendors | `{}` (defaults to action-registry-declared tier) | preset definition | `verify-mcp-allowlist-coverage.sh` (static gate) + runtime drift detector (emits `mcp.risk.tier.drift`). NOT consumed by `resolveGateLevel` — the action-registry entry is the runtime source of truth (§11.1, §18.6). |
| `versionPin` | `string` (exact semver, no operators) | yes for Phase B vendors | n/a | preset definition | `verify-mcp-version-pin` CI gate + preset-load validator |
| `policyClass` | `'standard' \| 'shared-read-only-infrastructure'` | no | `'standard'` | preset definition | UI activation flow (§16.2) + ADR-codified eligibility |
| `requestTimeoutMs` | `number` (positive, ≤ 120_000) | no | `30_000` | preset definition | HTTP transport selector (§9.1) |
| `allowedHosts` | `string[]` (FQDNs) | required for every Phase B enabled vendor preset regardless of transport (HTTP servers use it for SSRF guard at the transport layer per §9.1; stdio servers use it for the infra firewall / NetworkPolicy rule per §9.6 / §23) | `[]` (empty list rejects the preset at preset-load validation) | preset definition | HTTP transport SSRF guard (§9.1) + infra egress firewall rule generator (§23) |

**Worked example — Brave Search preset:**

```typescript
{
  slug: 'brave-search',
  name: 'Brave Search',
  description: 'Web search via Brave Search API.',
  category: 'web-research',
  integrationType: 'mcp_server',
  transport: 'http',
  command: 'npx',
  args: ['-y', '@brave/brave-search-mcp-server@1.0.3'],
  versionPin: '@brave/brave-search-mcp-server@1.0.3',
  allowedHosts: ['api.search.brave.com'],
  envVarMapping: { apiKey: 'BRAVE_SEARCH_API_KEY' },
  allowedTools: ['brave_web_search', 'brave_news_search'],
  riskTierMapping: { brave_web_search: 0, brave_news_search: 0 },
  policyClass: 'shared-read-only-infrastructure',
  recommendedGateLevel: 'auto',
  requiresConnection: false,
  toolCount: 2,
  toolHighlights: ['Web search', 'News search'],
}
```

Exact version strings finalised at the procurement ADR; the above is illustrative.

### §18.2 Subaccount credential cascade — collision semantics

Pure function `selectMcpCredential(orgConfig, subaccountConfig, runContext, policyClass)` in `mcpServerConfigServicePure.ts` — `policyClass` is read from the preset (`McpPreset.policyClass`, §18.1) and passed explicitly so the function stays pure (no DB / preset lookup inside the helper). The config-row input shape includes a `status` enum (`'active' \| 'disabled' \| 'error' \| 'quarantined'` per §22.7) AND credential-level flags (`credentialRevoked: boolean`, `credentialExpiresAt: string | null` for OAuth) so the helper can decide cascade without an extra IO hop. Returns one of:

| Case (precedence order — first match wins) | Returned value | `credentialCascadeResult` (§18.4) |
|---|---|---|
| Preset `policyClass === 'shared-read-only-infrastructure'` AND the named system env var (`McpPreset.envVarMapping.apiKey`) is set in `process.env` | `sharedSystemKey` — system-level API key resolved via env config; bypasses the per-tenant cascade | `'shared-system-key'` |
| Preset `policyClass === 'shared-read-only-infrastructure'` AND the named system env var is unset / empty | `null` — caller emits `mcp.server.unavailable` with `vendorErrorClass: 'auth_failure'` | `null` |
| `subaccountConfig.status === 'quarantined'` | `null` — caller emits `mcp.server.unavailable`; quarantine is terminal (§22.7); no fallthrough to org | `null` |
| `orgConfig.status === 'quarantined'` (any subaccount state) | `null` — caller emits `mcp.server.unavailable`; org quarantine takes priority over subaccount config | `null` |
| `subaccountConfig.status === 'active'` AND `credentialRevoked === false` AND credential not expired | `subaccountConfig` | `'subaccount'` |
| `subaccountConfig.status === 'disabled'` AND `orgConfig.status === 'active'` AND org credential active | `orgConfig` (cascade through operator-disabled) | `'org'` |
| `subaccountConfig.status === 'error'` AND `orgConfig.status === 'active'` AND org credential active | `orgConfig` (cascade through transient subaccount error) | `'org'` |
| `subaccountConfig.credentialRevoked === true` AND `orgConfig.status === 'active'` AND org credential active | `orgConfig` (cascade through subaccount revocation) | `'org'` |
| `subaccountConfig` credential expired (`credentialExpiresAt < now`) AND `orgConfig.status === 'active'` AND org credential active | `orgConfig` (cascade through subaccount expiry) | `'org'` |
| `subaccountConfig` absent AND `orgConfig.status === 'active'` AND org credential active | `orgConfig` | `'org'` |
| Both absent / both disabled / both revoked / both expired / both errored | `null` — caller emits `mcp.server.unavailable` | `null` |

**Status precedence summary:**

- `quarantined` is **terminal** at its tier — no cascade through. Subaccount quarantine fails closed at the subaccount layer; org quarantine fails closed regardless of subaccount state.
- `error`, `disabled`, `credentialRevoked`, `credentialExpired` all **cascade through** to the next available tier if the next tier is healthy.
- `active` + credential-healthy is the only state that returns the config row.

**Source-of-truth precedence (when both representations exist):** `policyClass === 'shared-read-only-infrastructure'` > org-quarantined > subaccount-quarantined > subaccount-active > org-active > null. The losing config is never silently merged.

### §18.3 Vendor-error classifier — closed taxonomy

Pure function `classifyVendorError(error)` in `mcpVendorErrorClassifier.ts`. Returns:

| Class | Trigger |
|---|---|
| `timeout` | Request exceeded `requestTimeoutMs` or stdio call exceeded `MCP_CALL_TIMEOUT_MS` |
| `auth_failure` | Vendor returned 401/403 or stdio server signalled auth-required |
| `rate_limit` | Vendor returned 429 or vendor-specific rate-limit signal |
| `upstream_error` | Vendor returned 5xx |
| `schema_mismatch` | Tool returned data shape that the preset's declared schema cannot parse |
| `unknown` | Anything else; surfaces in audit log for triage |

Closed enum. New classes require a spec amendment.

### §18.4 MCP audit-log entry shape

Persisted to the existing `audit_events` stream (or `security_audit_events` where the action is security-sensitive, per the architecture's Layer 4 stream split). One entry per MCP tool invocation.

Discriminated union — terminal-invocation events carry `status` + `invocationSequence`; auxiliary observability events do not. The five terminal-event types in §22.4 are the only ones that count against the exactly-one-terminal-event invariant.

```typescript
type McpAuditCommonFields = {
  runId: string;
  agentId: string;
  organisationId: string;
  subaccountId: string | null;
  serverId: string;
  toolName: string | null;          // null only for server-level events (`mcp.server.unavailable`).
                                    // Dedup invariant: `invocationSequence` is monotonic per `(runId, serverId)`,
                                    // not per `(runId, serverId, toolName)`. Multiple null-`toolName` attempts in
                                    // the same run (e.g. retried unavailable connections) are uniquely keyed by
                                    // ascending invocationSequence. See §22.1.
  durationMs: number | null;        // null for auxiliary events
  statusCode: number | null;
  vendorErrorClass: VendorErrorClass | null;  // §18.3 — null for auxiliary events without a vendor call
  credentialCascadeResult: 'subaccount' | 'org' | 'shared-system-key' | null;  // §18.2
  policyEnvelopeJsonHash: string;             // links to agent_runs.policyEnvelopeJson
  emittedAt: string;  // ISO 8601
};

type McpAuditTerminalEntry = McpAuditCommonFields & {
  eventType:
    | 'mcp.tool.invoked'
    | 'mcp.tool.failed'
    | 'mcp.tool.disallowed'
    | 'mcp.tool.unregistered'
    | 'mcp.server.unavailable';
  status: 'success' | 'failed';                // §22.4 — terminal-event status; no 'partial' for MCP (§22.5)
  invocationSequence: number;                  // §22.1 — composite-key dedupe field; monotonic per (runId, serverId). See toolName field comment above for the null-toolName dedup invariant.
  routingDecision: 'mcp';                      // Terminal events only fire when MCP actually ran. Native-shadow cases emit the auxiliary `mcp.capability.shadowed` event instead (§10.3, §22.4).
  shadowedNativeCapabilityId: null;            // Never set on terminal entries; see auxiliary entry for shadowed routing.
};

type McpAuditAuxiliaryEntry = McpAuditCommonFields & {
  eventType:
    | 'mcp.schema.drift'
    | 'mcp.capability.shadowed'
    | 'mcp.risk.tier.drift';
  // No `status` — auxiliary events are observability-only and do not have success/failed semantics.
  // No `invocationSequence` — auxiliary events do not count against the §22.4 terminal-event invariant.
  // `mcp.capability.shadowed` carries the routing context when native shadows MCP:
  routingDecision: 'mcp_shadowed_by_native' | null;  // Set on `mcp.capability.shadowed` events; null otherwise.
  shadowedNativeCapabilityId: string | null;          // Set on `mcp.capability.shadowed` events.
};

type McpAuditEntry = McpAuditTerminalEntry | McpAuditAuxiliaryEntry;
```

Credentials never logged. Tool input/output payloads logged through the existing `redaction.ts` bundle before persistence.

### §18.5 Capability registry — `vendor-mcp` source marker

Asset Register row schema extends to allow `source: 'vendor-mcp'` rows. The five Phase B vendors are added under the `integration-framework` row's notes column, not as new top-level rows. The `source` marker enables filtered listings (e.g. "show all vendor-MCP-backed capabilities") without polluting the cluster header counts.

### §18.6 Source-of-truth precedence — multi-representation

| Fact | Sources | Precedence (winner first) |
|---|---|---|
| Credential resolution | `mcp_server_configs` (org), `mcp_server_configs` (subaccount), runtime cache | subaccount config > org config; runtime cache never reused after revoke |
| Tool schema | preset declaration, live server schema at first connection (in-memory per run), `mcp_server_configs.discoveredToolsJson` + `discoveredToolsHash` (persisted snapshot) | live server schema (in-memory) > persisted snapshot > preset declaration. The persisted snapshot is refreshed on every connection; the preset declaration is only the orchestrator's routing hint. |
| Risk Tier | `riskTierMapping` (preset), action-registry entry | action-registry entry > `riskTierMapping`. The preset declares the expected tier; action-registry enforces. Mismatch logged as `mcp.risk.tier.drift`. |
| Per-tool allowlist | preset `allowedTools` (eligible menu), `mcp_server_configs.allowedTools` (operator selection) | Runtime allowlist = preset menu ∩ operator selection. Operator entries not in the preset menu are silently ignored; preset entries not in the operator selection are blocked with `mcp.tool.disallowed`. See §16.1. |
| Policy snapshot | `agent_runs.policyEnvelopeJson` (run-start), per-invocation re-fetch | run-start snapshot only. No mid-run re-resolution. |

---

## §19. Permissions / RLS checklist

No new tenant-scoped tables introduced. Existing tables touched:

- `mcp_server_configs` — already in `server/config/rlsProtectedTables.ts`. Subaccount cascade enforced at the service-layer boundary, not via dual-GUC.
- `audit_events` / `security_audit_events` — already in the manifest. New event types listed in §18.4 inherit the same RLS posture.
- `mcp_server_agent_links` — already in the manifest.

**Canonical RLS-posture sentence:** *RLS enforces the organisation boundary; subaccount filtering is service-layer.* The subaccount filter added to `listForAgent` (§9.3) is the service-layer enforcement.

**Route guards:**

- `GET /api/mcp-servers` — `MCP_SERVERS_VIEW` (existing).
- `POST/PATCH/DELETE /api/mcp-servers/...` — `MCP_SERVERS_MANAGE` (existing).
- Subaccount-scoped routes inherit `resolveSubaccount` middleware (existing).

No new permission keys introduced.

**Principal-scoped context:** MCP invocations execute inside the agent run; the principal-scoped GUC is already set by the agent execution loop. No new principal context required.

---

## §20. Execution model

- **`mcpClientManager._connectSingleServer`** — synchronous from the caller's perspective. The caller (agent run, orchestrator) blocks on connection establishment within `MCP_CONNECT_TIMEOUT_MS`.
- **`mcpClientManager.callTool`** — synchronous. The agent run blocks on the tool call within `MCP_CALL_TIMEOUT_MS`. No queueing.
- **Subprocess reaper sweep** — synchronous at run termination boundary. Wraps the existing run-termination path.
- **CI gate execution** — synchronous in the CI pipeline. Fails fast.
- **Vendor-procurement ADR review cadence** — manual; quarterly per §15.
- **Capability registry updates** — synchronous, in the same commit as the preset change.

No new pg-boss jobs. No new asynchronous boundaries. MCP transport is inherently synchronous within the agent run lifecycle.

---

## §21. Phase sequencing — dependency graph

**Phase A → Phase B is a hard sequence.** Phase A merges to main before Phase B's first vendor (Brave Search) ships.

Within Phase A, the seven prereqs have internal dependencies:

```
Prereq 4 (version pinning) ──┬──> Prereq 2 (env mapping)  ──> Prereq 7 (observability)
                              │
Prereq 5 (capability routing)─┤
                              │
Prereq 3 (subaccount scoping)─┤
                              │
Prereq 1 (HTTP transport)  ───┤
                              │
Prereq 6 (subprocess isolation)
```

- **Prereq 4 first** — version pinning ships independently and unblocks the rest because every other prereq needs a pinned preset to test against.
- **Prereqs 1 / 3 / 5 / 6** — parallel after Prereq 4.
- **Prereq 2** — depends on Prereq 4 (preset shape change) and Prereq 5 (capability registry contract).
- **Prereq 7** — depends on all the above (observability instrumentation wraps each prereq's surface).

Within Phase B, vendors ship strictly sequentially per §10 order. Each vendor's negative-path tests (§12.2) gate the next vendor's onboarding.

**No backward dependencies.** No phase references a column / table / service / migration introduced in a later phase. The build introduces no new database migrations.

---

## §22. Execution-safety contracts

### §22.1 Idempotency posture

- **`mcpClientManager.callTool`** — `non-idempotent (intentional)`. Vendor tool calls may have side-effects (post, create, charge). Retries are gated by the §22.2 retry classification, not by idempotency.
- **Subaccount credential cascade resolution** — `safe`. Pure read against config tables; deterministic for a given `(orgId, subaccountId, runContext)`.
- **Capability registry preset load** — `state-based`. Preset registration is idempotent against the existing registry; re-running preset load returns the same registry.
- **MCP audit-log emission** — `key-based`. Composite key `(runId, serverId, toolName, invocationSequence)` for terminal events. `invocationSequence` is monotonic **per `(runId, serverId)`** — not per `(runId, serverId, toolName)`. This means distinct attempts that share `(runId, serverId)` always get distinct sequence numbers, so server-level events with `toolName === null` (e.g. multiple `mcp.server.unavailable` connection attempts in the same run) are still uniquely keyed by ascending `invocationSequence`. Re-emission with the same composite key is a no-op. Auxiliary events (§18.4) are observability-only and not part of the dedup contract.

### §22.2 Retry classification

| Operation | Class | Boundary |
|---|---|---|
| MCP transport connect | `guarded` | Retry up to 3x within `MCP_CONNECT_TIMEOUT_MS`; circuit-breaker after `MCP_CIRCUIT_BREAKER_THRESHOLD` failures |
| MCP tool call (read-only) | `safe` | Idempotent at the orchestrator level; retry up to 3x |
| MCP tool call (write / financial / destructive) | `unsafe` | No automatic retry. Caller bears retry risk. Operator must re-trigger. |
| Vendor HTTP request | `guarded` | Exponential backoff with jitter, max 3 attempts, only for `timeout` and `upstream_error` classes |
| Vendor HTTP request (Risk Tier 4+) | `unsafe` | No automatic retry under any condition |
| Audit-log emission | `safe` | Idempotent under §22.1 key-based posture |

### §22.3 Concurrency guards

- **Per-node MCP subprocess ceiling** — `MAX_MCP_SUBPROCESSES_PER_NODE` (initial 4). Enforced in `mcpSubprocessSpawner` (§17.1) as a process-local semaphore acquired before the underlying `child_process.spawn` call and released on subprocess exit / reaper sweep. Excess spawn requests block until a slot frees or the run's `MCP_CONNECT_TIMEOUT_MS` expires.
- **Per-org MCP subprocess ceiling** — `MAX_MCP_SUBPROCESSES_PER_ORG` (initial 2). Same spawner-owned semaphore, org-keyed via a `Map<orgId, semaphore>`. Prevents a single org monopolising slots.
- **Concurrent tool invocation per run** — bounded by `MAX_MCP_CALLS_PER_RUN` (existing 10) and `MAX_MCP_TOOLS_PER_RUN` (existing 30).
- **Subaccount cascade race** — pure function, no concurrency surface.
- **Capability registry registration** — single-writer pattern. Registry is loaded once at boot; no runtime mutation.

### §22.4 Terminal event guarantee

Every MCP tool invocation chain emits exactly one terminal event. Terminal events are mutually exclusive:

- `mcp.tool.invoked` (status `success`) — tool completed and output processed.
- `mcp.tool.failed` (status `failed`) — tool returned an error or was not invokable.
- `mcp.tool.disallowed` (status `failed`) — tool not in `allowedTools`.
- `mcp.tool.unregistered` (status `failed`) — tool not in action registry.
- `mcp.server.unavailable` (status `failed`) — server-level failure prevented the invocation.

No `status: 'partial'` for MCP — each tool call either completes or fails. Post-terminal prohibition: no further terminal events with the same `(runId, serverId, toolName, invocationSequence)` after the terminal. For server-level events with `toolName === null` (`mcp.server.unavailable`), the prohibition applies to the same `(runId, serverId, null, invocationSequence)` tuple — multiple unavailable attempts in the same run are allowed and uniquely keyed by ascending `invocationSequence` per §22.1; only the SAME numbered attempt cannot re-emit a terminal.

### §22.5 No-silent-partial-success

Vendor tools that return partial data (e.g. paginated lists where the last page failed) emit `mcp.tool.failed` with `vendorErrorClass: 'upstream_error'`. The orchestrator must reconcile partial results. No silent partial-success surface.

### §22.6 Unique-constraint-to-HTTP mapping

No new database unique constraints introduced. All existing unique-constraint mappings (e.g. `mcp_server_configs.org_slug_unique`) continue their current behaviour (409 on conflict).

### §22.7 State machine — server status

The `mcp_server_configs.status` field extends from existing states to include `quarantined` and `disabled`. Valid transitions:

```
initial → active     (operator activates)
active → error       (transient failure; auto-recoverable)
error → active       (recovery)
active → disabled    (operator disables)
disabled → active    (operator re-enables)
active → quarantined (platform team disables)
error → quarantined  (platform team escalates)
quarantined → active (platform team clears)
```

Forbidden transitions:

- `disabled → quarantined` (operator must clear disable before quarantine applies)
- `quarantined → disabled` (platform team must clear quarantine before operator regains control)
- `quarantined → error` (quarantine is terminal until platform clears)

The status set is closed; new statuses require a spec amendment.

---

## §23. Deferred items

- **Migration into the e2b sandbox runtime pool.** Phase A ships with process-level isolation. Whether MCP subprocesses eventually migrate into the e2b pool (alongside the existing IEE sandbox flow) is deferred to a separate spec. Reason: process-level isolation passes the V1 trust boundary; pool migration is a separate architectural choice with broader implications. Tracked as open question §27.
- **Pruning the 23 remaining placeholder presets.** Phase B enables 5 vendor presets (Brave Search, GitHub, Notion, Stripe, Slack) one at a time. The other 23 placeholder presets remain in the catalogue, unbuilt. Reason: pruning them touches catalogue UI semantics (presets that disappear from the UI catalogue mid-flight surprise tenants). Out of scope; tracked as a follow-up cleanup build.
- **MCP latency / cost / error dashboards.** Observability instrumentation ships in Phase A; the Grafana dashboards consuming those metrics are not in this build. Reason: dashboard authoring requires production traffic to calibrate thresholds. Defer until at least one vendor has a week of beta-tenant traffic.
- **Per-vendor compatibility regression suite.** Phase B vendor onboardings each ship with negative-path tests. A cross-vendor compatibility regression suite (verify all five vendors still pass after a Node runtime upgrade) is deferred until at least three vendors have shipped. Reason: premature suite would be over-fit to the first vendor's failure modes.
- **Python (uvx) vendor servers.** The MCP server compatibility criteria (§13) explicitly require Node.js. Python (`uvx`) is evaluated case-by-case. No Phase B vendor is Python today. If a future vendor only ships a Python MCP server, that build authors a separate spec extending §13.
- **`mcp.capability.shadowed` operator dashboard.** Brief §6 implies a filtered audit-log view (§16.4). A dedicated dashboard surfacing aggregate shadowing rates is deferred until operators ask for one — current filter is sufficient signal for forensics.
- **Per-tool allowlist diff view for tenant operators.** §15 mentions platform supplies the diff view. The mechanical implementation is out of scope — when tenants ask, ship as a follow-up.
- **Automatic per-tool variant extraction.** §11.3 says tools that bundle read+write under one callable are flagged at preset load. Automating the variant extraction (so the procurement ADR review pass becomes mechanical) is deferred to a follow-up build.
- **Egress firewall / NetworkPolicy wiring.** §8 and §9.6 state that hard egress enforcement lives at the infra firewall / Kubernetes NetworkPolicy layer outside this codebase. Wiring the actual NetworkPolicy / iptables rules for the union of declared `allowedHosts` + the per-org egress proxy is an infra build, not an application build, and is deferred. Per-vendor enablement gate: a vendor whose Risk Tier classification includes any `write` / `financial` / `destructive` action (per §11.1) is BLOCKED from Phase B enablement until the infra egress rule covering that vendor's `allowedHosts` is in place. Read-only vendors in the `shared-read-only-infrastructure` policy class (Brave Search initially) may enable with best-effort in-process controls only, with the procurement ADR recording the gap. Stripe, GitHub (write surface), Notion (write surface), Slack are all blocked until the infra rule lands for their respective `allowedHosts`.
- **Automated npm provenance gate.** §9.4 defers checksum/signature validation to the procurement ADR's per-vendor manual review at version-bump time. A future CI gate `scripts/gates/verify-mcp-provenance.sh` that queries `npm view <pkg>@<version> dist.signatures` and enforces the attestation against a known publisher key is deferred until (a) the npm CLI provenance surface stabilises and (b) the procurement ADR confirms which vendors publish attestations.

---

## §24. Self-consistency pass result

Run before review submission. Each item below resolved on the draft.

- **Goals ↔ implementation match.** Phase A goals (seven prereqs) map 1:1 to §9 subsections. Phase B goals (five vendor onboardings) map 1:1 to §10.1 and §10.2 subsections.
- **File inventory drift.** Every new file referenced in §9–§22 is in §17. Specifically: `mcpClientManagerPure.ts`, `mcpServerConfigServicePure.ts`, `mcpAuditService.ts`, `mcpAuditServicePure.ts`, `mcpSubprocessSpawner.ts`, `mcpSubprocessReaper.ts`, `mcpVendorErrorClassifier.ts`, the five action-registry vendor files, the **three** CI gate scripts (`verify-mcp-version-pin.sh`, `verify-mcp-allowlist-coverage.sh`, `verify-mcp-status-coverage.sh`), the two new UI components.
- **Numeric count reconciliation.**
  - Phase A prerequisites: 7 (§4 goal 1, §7 phase plan, §9 subsection count) — match.
  - Phase B vendors: 5 (§4 goal 2, §7 phase plan, §10.0 table, §10.2 listing) — match.
  - HTTP transport security posture bullets: 6 (§9.1) — match.
  - Subaccount cascade cases: 6 (§9.3 user-visible table — adds the `shared-read-only-infrastructure` short-circuit row) and 11 (§18.2 function-return table — expanded to model `quarantined` / `revoked` / `expired` / `error` states per ChatGPT R1 F3) — reconciled in §18.2 prose; §9.3 lists user-visible cases, §18.2 collapses to function return cases. The §18.2 count grew from 5 → 11 in R1; §9.3 unchanged.
  - Vendor error classifier classes: 6 including `unknown` (§18.3) — match.
  - MCP audit event types: 8 total (§18.4 discriminated union) — 5 terminal (`mcp.tool.invoked`, `mcp.tool.failed`, `mcp.tool.disallowed`, `mcp.tool.unregistered`, `mcp.server.unavailable` — match §22.4) + 3 auxiliary (`mcp.schema.drift`, `mcp.capability.shadowed`, `mcp.risk.tier.drift`). The terminal-event count matches §22.4 exactly.
  - State machine valid transitions: 8 (§22.7) — match.
  - State machine forbidden transitions: 3 (§22.7) — match.
  - CI gates: 3 in §17.3 (`verify-mcp-version-pin`, `verify-mcp-allowlist-coverage`, `verify-mcp-status-coverage`) — match.
  - Server status enum members: 4 (`active`, `disabled`, `error`, `quarantined`) — §22.7 state machine, §17.1 `$type` extension, and the `verify-mcp-status-coverage.sh` grep all reference the same four strings.
- **Single-source-of-truth claims.** §18.6 captures every multi-representation fact and pins precedence.
- **Load-bearing claim → mechanism.** Every "must", "guarantees", "deny-all", "idempotent" has a named mechanism: `verify-mcp-version-pin`, `verify-mcp-allowlist-coverage`, the subaccount filter at `listForAgent`, the per-node and per-org semaphores, the post-run reaper sweep, the audit-event composite key, the action-registry block on unregistered tools.
- **Phase dependency graph.** §21 has no backward references.
- **Testing posture match.** §12.3 lists frontend / API / E2E / performance as out of scope per `docs/spec-context.md`. All in-scope tests are pure-function.
- **No new migrations.** §17.1 row `server/db/schema/mcpServerConfigs.ts` is `modify` (type-union extension only — `'active' \| 'disabled' \| 'error' \| 'quarantined'`) without a Drizzle migration; the underlying column is `text` so no DB change is required. §19 confirms no new tenant-scoped tables.

---

## §25. Testing posture statement

Per `docs/spec-context.md`:

- `testing_posture: static_gates_primary` — primary signal comes from grep gates (`verify-mcp-version-pin`, `verify-mcp-allowlist-coverage`), TypeScript compilation, and pure-function tests at boundary points.
- `runtime_tests: pure_function_only` — `mcpClientManagerPure.ts`, `mcpServerConfigServicePure.ts`, `mcpAuditServicePure.ts`, `mcpVendorErrorClassifier.ts` ship with pure-function vitest tests for transport selection, cascade resolution, audit-event shape construction, vendor-error classification.
- `frontend_tests: none_for_now` — the four UI additions ship without unit tests; visual verification by the operator at Phase B beta-tenant onboarding.
- `api_contract_tests: none_for_now` — no supertest harness for the `/api/mcp-servers` routes; existing route shapes unchanged.
- `e2e_tests_of_own_app: none_for_now` — vendor onboardings validated by negative-path pure-function tests (§12.2) + manual beta-tenant validation per vendor.
- `composition_tests: defer_until_stabilisation` — no integration tests asserting Phase A + Phase B compose correctly. The negative-path test per vendor (§12.2) is sufficient signal.

If a Phase B vendor surfaces a test category that the framing defers (e.g. a vendor explicitly requires an API contract test to catch a known shape drift), the spec is amended in the same PR rather than silently introducing the framework.

---

## §26. Risks

Risks updated from brief §9 with new identified items.

| Risk | Mitigation |
|---|---|
| Vendor server has security flaw | Version pinning (§9.4) + procurement ADR + per-run resource budgets + `MCP_ALLOWED_COMMANDS` allowlist |
| Vendor expects incompatible auth shape | `envVarMapping` (§9.2) covers most; document and skip otherwise |
| Vendor API breaks the MCP server | Pin version; treat as standard third-party dependency; CVE response per §15 |
| Cross-tenant credential leak via misconfigured preset | Subaccount cascade filter in `listForAgent` (§9.3); negative-path test (§12.2 "Tenant-isolation regression") |
| Subprocess escapes filesystem isolation | Process-level isolation enforcement (§9.6); audit-log on subprocess spawn |
| HTTP transport enables SSRF | Host allowlist enforced at connection layer + per-process domain restriction (§9.1) |
| Capability explosion degrades orchestrator clarity | Per-tool allowlisting (§11.4); >50-tool servers blocked until reviewed (§11.6) |
| Native + MCP capability conflict causes incorrect routing | Overlap contract (§10.3); native always preferred; MCP marked `supplement`; routing decision in audit log (§18.4) |
| Shared Brave Search credential exposes tenant query patterns | Accepted trade-off (§10.1); operator disclosure required (§16.2); codified as `shared-read-only-infrastructure` policy class in the ADR |
| Subprocess concurrency ceiling too low under load | Configurable per node + per org (§9.6, §22.3); tuning via §15 cadence; load test before raising |
| Audit-log volume explodes | Per-invocation entry redaction via existing `redaction.ts`; entry shape minimal (§18.4); no payload duplication |
| Action-registry coverage gap silently allows unregistered tool | Hard block at orchestrator boundary (§11.2); `mcp.tool.unregistered` audit event; CI gate `verify-mcp-allowlist-coverage` enforces both preset coverage AND that every `allowedTools` entry has a matching action-registry entry (§17.3) |
| Vendor changelog drift after pin → broken upgrade path | Manual upgrade with changelog review (§9.4); rollback by version-string revert; no runtime state to unwind |
| Phase A prereq breaks an in-flight vendor (not yet in §10 list) | Phase A ships before any vendor enabled; placeholder presets remain stubbed; Phase B vendors land one at a time |

---

## §27. Open questions

These resolve in the spec body, the procurement ADR, or during Phase A implementation.

1. **Long-term home for MCP execution.** Process-level path restriction for V1; Phase 2 migration into the e2b sandbox pool deferred. Decision deadline: before Phase B vendor 5 (Slack) ships, evaluate whether process-level posture has held under load.
2. **Concurrency ceiling defaults.** Initial `MAX_MCP_SUBPROCESSES_PER_NODE = 4`, `MAX_MCP_SUBPROCESSES_PER_ORG = 2`. Right initial cap for our deployment shape? Validate against the production node-class during Phase A implementation; revisit if a Phase B vendor hits the ceiling during beta.
3. **`shared-read-only-infrastructure` ADR approval workflow.** The ADR codifies eligibility criteria. The approval workflow for adding new vendors to the class (who signs off; what cadence; what audit trail) — finalised in the ADR, not pre-committed here.
4. **`mcp.capability.shadowed` UI surface depth.** §16.4 ships a filtered audit-log view. A dedicated dashboard surfacing aggregate shadowing rates per native-vendor pair is deferred (§23). Operator feedback during Phase B beta determines whether the dashboard ships in a follow-up build.
5. **Per-tool risk-tier auto-extraction.** §11.3 keeps variant extraction manual per vendor in the ADR review pass. Automating the extraction (so adding a new vendor's tools becomes mechanical rather than ADR-gated) is open; address after three vendors have shipped and a pattern is clear.
6. **HTTP transport across more vendors.** Brave Search is the only Phase B HTTP-transport vendor. If GitHub or Notion ships an HTTP-only server before this build merges, the spec is amended to add their `allowedHosts` rather than deferring.
7. **Action-registry file split.** §17.6 lists five files under `server/config/actionRegistry/`. If the action-registry index file already exceeds a threshold (e.g. 600 LOC), the spec is amended to add a barrel-file split at the same time. The implementer judges at Phase A start.
