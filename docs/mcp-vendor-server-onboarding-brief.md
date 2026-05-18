# MCP Vendor Server Onboarding — Implementation Brief

> **Status:** Locked — approved for spec authoring
> **Date:** 2026-05-18
> **Origin:** Open-source ecosystem research (May 2026) + deep-dive into `server/services/mcpClientManager.ts`, `server/config/mcpPresets.ts`, `server/services/integrationConnectionService.ts`.
> **Why now:** Our MCP infrastructure is production-grade but the 28-server preset catalogue points at placeholder package names (`@anthropic/*-mcp-server@1.0.0`) that do not exist on npm. Real vendor MCP servers shipped in 2025-2026 (GitHub, Notion, Stripe, Slack, Brave Search). Each unlocks dozens of agent skills with no per-skill engineering.
> **Business value:** Each onboarded vendor server adds a whole category of agency-deliverable work. Roughly one to two days per server after cross-cutting prerequisite work lands.

---

## 1. Business framing

Synthetos is differentiated by tenant isolation, approval governance, agent identity, and operator correction. The *skills* are commoditising: every major SaaS vendor is publishing an MCP server in 2025-2026. Adopting five this month leapfrogs every agency-side competitor still hand-rolling integrations.

We already built the hard part: client manager with lifecycle, resource budgets, tool routing (`server/services/mcpClientManager.ts`); per-org and per-subaccount credential scoping with AES-256-GCM encryption (`server/services/connectionTokenService.ts`); preset catalogue, CRUD routes, tenant UI (`server/config/mcpPresets.ts`, `server/routes/mcpServers.ts`, `client/src/pages/McpServersPage.tsx`); per-run safety budgets (`server/config/limits.ts:515-539`).

Missing: seven pieces of plumbing and the swap from placeholder packages to real ones.

**Governance scaling note.** Large MCP servers can expose hundreds of tools. The onboarding standard (§8) and governance integration (§6) are designed to prevent capability explosion: per-tool allowlisting, operator visibility, and dangerous-tool suppression are required before any server with >20 exposed tools is onboarded.

---

## 2. Current state

| Component | Location | Status |
|---|---|---|
| Client manager | `server/services/mcpClientManager.ts` | Production, stdio-only transport |
| Preset catalogue (28 entries) | `server/config/mcpPresets.ts` | Placeholder packages |
| Config CRUD + tenant UI | `server/routes/mcpServers.ts`, `client/src/pages/McpServersPage.tsx` | Production |
| Synthetos-as-MCP-server | `server/mcp/mcpServer.ts`, `server/routes/mcp.ts` | Production |
| Credential broker | `server/services/credentialBrokerService.ts` | Working; MCP path uses generic `ACCESS_TOKEN` env var |
| Per-run budgets | `server/config/limits.ts:515-539` | Working |
| Capability registration | `docs/capabilities.md` | Vendor MCP tools not yet registered |

---

## 3. Trust boundary model

Vendor MCP servers are **semi-trusted subprocesses**. They run on our infrastructure but execute third-party code with credentials in their environment. This has concrete implications:

| Surface | Posture |
|---|---|
| Filesystem access | Restricted to a per-run temporary working directory; other paths not granted at OS level (enforcement: process-level working directory + path restriction, not container isolation) |
| Network egress | Restricted to declared vendor API endpoints; no arbitrary outbound |
| Credential visibility | Credentials injected as env vars scoped to the subprocess; not visible to sibling processes; env vars not written to disk; OS process teardown clears the env namespace on exit; core dumps disabled for MCP subprocesses; credentials resolved fresh per run, not reused across runs |
| Prompt injection | Tool outputs treated as untrusted; not interpolated into system prompts without sanitisation |
| Logging | All tool calls and outputs logged to the audit trail; credentials redacted |
| Subprocess trust | Not treated as trusted code; sandbox posture equivalent to the existing e2b runtime strategy |

The trust boundary sits between the Synthetos orchestrator and each spawned MCP subprocess. The orchestrator is trusted; the MCP server and all data it returns are untrusted until processed through the existing tool-output pipeline.

## 4. Cross-cutting prerequisites

