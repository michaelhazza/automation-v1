# Codebase Audit — Pre-Testing Fix List

**Date**: 2026-04-01  
**Branch**: `claude/codebase-audit-fixes-rjk6f`

---

## Audit Summary

Full audit of routes, services, DB schema, client-side code, auth/security, and config.

### Critical Findings (Must Fix Before Testing)

| # | Category | Issue | Location | Severity |
|---|----------|-------|----------|----------|
| 1 | **Routes** | ~145 routes across 25 files use manual try/catch instead of `asyncHandler` | `server/routes/*` | CRITICAL |
| 2 | **Org Scoping** | `skillService.getSkill()` and `getSkillBySlug()` don't filter by organisationId | `server/services/skillService.ts` | CRITICAL |
| 3 | **Org Scoping** | `fileService.downloadFile()` doesn't scope file lookup by org | `server/services/fileService.ts` | CRITICAL |
| 4 | **Org Scoping** | `taskService` activities query lacks organisationId filter | `server/services/taskService.ts` | CRITICAL |
| 5 | **Soft Delete** | `skillService` queries don't filter `isNull(deletedAt)` | `server/services/skillService.ts` | CRITICAL |
| 6 | **Schema** | `processes.organisationId` is nullable — should be `.notNull()` | `server/db/schema/processes.ts` | CRITICAL |
| 7 | **TypeScript** | `HeartbeatEditor.tsx` uses `clientWidth` on `DOMRect` (wrong API) | `client/src/components/HeartbeatEditor.tsx:75` | HIGH |
| 8 | **TypeScript** | `AdminAgentEditPage.tsx` passes wrong props to component | `client/src/pages/AdminAgentEditPage.tsx:1035` | HIGH |
| 9 | **Transactions** | `reviewService` updates actions + reviewItems without transaction | `server/services/reviewService.ts` | HIGH |
| 10 | **JSON Parse** | Unsafe `JSON.parse()` without try/catch in `executions.ts` route | `server/routes/executions.ts:54` | HIGH |
| 11 | **Hard Delete** | `taskService` hard-deletes deliverables instead of soft-delete | `server/services/taskService.ts` | HIGH |

### Important Findings (Should Fix)

| # | Category | Issue | Location | Severity |
|---|----------|-------|----------|----------|
| 12 | **Schema** | Missing `organisationId` indexes on agentTriggers, processConnectionMappings, processedResources, reviewItems | `server/db/schema/*` | MEDIUM |
| 13 | **Config** | `connectionTokenService` doesn't validate TOKEN_ENCRYPTION_KEY on startup | `server/services/connectionTokenService.ts` | MEDIUM |
| 14 | **Client** | `OrgAdminGuard` in App.tsx has no role/permission check — just null check | `client/src/App.tsx:82-85` | MEDIUM |
| 15 | **Client** | No API request timeout configured on axios instance | `client/src/lib/api.ts` | MEDIUM |
| 16 | **Client** | 12+ API calls silently swallow errors with `.catch(() => {})` | `client/src/components/Layout.tsx` and pages | MEDIUM |
| 17 | **Error Format** | Inconsistent error throw formats across services (plain objects vs Error instances) | Multiple services | MEDIUM |
| 18 | **Race Condition** | Budget reservation in llmRouter lacks transaction protection | `server/services/llmRouter.ts` | MEDIUM |

### Security Findings (from auth/security audit)

| # | Category | Issue | Location | Severity |
|---|----------|-------|----------|----------|
| 19 | **Security** | Helmet CSP disabled — no Content-Security-Policy header | `server/index.ts:72-76` | HIGH |
| 20 | **Security** | CORS allows wildcard origins with credentials enabled | `server/index.ts:77-80` | HIGH |
| 21 | **Security** | In-memory rate limiting lost on restart; bypassed in multi-process | `server/routes/auth.ts:6-20` | HIGH |
| 22 | **Security** | Webhook auth optional — no HMAC validation if WEBHOOK_SECRET unset | `server/services/webhookService.ts:72-74` | HIGH |
| 23 | **Security** | System admin cross-org access via X-Organisation-Id has no audit trail | `server/middleware/auth.ts:42-48` | HIGH |
| 24 | **Security** | Multer memory storage accepts 500MB — OOM DoS risk | `server/middleware/validate.ts:16-19` | MEDIUM |
| 25 | **Security** | No rate limiting on password reset / forgot-password routes | `server/routes/auth.ts:72-85` | MEDIUM |
| 26 | **Security** | Error messages leak internal details to clients in production | `server/index.ts:149-153` | MEDIUM |
| 27 | **Security** | Missing security audit trail — no logging of auth/permission events | No centralized audit | MEDIUM |

### Noted (Lower Priority / Post-Testing)

- Route files exceeding 200-line limit: `subaccounts.ts` (758L), `permissionSets.ts` (587L), `llmUsage.ts` (524L), `portal.ts` (502L)
- Auth tokens stored in localStorage (XSS risk — migrate to httpOnly cookies later)
- No React ErrorBoundary component
- Silent promise rejections in `workspaceMemoryService.ts`
- Missing cascade delete rules on parent-child task/agent relationships
- Deprecated columns in agents schema (`sourceTemplateId`, `sourceTemplateVersion`)
- OAuth state JWT window too long (10 min, recommend 5 min)
- No refresh token rotation on OAuth integrations
- JWT session expiry at 24h with no forced logout on password change

---

## Fix Progress

- [x] Fix TypeScript compile errors
- [x] Convert manual try/catch routes to asyncHandler (25 files)
- [x] Fix missing org scoping in services
- [x] Fix missing soft-delete filters
- [x] Add missing DB indexes
- [x] Fix unsafe JSON.parse calls
- [x] Wrap multi-step DB operations in transactions
- [x] Convert hard-delete to soft-delete in taskService
- [x] Validate TOKEN_ENCRYPTION_KEY on startup
- [x] Add API request timeout
- [x] Final build & type check (server + client clean)
