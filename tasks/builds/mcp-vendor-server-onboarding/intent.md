## Problem Statement

Synthetos' MCP infrastructure is production-grade — client manager, lifecycle, resource budgets, tenant-scoped credentials, preset catalogue, tenant UI, per-run safety budgets. But the 28-server preset catalogue points at placeholder package names (`@anthropic/*-mcp-server@1.0.0`) that do not exist on npm. Real vendor MCP servers shipped in 2025-2026 (GitHub, Notion, Stripe, Slack, Brave Search). Each unlocks a category of agency-deliverable work without per-skill engineering. The gap: seven cross-cutting prerequisites and the swap from placeholders to real packages. Without onboarding, our agency competitors get to those skills first while we hand-roll integrations.

## Desired Outcome

Five vendor MCP servers (Brave Search, GitHub, Notion, Stripe, Slack) running on Synthetos infrastructure with seven cross-cutting prerequisites shipped first: HTTP transport with SSRF prevention and TLS, env-var name remapping, subaccount credential scoping with explicit cascade semantics, version pinning with supply-chain guard, capability routing contract, subprocess isolation (filesystem + network egress + concurrency ceilings), and observability instrumentation. Each vendor server: per-tenant credential-scoped, governance-gated through PolicyEnvelopeResolver, version-pinned, audited per invocation, surfaced in the existing MCP servers UI with per-tool allowlist visibility and operator kill-switch. Native integrations always preferred over MCP for the same vendor.

## Non-Goals

- Replacing native integrations (Gmail, HubSpot, Slack native, GHL, Stripe Agent). Where both exist, native always wins.
- Smithery, mcp.so, or any third-party MCP hosting. All servers run on our infrastructure.
- Composio integration platform. Only worth evaluating when a provider has neither MCP nor native.
- Externally hosted MCP endpoints (HTTP servers not under our control).
- Restructural changes to the MCP servers UI. Brief author confirmed wire notes only; no new pages or redesign.

## Affected Capability Area

Integrations, Agent Runtime, Audit & Governance, Approvals

## User / Operator Impact

Agency operators gain five new connector options in the existing MCP servers page: GitHub, Notion, Stripe, Slack, Brave Search. Each one unlocks a category of work (billing reconciliation, dev-tasks, knowledge-base, channel-ops, web research). UI adds per-tool allowlist toggles (default deny-all), a shared-credential privacy notice for Brave Search activation, server status indicators (quarantine / disabled distinct from error), and a filtered audit-log view for shadowed-by-native routing decisions. Write actions stay behind approval gates; destructive and financially consequential actions require two-step approval with reason capture.

## Risk Surface

server/db/schema, server/routes, auth/permission services, middleware, RLS migrations, agent runtime, approvals, external messaging

## Assumptions

- The MCP TypeScript SDK already supports `StreamableHTTPClientTransport`; only client wiring and security posture are missing.
- npm registry vendor MCP packages exist for the five target vendors (GitHub, Notion, Stripe, Slack, Brave Search) and ship under MIT/Apache 2.0 or equivalent permissive licences.
- `PolicyEnvelopeResolver` and the existing approval gate infrastructure are sufficient surfaces for MCP write-tool gating without further architectural changes.
- Process-level filesystem and network-egress isolation is an acceptable trust boundary for V1 semi-trusted subprocesses; eventual migration into the existing e2b sandbox runtime stays open as a Phase 2 option, decided per the spec body, not pre-committed here.
- Existing credential broker (AES-256-GCM, fresh-per-run resolution) supports the new subaccount-cascade semantics without schema change beyond the visibility-filter fix in Prereq 3.
- The MCP servers page can carry four small UI additions without restructure; design source-of-truth is wire notes in §12 of the brief, not new mockups.

## Open Questions

- Long-term home for MCP execution: keep process-level isolation indefinitely, or stage a Phase 2 migration into the e2b sandbox pool once the SDK harness lands? (Brief §4 Prereq 6 flags as a spec-author decision.)
- Concurrency ceiling defaults: brief proposes 4 concurrent MCP subprocesses per node before load testing — is that the right initial cap for our deployment shape?
- `shared-read-only-infrastructure` policy class (Brave Search): codifying the eligibility criteria in the procurement ADR is required, but the ADR also needs an approval workflow for future low-risk providers — who signs off, what cadence?
- Native-MCP shadow audit visibility: brief §6 logs `mcp_capability_shadowed` events; should they surface in the operator UI as a filtered audit-log view (brief §12 implies yes) or only in admin telemetry?
- Per-tool risk-tier auto-classification: brief §6 says tools that bundle read+write under one callable register as separate entries inheriting the highest tier when no variant exists. Spec must decide if this is a manual onboarding step per server or an automated extraction pass.
- HTTP transport vs stdio rollout ordering: brief implies HTTP ships with Prereq 1 (Brave Search validation). Stdio remains primary for GitHub/Notion/Stripe/Slack. Spec must pin which transport each onboarded server uses and the test matrix.

## Duplication / Strategy Check

| Output | Value |
|---|---|
| Duplication assessment | clear |
| Strategic fit | clear |
| Recommendation | proceed |
