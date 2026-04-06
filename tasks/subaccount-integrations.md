# Build: Subaccount-Level Integrations

## Summary

Give each subaccount (company) its own independent Integrations page — identical to the org-level Integrations page — where they can browse the catalogue, add MCP tool servers, add data connectors, and manage their own credentials. Fully independent from org-level integrations.

## Current State

- **Org level:** Unified Integrations page at `/admin/mcp-servers` with catalogue, MCP servers, and native connectors
- **Subaccount level:** Only a "Connections" tab on the subaccount detail page that manages OAuth credentials — no catalogue, no independent MCP server or connector configuration
- Subaccounts inherit org-level MCP servers and connectors but cannot add their own

## What Needs to Change

### 1. Subaccount-Scoped MCP Server Configs

The `mcp_server_configs` table currently has `organisation_id` but no `subaccount_id`. Need to:
- Add `subaccount_id` (nullable) to `mcp_server_configs` — when set, the server is scoped to that subaccount only
- Update the MCP server service to support subaccount-scoped CRUD
- Add API routes: `GET/POST/PATCH/DELETE /api/subaccounts/:subaccountId/mcp-servers`
- Add `/api/subaccounts/:subaccountId/mcp-presets` (same catalogue, but `isAdded` checks subaccount scope)

### 2. Subaccount-Scoped Connector Configs

The `connector_configs` table currently has `organisation_id` but no `subaccount_id`. Need to:
- Add `subaccount_id` (nullable) to `connector_configs` — when set, scoped to that subaccount
- Update connector config service for subaccount-scoped CRUD
- Add API routes: `GET/POST/DELETE /api/subaccounts/:subaccountId/connectors`

### 3. Subaccount Integrations Page

Replace the current "Connections" tab on the subaccount detail page with a full Integrations page that:
- Uses the same `McpCatalogue` component (parameterised for subaccount context)
- Shows subaccount-scoped active integrations (MCP servers + connectors)
- Has its own OAuth connection management integrated into the add flow
- Is independent from org-level integrations

### 4. Connection Resolution Update

When an agent runs in a subaccount context, the connection resolution should check:
1. Subaccount-scoped MCP servers and connectors first
2. Org-level MCP servers and connectors as fallback (if no subaccount-scoped config exists)

This preserves backwards compatibility — org-level integrations still work as shared defaults.

### 5. Navigation

- Replace "Connections" tab label with "Integrations" on the subaccount detail page
- Or: add a dedicated sidebar item when inside a subaccount context

## Migration

- `ALTER TABLE mcp_server_configs ADD COLUMN subaccount_id UUID REFERENCES subaccounts(id)`
- `ALTER TABLE connector_configs ADD COLUMN subaccount_id UUID REFERENCES subaccounts(id)`
- Add indexes for subaccount scoping queries

## Key Files

| File | Change |
|------|--------|
| `server/db/schema/mcpServerConfigs.ts` | Add `subaccountId` column |
| `server/db/schema/connectorConfigs.ts` | Add `subaccountId` column |
| `server/routes/mcpServers.ts` | Add subaccount-scoped routes |
| `server/routes/connectorConfigs.ts` | Add subaccount-scoped routes |
| `server/services/mcpServerConfigService.ts` | Support subaccount scope |
| `server/services/connectorConfigService.ts` | Support subaccount scope |
| `client/src/components/McpCatalogue.tsx` | Parameterise for subaccount context |
| `client/src/pages/McpServersPage.tsx` | Parameterise for subaccount context |
| `client/src/pages/AdminSubaccountDetailPage.tsx` | Replace Connections tab with Integrations |

## Design Principle

Each subaccount is a standalone company with its own:
- Integrations (MCP tool servers + data connectors)
- Credentials (OAuth connections)
- Data (canonical accounts, metrics, etc.)
- Agents (via subaccount_agents)

Org-level integrations serve as shared defaults that any subaccount can use, but subaccounts can override or add their own independently.