Seven items unlock every subsequent server. Total: 8 to 12 engineering days.

### Prereq 1 — HTTP transport (1-2 days)

Add `StreamableHTTPClientTransport` import and transport-selector based on the `transport` field already present in `server/db/schema/mcpServerConfigs.ts:31`. Test end-to-end with Brave Search (HTTP).

**Required HTTP transport security posture (must ship with Prereq 1, not later):**

- TLS enforced for all HTTP MCP connections; plaintext connections rejected
- Host allowlisting: only declared preset domains accepted; outbound connection to unlisted hosts blocked (SSRF prevention)
- Request timeout: default 30 s; configurable per preset; hard ceiling 120 s
- Retry semantics: exponential backoff, max 3 attempts, non-idempotent tool calls not retried
- Auth-header handling: Bearer tokens injected server-side; never forwarded from client requests
- Streaming cancellation: AbortController wired to run lifecycle; orphaned streams cleaned up on run termination
- Outbound domain restrictions enforced at the process level, not just config validation

### Prereq 2 — Env-var name remapping (1 day)

Today the child gets `ACCESS_TOKEN` (`server/services/mcpClientManager.ts:610-611`). Vendor servers expect `GITHUB_TOKEN`, `STRIPE_SECRET_KEY`, `SLACK_BOT_TOKEN`. Add `envVarMapping` to preset shape; apply before spawn.

### Prereq 3 — Subaccount credential scoping (1 day)

`listForAgent(agentId, organisationId)` does not filter MCP visibility by `subaccountId` (`server/services/mcpServerConfigService.ts:182-208`). Real tenant-leak risk for agencies serving multiple clients. Add the filter; respect subaccount-first cascade with org fallback.

**Credential-cascade collision semantics (explicit contract):**

| Case | Resolution |
|---|---|
| Both org and subaccount configs exist | Subaccount config takes precedence; org config ignored for this agent |
| Subaccount config exists but credential is disabled | Fall through to org config; do not silently fail |
| Org credential revoked, active subaccount credential | Subaccount credential used; org revocation does not propagate down |
| No org, no subaccount credential | Server unavailable for this run; logged as `mcp_server_unavailable`; run continues without it |
| Agent reassigned between subaccounts | Credential resolved fresh per run against the current subaccount; no caching of prior resolution |

### Prereq 4 — Version pinning + supply-chain guard (1 day)

Preset args use `npx -y @vendor/server@latest` which auto-updates on every run (the same surface the Smithery incident exploited). Pin every server to a specific version. Add CI check that flags `@latest`. Author `docs/decisions/<next>-mcp-vendor-procurement.md`.

**Version policy operational contract (summarised here; detail in ADR):**

- All presets pinned to exact semver (e.g. `@notionhq/notion-mcp-server@1.1.0`)
- Upgrade path: manual bump in preset + changelogs reviewed + re-test before merge
- Rollback: revert preset version string; no runtime state to unwind
- Vulnerability response: CVE triggers immediate version freeze and incident review before any upgrade
- Checksum/signature validation: enforced in CI against npm provenance where available
- Package source allowlisting: only npm registry; no git URLs, no file: paths

### Prereq 5 — Capability routing contract (1 day)

Extend `docs/capabilities.md` schema to allow `source: 'vendor-mcp'` capabilities. Add one entry per onboarded server.

**Capability routing and discovery contract:**

- Tool schemas are discovered from the MCP server at client initialisation (stdio: on spawn; HTTP: on first connection)
- Schemas are cached in memory for the duration of the run; not persisted to DB
- If the MCP connection drops and reconnects mid-run, the schema is re-fetched from the live server; the original snapshot is not reused. The schema at first successful invocation is what is recorded in the audit log for replay purposes.
- On schema fetch failure the server is marked unavailable and the orchestrator routes around it; no fallback to a stale schema
- Orchestrator capability lookup: static capability registry (`docs/capabilities.md`) used for routing decisions; runtime tool list used for invocation; discrepancies logged as `mcp_schema_drift`
- Startup validation: if a preset declares tools that the live server does not expose, the delta is logged and the capability entry marked `partial`
- Stale capability removal: capabilities are removed from the registry when their backing preset is disabled or deleted; no auto-removal on server timeout

