# Subaccount-Level Integrations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each subaccount its own independent Integrations page where it can browse the catalogue, add MCP tool servers and data connectors, and manage credentials — fully independent from org-level integrations.

**Architecture:** Add nullable `subaccountId` to `mcp_server_configs` and `connector_configs` tables. Duplicate the existing org-level service methods and routes for subaccount scope. Reuse the `McpCatalogue` and `McpServersPage` components by parameterising them with an optional `subaccountId` prop. Replace the "Connections" tab on the subaccount detail page with a full "Integrations" tab.

**Tech Stack:** Drizzle ORM (PostgreSQL), Express routes, React (TypeScript), existing `McpCatalogue` component

---

### Task 1: Database Migration — Add subaccountId to mcp_server_configs and connector_configs

**Files:**
- Create: `migrations/0070_subaccount_integrations.sql`
- Modify: `server/db/schema/mcpServerConfigs.ts`
- Modify: `server/db/schema/connectorConfigs.ts`

- [ ] **Step 1: Create migration file**

```sql
-- 0070_subaccount_integrations.sql
-- Add subaccount scoping to MCP server configs and connector configs

ALTER TABLE mcp_server_configs
  ADD COLUMN subaccount_id UUID REFERENCES subaccounts(id);

CREATE INDEX mcp_server_configs_subaccount_idx
  ON mcp_server_configs(subaccount_id)
  WHERE subaccount_id IS NOT NULL;

-- Drop the existing org+slug unique index and replace with one that includes subaccount
DROP INDEX IF EXISTS mcp_server_configs_org_slug_idx;
CREATE UNIQUE INDEX mcp_server_configs_org_slug_idx
  ON mcp_server_configs(organisation_id, slug)
  WHERE subaccount_id IS NULL;
CREATE UNIQUE INDEX mcp_server_configs_sub_slug_idx
  ON mcp_server_configs(organisation_id, subaccount_id, slug)
  WHERE subaccount_id IS NOT NULL;

ALTER TABLE connector_configs
  ADD COLUMN subaccount_id UUID REFERENCES subaccounts(id);

CREATE INDEX connector_configs_subaccount_idx
  ON connector_configs(subaccount_id)
  WHERE subaccount_id IS NOT NULL;

-- Drop the existing org+type unique index and replace with one that includes subaccount
DROP INDEX IF EXISTS connector_configs_org_type_idx;
CREATE UNIQUE INDEX connector_configs_org_type_idx
  ON connector_configs(organisation_id, connector_type)
  WHERE subaccount_id IS NULL;
CREATE UNIQUE INDEX connector_configs_sub_type_idx
  ON connector_configs(organisation_id, subaccount_id, connector_type)
  WHERE subaccount_id IS NOT NULL;
```

- [ ] **Step 2: Run migration**

Run: `npm run migrate`
Expected: migrations applied successfully

- [ ] **Step 3: Update mcpServerConfigs Drizzle schema**

In `server/db/schema/mcpServerConfigs.ts`, add after the `organisationId` column:

```typescript
subaccountId: uuid('subaccount_id').references(() => subaccounts.id),
```

Add the import for `subaccounts` at the top. Add a new index to the table indexes:

```typescript
subaccountIdx: index('mcp_server_configs_subaccount_idx').on(table.subaccountId),
```

- [ ] **Step 4: Update connectorConfigs Drizzle schema**

In `server/db/schema/connectorConfigs.ts`, add after the `organisationId` column:

```typescript
subaccountId: uuid('subaccount_id').references(() => subaccounts.id),
```

Add the import for `subaccounts` at the top. Add a new index:

```typescript
subaccountIdx: index('connector_configs_subaccount_idx').on(table.subaccountId),
```

- [ ] **Step 5: Commit**

```bash
git add migrations/0070_subaccount_integrations.sql server/db/schema/mcpServerConfigs.ts server/db/schema/connectorConfigs.ts
git commit -m "feat: add subaccountId to mcp_server_configs and connector_configs"
```

---

### Task 2: Backend Services — Subaccount-scoped MCP server methods

**Files:**
- Modify: `server/services/mcpServerConfigService.ts`

- [ ] **Step 1: Add subaccount list method**

Add method `listBySubaccount(organisationId: string, subaccountId: string)` that queries `mcp_server_configs` where `organisationId` matches AND `subaccountId` matches. Order by `createdAt` descending. Pattern follows existing `list()` method but adds the subaccount filter.

```typescript
async listBySubaccount(organisationId: string, subaccountId: string) {
  return db
    .select()
    .from(mcpServerConfigs)
    .where(and(
      eq(mcpServerConfigs.organisationId, organisationId),
      eq(mcpServerConfigs.subaccountId, subaccountId),
    ))
    .orderBy(desc(mcpServerConfigs.createdAt));
},
```

