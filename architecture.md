# Automation OS — Architecture Guide

This file documents the backend architecture, conventions, and patterns for this application.
Claude Code should consult this before making backend changes.

---

## Backend Structure

```
server/
├── routes/          Route files — one per domain (max ~200 lines each)
├── services/        Business logic — one per domain
├── db/schema/       Drizzle ORM table definitions
├── middleware/       Express middleware (auth, validation)
├── lib/             Shared utilities (asyncHandler, permissions, resolveSubaccount)
├── config/          Environment and config
└── index.ts         Express app setup, route mounting
```

---

## Route File Conventions

### Use `asyncHandler` — no manual try/catch

Every route handler MUST use the `asyncHandler` wrapper from `server/lib/asyncHandler.ts`.
This eliminates repetitive try/catch blocks. Service-layer errors with `{ statusCode, message }`
are caught automatically and returned as JSON.

**Correct:**
```typescript
import { asyncHandler } from '../lib/asyncHandler.js';

router.get('/api/foo', authenticate, asyncHandler(async (req, res) => {
  const data = await fooService.getData(req.orgId!);
  res.json(data);
}));
```

**Wrong — do NOT write manual try/catch in route handlers:**
```typescript
// BAD — this pattern is deprecated
router.get('/api/foo', authenticate, async (req, res) => {
  try {
    const data = await fooService.getData(req.orgId!);
    res.json(data);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});
```

### One file per domain, max ~200 lines

Route files should be focused on a single domain. If a file exceeds ~200 lines, split it.

| Domain | File | Endpoints |
|--------|------|-----------|
| Board config (org + subaccount) | `boardConfig.ts` | 8 |
| Tasks, activities, deliverables | `tasks.ts` | 11 |
| Subaccount agent linking | `subaccountAgents.ts` | 7 |
| Agents CRUD | `agents.ts` | ~17 |
| Processes/automations | `processes.ts` | ~8 |
| Users | `users.ts` | ~7 |
| Permission sets | `permissionSets.ts` | ~12 |
| ... | ... | ... |

### Shared helpers

- **`resolveSubaccount(subaccountId, orgId)`** — from `server/lib/resolveSubaccount.ts`. Validates subaccount exists and belongs to the org. Throws 404 if not found. Use this in any route that takes `:subaccountId`.
- **`asyncHandler(fn)`** — from `server/lib/asyncHandler.ts`. Wraps async route handlers.

---

## Service Layer Conventions

- Services contain business logic. Routes are thin wrappers that validate input and call services.
- Services throw errors as `{ statusCode: number, message: string }` — the `asyncHandler` in routes catches these.
- One service per domain. If a service exceeds ~500 lines, consider splitting.

---

## Permission System

### Two-tier model

1. **Org-level**: `org_user_roles` → `permission_sets` → `permission_set_items` → `permissions`
2. **Subaccount-level**: `subaccount_user_assignments` → `permission_sets` → `permission_set_items` → `permissions`

### Middleware

- `authenticate` — JWT verification, resolves `req.orgId` (system_admin can override via `X-Organisation-Id` header)
- `requireOrgPermission(key)` — checks org-level permission. system_admin bypasses.
- `requireSubaccountPermission(key)` — checks subaccount-level permission. system_admin bypasses.

### Client-side nav

The sidebar loads permissions via `/api/my-permissions` (org-level) and `/api/subaccounts/:id/my-permissions` (subaccount-level) and uses them to show/hide nav items. See `Layout.tsx`.

---

## Board Config Hierarchy

```
Board Template (system-level, managed by system_admin)
    ↓ init
Org Board Config (one per org, columns array)
    ↓ push / auto-init
Subaccount Board Config (per-client override, inherits from org)
```

- Subaccount configs are copies, not live links. Changes to org config don't auto-propagate.
- "Push to All Clients" explicitly copies org columns to all subaccount configs.
- Subaccount admins can override their board config independently.

---

## Client vs Server Terminology

| UI Term | Internal Term |
|---------|--------------|
| Client | Subaccount |
| Team | Org users |
| Settings (client section) | Subaccount settings (categories, members, board config) |
| Client Settings | Admin subaccount config (automations, name/slug/status) |

---

## Key Patterns

- **Soft deletes**: Most tables use `deletedAt` column. Always filter with `isNull(table.deletedAt)`.
- **Org scoping**: All data queries filter by `organisationId`. For system_admin, this comes from `req.orgId` (which may differ from `req.user.organisationId` when using X-Organisation-Id header).
- **Lazy imports**: Client uses `lazy()` for all page components with `Suspense` fallback.
