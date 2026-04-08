# Build: Unified Integrations Page

## Summary

Merge "Integrations" (MCP Servers) and "Connectors" into a single "Integrations" page. Remove the separate "Connectors" sidebar item. The unified page should work at both the Organisation level and the Subaccount level.

## Problem

Currently there are two separate pages for connecting to external systems:
- **Integrations** (`/admin/mcp-servers`) — MCP tool servers (Gmail, Slack, HubSpot, etc.)
- **Connectors** (`/admin/connectors`) — native platform adapters (GHL, Stripe, Teamwork, Slack)

This is confusing because:
1. Both connect to external systems — the distinction is an implementation detail, not a user concern
2. Both need credentials/OAuth — but credentials are managed in different places
3. Connectors are bidirectional (not just data pull — e.g. GHL adapter has createContact, pause_campaign)
4. The same platform (e.g. Slack) can appear in both sections
5. Users don't care whether something uses MCP protocol or a native adapter — they want "connect to Gmail"

## Proposed Structure

### Single "Integrations" page with tabs/views:

**Tab 1: Active Integrations**
- All configured integrations in one list (both MCP servers and connectors)
- Each shows: name, type badge (MCP Server / Native Connector), status (connected/disconnected), tool count, sync status (for connectors), last activity
- Actions: configure, sync now, disable, delete
- Unified credential/connection status

**Tab 2: Catalogue**
- Already exists for MCP servers — extend to also show available native connectors (GHL, Stripe, Teamwork, Slack)
- Each catalogue item shows capabilities: tools provided AND data sync capabilities
- Single "Add to Org" / "Add to Subaccount" flow regardless of type
- Native connectors should show their bidirectional capabilities (e.g. "Pulls contacts, opportunities, metrics. Supports: create contact, pause campaign")

### Credential/OAuth Management
- Shared connection management — if GHL OAuth is set up, it works for both the MCP tools and the native connector data sync
- Connection status shown per integration
- OAuth flow triggered from the integration detail, not a separate page

## Scope

### Both levels must be supported:
- **Organisation level** (`/admin/mcp-servers` currently, `/admin/connectors` currently) — org-wide integrations
- **Subaccount level** (`/admin/subaccounts/:id/connections` currently) — per-company integrations

The subaccount level already has a connections page. This needs to be aligned with the unified approach too.

## Current Files

| File | Purpose | Action |
|------|---------|--------|
| `client/src/pages/McpServersPage.tsx` | MCP Servers page (org level) | Extend to become unified Integrations page |
| `client/src/pages/ConnectorConfigsPage.tsx` | Connectors page (org level) | Merge into McpServersPage, then remove |
| `client/src/pages/ConnectionsPage.tsx` | Connections page (subaccount level) | Align with unified approach |
| `client/src/components/Layout.tsx` | Sidebar nav | Remove "Connectors" item, keep "Integrations" |
| `server/routes/mcpServers.ts` | MCP server API routes | Keep |
| `server/routes/connectorConfigs.ts` | Connector API routes | Keep (backend stays separate, frontend unifies) |
| `server/adapters/index.ts` | Native adapter registry (ghl, stripe, teamwork, slack) | Keep |

## API Notes

The backend can stay as separate routes (`/api/mcp-servers` and `/api/org/connectors`) — the unification is a frontend concern. The Integrations page would fetch from both APIs and present them together.

## Available Native Connectors
- GoHighLevel (`ghl`) — contacts, opportunities, metrics, campaigns; bidirectional
- Stripe (`stripe`) — payments, subscriptions, invoices
- Teamwork (`teamwork`) — projects, tasks, time tracking
- Slack (`slack`) — messages, channels; bidirectional

## Available MCP Catalogue Servers (7 currently)
- Gmail, Slack, HubSpot, and others from the catalogue
- These are defined as MCP server specs, not yet all operational

## Design Considerations

- The catalogue currently says "40 integrations" but only 7 are available — need to reconcile this or show "coming soon" badges
- Native connectors and MCP servers have different configuration flows (poll interval vs environment variables vs OAuth) — the unified UI needs to handle both gracefully
- Consider a single "Integration Detail" page that shows: connection status, tools provided, data sync config, credentials, activity log
- The integration type (MCP vs Native) can be shown as a badge but shouldn't drive the UX flow

## Out of Scope
- Building new MCP servers or native adapters
- OAuth flow implementation (exists partially for some adapters)
- Real-time webhook ingestion (currently polling only for connectors)