- [ ] **Step 2: Add subaccount create method**

Add method `createForSubaccount(organisationId: string, subaccountId: string, input: CreateInput)` — identical to `create()` but sets `subaccountId` on the inserted row. Slug uniqueness check should scope to the subaccount.

- [ ] **Step 3: Update getById to accept optional subaccountId**

Modify `getById(id, organisationId, subaccountId?)` — if subaccountId provided, add it to the where clause. This allows the existing org-level routes to keep working.

- [ ] **Step 4: Commit**

```bash
git add server/services/mcpServerConfigService.ts
git commit -m "feat: add subaccount-scoped methods to mcpServerConfigService"
```

---

### Task 3: Backend Services — Subaccount-scoped connector methods

**Files:**
- Modify: `server/services/connectorConfigService.ts`

- [ ] **Step 1: Add subaccount list method**

```typescript
async listBySubaccount(organisationId: string, subaccountId: string) {
  return db
    .select()
    .from(connectorConfigs)
    .where(and(
      eq(connectorConfigs.organisationId, organisationId),
      eq(connectorConfigs.subaccountId, subaccountId),
    ))
    .orderBy(desc(connectorConfigs.createdAt));
},
```

- [ ] **Step 2: Add subaccount create method**

`createForSubaccount(organisationId, subaccountId, data)` — identical to `create()` but sets `subaccountId`.

- [ ] **Step 3: Commit**

```bash
git add server/services/connectorConfigService.ts
git commit -m "feat: add subaccount-scoped methods to connectorConfigService"
```

---

### Task 4: Backend Routes — Subaccount MCP server endpoints

**Files:**
- Modify: `server/routes/mcpServers.ts`

- [ ] **Step 1: Add subaccount-scoped routes**

Add these routes alongside the existing org-level ones. They follow the same pattern but use `req.params.subaccountId` and call the subaccount-scoped service methods. All routes should use `authenticate` and `requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW)` or `AGENTS_EDIT` as appropriate, plus `resolveSubaccount(req.params.subaccountId, req.orgId!)`.

```typescript
// ── Subaccount-scoped MCP servers ────────────────────────────────────────

router.get('/api/subaccounts/:subaccountId/mcp-servers', authenticate, asyncHandler(async (req, res) => {
  await resolveSubaccount(req.params.subaccountId, req.orgId!);
  const configs = await mcpServerConfigService.listBySubaccount(req.orgId!, req.params.subaccountId);
  res.json(configs);
}));

router.post('/api/subaccounts/:subaccountId/mcp-servers', authenticate, asyncHandler(async (req, res) => {
  await resolveSubaccount(req.params.subaccountId, req.orgId!);
  const config = await mcpServerConfigService.createForSubaccount(req.orgId!, req.params.subaccountId, req.body);
  res.status(201).json(config);
}));

router.delete('/api/subaccounts/:subaccountId/mcp-servers/:id', authenticate, asyncHandler(async (req, res) => {
  await resolveSubaccount(req.params.subaccountId, req.orgId!);
  await mcpServerConfigService.delete(req.params.id, req.orgId!);
  res.json({ ok: true });
}));

// Subaccount presets — same catalogue, different isAdded check
router.get('/api/subaccounts/:subaccountId/mcp-presets', authenticate, asyncHandler(async (req, res) => {
  await resolveSubaccount(req.params.subaccountId, req.orgId!);
  const existing = await mcpServerConfigService.listBySubaccount(req.orgId!, req.params.subaccountId);
  const existingSlugs = new Set(existing.map(c => c.presetSlug).filter(Boolean));
  // Also check connectors for this subaccount
  const existingConnectors = await connectorConfigService.listBySubaccount(req.orgId!, req.params.subaccountId);
  const existingConnectorSlugs = new Set(existingConnectors.map(c => `connector-${c.connectorType}`));
  const allSlugs = new Set([...existingSlugs, ...existingConnectorSlugs]);
  const result = MCP_PRESETS.map(p => ({ ...p, isAdded: allSlugs.has(p.slug) }));
  res.json({ presets: result, categories: MCP_PRESET_CATEGORY_LABELS });
}));
```

Import `resolveSubaccount` from `../lib/subaccountResolver.js`, `MCP_PRESETS` and `MCP_PRESET_CATEGORY_LABELS` from `../config/mcpPresets.js`, and `connectorConfigService`.

- [ ] **Step 2: Commit**

```bash
git add server/routes/mcpServers.ts
git commit -m "feat: add subaccount-scoped MCP server routes"
```

---

### Task 5: Backend Routes — Subaccount connector endpoints

**Files:**
- Modify: `server/routes/connectorConfigs.ts`