**PolicyEnvelopeResolver integration:** MCP tool invocations inherit `PolicyEnvelopeResolver` outputs for the parent run. Policy snapshots are persisted per invocation alongside the tool-call audit log entry.

### Prereq 6 — Subprocess isolation (1-2 days)

Vendor MCP servers run as spawned child processes. The following runtime isolation requirements apply before any server goes to production:

- Filesystem access restricted to a per-run temporary directory via process-level working directory constraint (not container isolation); access to `/server`, `/client`, or app data directories is not granted. The implementation spec must explicitly decide whether process-level path restriction is an acceptable long-term boundary for semi-trusted third-party code, or whether MCP execution should eventually migrate into the existing sandbox/runtime pool.
- Network egress: process-level domain allowlist enforced (not only config-layer validation)
- Process cleanup: child process killed and all stdio streams closed on run termination, error, or timeout; no orphaned processes
- Memory/CPU ceilings: enforced via existing resource budget mechanism (`server/config/limits.ts:515-539`); MCP processes included in budget accounting
- Concurrent-session isolation: each run gets an independent child process; no shared subprocess state between concurrent runs
- Concurrency ceiling: maximum concurrent MCP subprocesses per node is configurable; safe initial default is 4 per node before load testing establishes a higher ceiling; per-org ceiling enforced to prevent a single org monopolising subprocess slots
- Sandbox relationship: aligns with the existing e2b runtime strategy; stdio MCP processes treated equivalently to sandboxed code execution

### Prereq 7 — Observability and telemetry (1 day)

Existing Synthetos architecture enforces auditability. MCP tool calls must meet the same standard.

**Required telemetry per MCP tool invocation:**

- Structured log entry: `runId`, `agentId`, `orgId`, `subaccountId`, `serverId`, `toolName`, `durationMs`, `statusCode`
- Credential-use audit trail: which credential resolved, which subaccount scope, timestamp — credential values never logged
- Vendor API failure classification: distinguish `timeout`, `auth_failure`, `rate_limit`, `upstream_error`, `schema_mismatch`
- MCP server health: startup success/failure logged; process exit codes and crash signals captured
- Correlation: all MCP log entries carry the parent `runId` for end-to-end trace reconstruction
- Latency and error metrics: emitted to existing telemetry pipeline; dashboards TBD post-onboarding

## 5. First five vendor servers

| # | Server | Effort after prereqs | Why first |
|---|---|---|---|
| 1 | **Brave Search** | 0.5 day | Validates HTTP transport; no per-tenant credentials (see note) |
| 2 | **GitHub** | 1 day | OAuth scope plumbing exists; high technical-account value |
| 3 | **Notion** | 1 day | Integration token (not OAuth); validates non-OAuth env mapping |
| 4 | **Stripe** | 2-3 days | Restricted-key per tenant; sets write-gated pattern |
| 5 | **Slack** | 3-5 days | Per-workspace bot OAuth; rate limits; workspace-scoped pattern |

**Brave Search shared credential note.** Brave Search uses a single system-level API key (no per-tenant credential). Governance implication: all tenant searches share a pool quota; tenant search inputs are not isolated at the vendor API level. This is an accepted trade-off for a search primitive (no write actions, no PII submitted). Operator privacy disclosure required in UI before activation. The vendor-procurement ADR must codify this as a named policy class (`shared-read-only-infrastructure`) as a hard requirement, defining the eligibility criteria (no write actions, no PII submitted, pool-quota acceptable) so future low-risk providers can be evaluated against it without a new governance decision each time.

Total: 8 to 11 engineering days after prereqs. End-to-end including prereqs: 4 to 5 weeks of one engineer. The original estimate of 3 weeks did not account for subprocess isolation, transport security hardening, governance integration, and observability instrumentation.

---

## 6. Governance integration

Vendor MCP tool invocations inherit Synthetos governance controls. The following mappings are required before any server with write actions is onboarded.

**Risk Tier classification by tool type:**

