# MCP Vendor Server Onboarding — Implementation Brief

> **Status:** Draft for engineer review
> **Date:** 2026-05-18
> **Origin:** Open-source ecosystem research (May 2026) + deep-dive into `server/services/mcpClientManager.ts`, `server/config/mcpPresets.ts`, `server/services/integrationConnectionService.ts`.
> **Why now:** Our MCP infrastructure is production-grade but the 28-server preset catalogue points at placeholder package names (`@anthropic/*-mcp-server@1.0.0`) that do not exist on npm. Real vendor MCP servers shipped in 2025-2026 (GitHub, Notion, Stripe, Slack, Brave Search). Each unlocks dozens of agent skills with no per-skill engineering.
> **Business value:** Each onboarded vendor server adds a whole category of agency-deliverable work. Roughly one to two days per server after cross-cutting prerequisite work lands.

## 1. Business framing

Synthetos is differentiated by tenant isolation, approval governance, agent identity, and operator correction. The *skills* are commoditising: every major SaaS vendor is publishing an MCP server in 2025-2026. Adopting five this month leapfrogs every agency-side competitor still hand-rolling integrations.

We already built the hard part: client manager with lifecycle, resource budgets, tool routing (`server/services/mcpClientManager.ts`); per-org and per-subaccount credential scoping with AES-256-GCM encryption (`server/services/connectionTokenService.ts`); preset catalogue, CRUD routes, tenant UI (`server/config/mcpPresets.ts`, `server/routes/mcpServers.ts`, `client/src/pages/McpServersPage.tsx`); per-run safety budgets (`server/config/limits.ts:515-539`).

Missing: five pieces of plumbing and the swap from placeholder packages to real ones.

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

## 3. Cross-cutting prerequisites

Five items unlock every subsequent server. Total: 5 to 8 engineering days.

### Prereq 1 — HTTP transport (1-2 days)
Add `StreamableHTTPClientTransport` import and transport-selector based on the `transport` field already present in `server/db/schema/mcpServerConfigs.ts:31`. Test end-to-end with Brave Search (HTTP).

### Prereq 2 — Env-var name remapping (1 day)
Today the child gets `ACCESS_TOKEN` (`server/services/mcpClientManager.ts:610-611`). Vendor servers expect `GITHUB_TOKEN`, `STRIPE_SECRET_KEY`, `SLACK_BOT_TOKEN`. Add `envVarMapping` to preset shape; apply before spawn.

### Prereq 3 — Subaccount filtering (0.5 day)
`listForAgent(agentId, organisationId)` does not filter MCP visibility by `subaccountId` (`server/services/mcpServerConfigService.ts:182-208`). Real tenant-leak risk for agencies serving multiple clients. Add the filter; respect subaccount-first cascade with org fallback.

### Prereq 4 — Version pinning + supply-chain guard (1 day)
Preset args use `npx -y @vendor/server@latest` which auto-updates on every run (the same surface the Smithery incident exploited). Pin every server to a specific version. Add CI check that flags `@latest`. Author `docs/decisions/<next>-mcp-vendor-procurement.md`.

### Prereq 5 — Capability registration extension (1 day)
Extend `docs/capabilities.md` schema to allow `source: 'vendor-mcp'` capabilities. Add one entry per onboarded server. Wire into capability-aware orchestrator routing.

## 4. First five vendor servers

| # | Server | Effort after prereqs | Why first |
|---|---|---|---|
| 1 | **Brave Search** | 0.5 day | No per-tenant credentials; validates HTTP transport |
| 2 | **GitHub** | 1 day | OAuth scope plumbing exists; high technical-account value |
| 3 | **Notion** | 1 day | Integration token (not OAuth); validates non-OAuth env mapping |
| 4 | **Stripe** | 2-3 days | Restricted-key per tenant; sets write-gated pattern |
| 5 | **Slack** | 3-5 days | Per-workspace bot OAuth; rate limits; workspace-scoped pattern |

Total: 8 to 11 engineering days after prereqs. End-to-end including prereqs: about 3 weeks of one engineer.

## 5. Definition of done

- All five prereqs shipped with tests
- Five vendor MCP servers in production, version-pinned
- Each has a capability entry in `docs/capabilities.md`
- Operator can connect each end-to-end via existing UI
- Credentials correctly scoped per tenant
- Vendor-procurement ADR merged
- KNOWLEDGE.md entry documents the onboarding playbook

## 6. Risks

| Risk | Mitigation |
|---|---|
| Vendor server has security flaw | Version pinning + procurement ADR + per-run budgets + command allowlist |
| Vendor expects incompatible auth shape | Env remapping covers most; document and skip otherwise |
| Vendor API breaks server | Pin version; treat as standard third-party dependency |
| Cross-tenant credential leak via misconfigured preset | Prereq 3 closes the structural gap |

## 7. Out of scope

- Replacing native integrations (Gmail, HubSpot, Slack, GHL, Stripe Agent) with vendor MCP. Native integrations are deeper and tenant-isolation-stronger.
- Smithery, mcp.so, or other third-party MCP hosting. All servers run on our infrastructure.
- Composio integration platform. Only worth evaluating when a provider has no MCP server AND no native integration. None such today.

## 8. Operator-facing summary

Once shipped, agencies can connect their clients' GitHub, Notion, Stripe, Slack, and web research tools directly to Synthetos agents. Every connection is encrypted at rest, scoped to the agency and to the specific client subaccount, gated by approval workflows. A single "Connect Stripe" tap unlocks billing reconciliation, refund handling, dispute responses, and invoice generation, not just one operation.