- [ ] **Step 1: Add subaccount-scoped routes**

```typescript
// ── Subaccount-scoped connectors ─────────────────────────────────────────

router.get('/api/subaccounts/:subaccountId/connectors', authenticate, asyncHandler(async (req, res, _next: NextFunction) => {
  await resolveSubaccount(req.params.subaccountId, req.orgId!);
  const configs = await connectorConfigService.listBySubaccount(req.orgId!, req.params.subaccountId);
  res.json(configs);
}));

router.post('/api/subaccounts/:subaccountId/connectors', authenticate, asyncHandler(async (req, res, _next: NextFunction) => {
  await resolveSubaccount(req.params.subaccountId, req.orgId!);
  const { connectorType, pollIntervalMinutes } = req.body;
  if (!connectorType) return res.status(400).json({ message: 'connectorType is required' });
  const config = await connectorConfigService.createForSubaccount(req.orgId!, req.params.subaccountId, { connectorType, pollIntervalMinutes });
  res.status(201).json(config);
}));

router.delete('/api/subaccounts/:subaccountId/connectors/:id', authenticate, asyncHandler(async (req, res, _next: NextFunction) => {
  await resolveSubaccount(req.params.subaccountId, req.orgId!);
  await connectorConfigService.delete(req.params.id, req.orgId!);
  res.json({ ok: true });
}));

router.post('/api/subaccounts/:subaccountId/connectors/:id/sync', authenticate, asyncHandler(async (req, res, _next: NextFunction) => {
  await resolveSubaccount(req.params.subaccountId, req.orgId!);
  const config = await connectorConfigService.get(req.params.id, req.orgId!);
  // Trigger sync (same as org-level)
  await connectorPollingService.triggerSync(config);
  res.json({ ok: true });
}));
```

Import `resolveSubaccount`.

- [ ] **Step 2: Commit**

```bash
git add server/routes/connectorConfigs.ts
git commit -m "feat: add subaccount-scoped connector routes"
```

---

### Task 6: Frontend — Parameterise McpCatalogue for subaccount context

**Files:**
- Modify: `client/src/components/McpCatalogue.tsx`

- [ ] **Step 1: Add subaccountId prop**

Update the component signature:

```typescript
export default function McpCatalogue({ onAdded, subaccountId }: { onAdded: () => void; subaccountId?: string }) {
```

- [ ] **Step 2: Update API calls to use subaccount endpoints when subaccountId is provided**

Change the presets fetch:
```typescript
const presetsUrl = subaccountId
  ? `/api/subaccounts/${subaccountId}/mcp-presets`
  : '/api/mcp-presets';
api.get(presetsUrl).then(({ data }) => { ... });
```

Change the MCP server create:
```typescript
const mcpUrl = subaccountId
  ? `/api/subaccounts/${subaccountId}/mcp-servers`
  : '/api/mcp-servers';
await api.post(mcpUrl, { presetSlug: addPreset.slug, ... });
```

Change the connector create:
```typescript
const connectorUrl = subaccountId
  ? `/api/subaccounts/${subaccountId}/connectors`
  : '/api/org/connectors';
await api.post(connectorUrl, { connectorType: addPreset.connectorType, ... });
```

Change the OAuth connection check:
```typescript
const connectionsUrl = subaccountId
  ? `/api/subaccounts/${subaccountId}/connections`
  : '/api/org/connections';
```

Change the OAuth auth-url request to include subaccountId:
```typescript
const oauthParams: Record<string, string> = { provider: addPreset.credentialProvider!, scope: subaccountId ? 'subaccount' : 'org' };
if (subaccountId) oauthParams.subaccountId = subaccountId;
const { data } = await api.get('/api/integrations/oauth2/auth-url', { params: oauthParams });
```

Update the "Add to Org" button text:
```typescript
{subaccountId ? '+ Add to Company' : '+ Add to Org'}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/McpCatalogue.tsx
git commit -m "feat: parameterise McpCatalogue for subaccount context"
```

---

### Task 7: Frontend — Parameterise McpServersPage for subaccount context

**Files:**
- Modify: `client/src/pages/McpServersPage.tsx`

- [ ] **Step 1: Add subaccountId and embedded props**

```typescript
export default function McpServersPage({ user: _user, subaccountId, embedded = false }: { user: User; subaccountId?: string; embedded?: boolean }) {
```

- [ ] **Step 2: Update API calls to use subaccount endpoints**

In the `load` callback:
```typescript
const mcpUrl = subaccountId ? `/api/subaccounts/${subaccountId}/mcp-servers` : '/api/mcp-servers';
const connectorUrl = subaccountId ? `/api/subaccounts/${subaccountId}/connectors` : '/api/org/connectors';
const [mcpRes, connectorRes] = await Promise.all([
  api.get(mcpUrl),
  connectorUrl ? api.get(connectorUrl).catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
]);
```