| Tool category | Risk Tier | Approval requirement |
|---|---|---|
| Read-only data fetch (search, list, get) | Low | Auto-approve |
| Write to third-party SaaS (post, create, update) | Medium | Operator approval gate |
| Financially consequential write (refund, charge, invoice) | High | Two-step approval with reason capture |
| Destructive action (delete, revoke, archive) | High | Two-step approval with reason capture |

**Action registry mapping:** Each onboarded tool must be registered in the action registry with its Risk Tier, required approval level, and whether the action is reversible. Tools not in the registry are blocked by the orchestrator.

**Risk Tier classification granularity:** Classification applies per registered tool entry, not per invocation parameter. For tools that bundle read and write operations under a single callable (common in Stripe and Slack SDKs), each logical action variant must be registered as a separate action registry entry with its own Risk Tier. If a vendor tool does not expose distinct variants, it inherits the highest Risk Tier of any operation it can perform.

**Per-tool allowlisting:** Onboarding a vendor server does not expose all its tools. The preset defines an explicit `allowedTools` list. Tools not in the list are not surfaced to the orchestrator. Default is deny-all; operator enables per tool via UI.

**Policy inheritance:** All MCP tool invocations inherit the PolicyEnvelopeResolver output for the parent run, including budget constraints, domain restrictions, and operator-defined action policies.

**Capability explosion control:** No server with >50 exposed tools may be onboarded without a per-tool review and allowlist. Operator UI shows enabled tools per server; dangerous-tool suppression patterns documented in KNOWLEDGE.md onboarding playbook.

**Native-integration overlap:** Where a native integration (Stripe Agent, Slack native, Gmail) and a vendor MCP server for the same provider coexist:
- Native integration is always preferred for routing; it has deeper tenant isolation and richer action registry coverage
- MCP server tools are only invoked when no native capability covers the requested action
- Duplicate capability resolution: native capability entry takes precedence in `docs/capabilities.md`; MCP entry marked `supplement`
- Operator UX: one connection surface per vendor; backend routes transparently
- Observability: when a native integration shadows an MCP tool, the routing decision is logged as `mcp_capability_shadowed` with the native capability ID and the bypassed MCP tool name; operators can filter these logs to audit routing decisions

---

## 7. Definition of done

**Happy path:**
- All seven prereqs shipped with tests
- Five vendor MCP servers in production, version-pinned
- Each has a capability entry in `docs/capabilities.md` with Risk Tier and `allowedTools` list
- Operator can connect each end-to-end via existing UI
- Credentials correctly scoped per tenant per collision-semantics contract (§4 Prereq 3)
- Vendor-procurement ADR merged
- KNOWLEDGE.md entry documents the onboarding playbook
- PolicyEnvelopeResolver integration verified per run

**Required negative-path tests (must pass before each server ships):**
- Invalid credentials: server returns auth error; run marked failed; no retry with bad credential
- Expired OAuth token: detected at connection time; operator notified; server marked unavailable
- Revoked integration: credential-cascade falls through correctly per §4 Prereq 3 contract
- MCP process crash: subprocess exit captured; run marked failed; no orphaned process
- HTTP timeout: request aborted at timeout ceiling; classified as `timeout` not `upstream_error`
- Partial tool-schema load: delta logged as `mcp_schema_drift`; available tools still routable
- Rate-limit exhaustion: classified as `rate_limit`; not retried immediately; logged
- Tenant-isolation regression: subaccount A cannot see or invoke tools configured for subaccount B

## 8. MCP server compatibility criteria

A vendor server is eligible for onboarding if it meets all of the following:

- Supports stdio transport (required) and/or StreamableHTTP transport (required for HTTP-only servers)
- Authentication via env-var injection (Bearer token, API key, OAuth token); no custom handshake protocols
- Actively maintained: last release within 6 months; open-source or vendor-supported
- Licensing: MIT, Apache 2.0, or equivalent permissive licence; no copyleft affecting Synthetos distribution
- No telemetry callbacks or analytics reporting from within the MCP server process; network egress limited to the declared vendor API
- All execution on Synthetos infrastructure; externally hosted MCP endpoints are not supported
- Runtime: Node.js (npm) preferred; Python (uvx) evaluated case-by-case; other runtimes require ADR
- Package source: npm registry only; no git URLs, no private registries, no file: paths
- Tool count: servers exposing >50 tools require a pre-onboarding allowlist review

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Vendor server has security flaw | Version pinning + procurement ADR + per-run budgets + command allowlist |
| Vendor expects incompatible auth shape | Env remapping covers most; document and skip otherwise |
| Vendor API breaks server | Pin version; treat as standard third-party dependency |
| Cross-tenant credential leak via misconfigured preset | Prereq 3 closes the structural gap; negative-path test required |
| Subprocess escapes filesystem isolation | Prereq 6 isolation enforcement; process-level allowlist, not config-only |
| HTTP transport enables SSRF | Host allowlisting enforced at connection layer; unlisted hosts rejected |
| Capability explosion degrades orchestrator clarity | Per-tool allowlisting; >50-tool servers blocked until reviewed |
| Native + MCP capability conflict causes incorrect routing | Overlap contract in §6; native always preferred; MCP marked `supplement` |
| Shared Brave Search credential exposes tenant query patterns | Accepted trade-off for read-only primitive; operator disclosure required |

---

## 10. Rollout strategy

- **Staged rollout:** Prereqs ship as a single internal release before any vendor server is enabled
- **Tenant allowlisting:** Each vendor server is gated behind an org-level feature flag before GA; beta orgs enrolled manually
- **Kill switch:** Per-server disable in admin UI without code deploy; credential revocation triggers immediate server deactivation
- **Vendor-specific quarantine:** If a server exhibits unexpected behaviour (unexpected egress, crash rate, auth failures), it can be quarantined (connections closed, capability marked unavailable) without affecting other servers
- **GA criteria:** Negative-path tests passing, observability dashboards live, governance mappings complete, at least one beta tenant validation per server

---

## 11. Operational ownership

| Responsibility | Owner |
|---|---|
| Vendor version maintenance and upgrade reviews | Platform team; reviewed quarterly or on CVE |
| Deprecation handling (vendor EOLs server) | Platform team; minimum 30-day notice to tenants |
| Broken server escalation | On-call engineer; P2 if write-action server; P3 if read-only |
| Procurement review cadence | Platform + security; annual or on new server onboarding |
| Security advisories | Platform team; CVE triggers immediate version freeze |
| Compatibility testing on Node/runtime upgrade | Platform team; part of standard upgrade checklist |

---

## 12. UI impact

The existing MCP server configuration UI (`client/src/pages/McpServersPage.tsx`) is reused without structural changes. The following small additions are required and must be captured in the implementation spec:

- **Per-tool allowlist visibility:** operator can see which tools are enabled per server and toggle them; default is deny-all
- **Shared-credential disclosure:** privacy notice shown before a shared-credential server (e.g. Brave Search) is activated
- **Server status indicators:** quarantine and disabled states surfaced in the server list (distinct from the existing error state)
- **Routing/audit visibility:** where a native integration has shadowed an MCP tool, the audit log entry is accessible to the operator; no new UI page required, filtered view of existing audit log is sufficient

No mockups required. These are spec requirements and wire notes for the spec author.

---

## 14. Out of scope

- Replacing native integrations (Gmail, HubSpot, Slack, GHL, Stripe Agent) with vendor MCP. Native integrations are deeper and tenant-isolation-stronger. Where both exist, native is preferred (see §6 overlap contract).
- Smithery, mcp.so, or other third-party MCP hosting. All servers run on our infrastructure.
- Composio integration platform. Only worth evaluating when a provider has no MCP server AND no native integration. None such today.
- Externally hosted MCP endpoints (HTTP servers not under our control).

---

## 15. Operator-facing summary

Once shipped, agencies can connect their clients' GitHub, Notion, Stripe, Slack, and web research tools directly to Synthetos agents. Every connection is encrypted at rest, scoped to the agency and to the specific client subaccount, gated by approval workflows. A single "Connect Stripe" tap unlocks billing reconciliation, refund handling, dispute responses, and invoice generation, not just one operation.