In the `handleDelete`:
```typescript
if (deleteType === 'connector') {
  const url = subaccountId ? `/api/subaccounts/${subaccountId}/connectors/${id}` : `/api/org/connectors/${id}`;
  await api.delete(url);
} else {
  const url = subaccountId ? `/api/subaccounts/${subaccountId}/mcp-servers/${id}` : `/api/mcp-servers/${id}`;
  await api.delete(url);
}
```

Connector sync button URL:
```typescript
const syncUrl = subaccountId ? `/api/subaccounts/${subaccountId}/connectors/${connector.id}/sync` : `/api/org/connectors/${connector.id}/sync`;
```

MCP test/edit URLs remain org-level (test infrastructure is shared).

- [ ] **Step 3: Pass subaccountId to McpCatalogue**

```typescript
<McpCatalogue onAdded={handleAdded} subaccountId={subaccountId} />
```

- [ ] **Step 4: Hide page heading when embedded**

```typescript
{!embedded && (
  <div className="flex justify-between items-start mb-6">
    <div>
      <h1 className="text-[28px] font-bold text-slate-800 m-0">Integrations</h1>
      ...
    </div>
  </div>
)}
```

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/McpServersPage.tsx
git commit -m "feat: parameterise McpServersPage for subaccount context"
```

---

### Task 8: Frontend — Replace Connections tab with Integrations on subaccount detail page

**Files:**
- Modify: `client/src/pages/AdminSubaccountDetailPage.tsx`

- [ ] **Step 1: Add McpServersPage lazy import**

At the top with other lazy imports:
```typescript
const McpServersPage = lazy(() => import('./McpServersPage'));
```

- [ ] **Step 2: Rename the tab**

Change the `ActiveTab` type and `TAB_LABELS`:
```typescript
// Change 'connections' to 'integrations' in ActiveTab
type ActiveTab = 'integrations' | 'engines' | 'workflows' | 'agents' | 'categories' | 'board' | 'memory' | 'usage' | 'admin';

// Update TAB_LABELS
const TAB_LABELS: Record<ActiveTab, string> = {
  integrations: 'Integrations',
  engines: 'Engines',
  // ... rest unchanged
};
```

- [ ] **Step 3: Replace the Connections tab rendering**

Find the block that renders `ConnectionsPage` when `activeTab === 'connections'` and replace:

```typescript
{activeTab === 'integrations' && (
  <Suspense fallback={<div className="py-8 text-sm text-slate-500">Loading integrations...</div>}>
    <McpServersPage user={_user as any} subaccountId={subaccountId} embedded />
  </Suspense>
)}
```

- [ ] **Step 4: Update default tab if needed**

If the component initialises with `connections` as default, change to `integrations`.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/AdminSubaccountDetailPage.tsx
git commit -m "feat: replace Connections tab with full Integrations on subaccount detail"
```

---

### Task 9: Update org-level presets endpoint to include connectors in isAdded check

**Files:**
- Modify: `server/routes/mcpServers.ts`

- [ ] **Step 1: Update the existing /api/mcp-presets handler**

The current handler only checks MCP server slugs for `isAdded`. Update it to also check connector slugs so native connector presets show "Already added" correctly.

Find the existing handler and update it to also fetch connectors:

```typescript
// In the GET /api/mcp-presets handler:
const [existing, existingConnectors] = await Promise.all([
  mcpServerConfigService.list(req.orgId!),
  connectorConfigService.listByOrg(req.orgId!),
]);
const existingSlugs = new Set(existing.map(c => c.presetSlug).filter(Boolean));
const existingConnectorSlugs = new Set(existingConnectors.map((c: { connectorType: string }) => `connector-${c.connectorType}`));
const allSlugs = new Set([...existingSlugs, ...existingConnectorSlugs]);
const result = presets.map(p => ({ ...p, isAdded: allSlugs.has(p.slug) }));
```

Import `connectorConfigService` at top of file.

- [ ] **Step 2: Commit**

```bash
git add server/routes/mcpServers.ts
git commit -m "feat: include connectors in presets isAdded check"
```

---

### Task 10: Typecheck, verify, and clean up

**Files:**
- All modified files

- [ ] **Step 1: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 2: Fix any type errors**

Address any TypeScript issues found.

- [ ] **Step 3: Verify org-level Integrations page still works**

Navigate to `/admin/mcp-servers` — should show both MCP servers and connectors, catalogue should work.

- [ ] **Step 4: Verify subaccount Integrations tab works**

Navigate to a subaccount detail page, click "Integrations" tab — should show the full catalogue and allow adding integrations scoped to that subaccount.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: typecheck and integration verification"
```
