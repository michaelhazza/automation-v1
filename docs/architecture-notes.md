# Architecture Notes - Automation OS

## System Overview

Automation OS is a multi-tenant SaaS operations platform for automation agencies. It separates workflow creation (technical, infrequent, performed by developers in n8n) from workflow execution (operational, frequent, performed by non-technical staff). The platform wraps workflow engines behind a Workflow Engine Adapter pattern, exposing a uniform execution interface regardless of which engine powers any given task.

**Technology Stack:** Node.js + Express, PostgreSQL (Drizzle ORM), React (TypeScript), pg-boss (background job queue), Cloudflare R2 or AWS S3 (file storage), JWT (authentication).

**Language Standard:** Australian English throughout all user-facing strings, code comments, and documentation.

---

## Multi-Tenancy Model

The platform uses an organisation-scoped multi-tenancy model. The `organisations` table is the tenant container. All other core entities are scoped directly or indirectly to an organisation.

Tenant isolation is enforced at the service layer. Every query against tenant-scoped tables must include an `organisationId` filter derived from the authenticated user's JWT payload. No cross-organisation data leakage is permitted. The three tables with mandatory filtering declared in `data-relationships.json` are: `executions`, `tasks`, and `users`.

**tenantKey classification used in data-relationships.json:**
- `container` - organisations (the root tenant entity)
- `direct` - tables with a direct `organisationId` FK (users, workflow_engines, task_categories, tasks, permission_groups)
- `indirect` - tables linked to tenant via a parent (permission_group_members, permission_group_categories, execution_files)
- `none` - platform-level tables with no tenant scoping (not present in MVP)

System admins operate across all organisations. Their queries are NOT filtered by organisationId.

---

## Invite-Only Onboarding

The platform uses invite-only onboarding. There is no self-service registration endpoint or page. The onboarding flow is:

1. System admin creates an organisation (POST /api/organisations), which provisions the org with an initial org_admin invitation email sent automatically.
2. The org_admin accepts their invitation via POST /api/auth/invite/accept (one-time token from email).
3. Org admin then invites staff via POST /api/users/invite, generating invitation emails for each user.
4. Staff accept their invitations and set passwords via the same POST /api/auth/invite/accept endpoint.

The `inviteToken` and `inviteExpiresAt` columns on the `users` table support this flow. Tokens expire after `INVITE_TOKEN_EXPIRY_HOURS` (default 72 hours). Accepting an invitation sets `status = 'active'` and clears the token fields.

**VIOLATION #14 compliance:** POST /api/auth/register does not exist. No /register page exists in the UI. AcceptInvitePage at /invite/accept is the sole new-user entry point.

---

## Authentication

JWT-based authentication. The login endpoint (POST /api/auth/login) issues a signed JWT containing the user's `id`, `organisationId`, `role`, and `email`. Token validity defaults to 24 hours.

All protected endpoints use the `authenticate` middleware which validates the JWT, extracts the payload, and attaches the user context to `req.user`. Role-restricted endpoints additionally use the `requireRole` middleware to enforce minimum role requirements.

`JWT_SECRET` must be set and is `required: true` in env-manifest. It must have minimum 256 bits of entropy (see env-manifest securityNotes).

Stateless authentication: there is no server-side session store. Logout at the API layer is informational only (the client discards the token). Token revocation is not in MVP scope.

---

## Workflow Engine Adapter Pattern

The engine adapter pattern decouples task execution from engine implementation. Each engine adapter implements a common interface:

- `authenticate(config)` - validate engine credentials and connectivity
- `execute(task, inputData, files)` - dispatch execution to the engine endpoint
- `parseResponse(rawResponse)` - normalise the engine response to a standard output format
- `translateError(error)` - map engine-specific errors to standardised messages
- `handleFiles(files)` - manage file upload/download for the engine

**MVP adapter:** n8n (Cloud and self-hosted). n8n is webhook-based. Execution dispatches a POST to the configured `endpointUrl` with input data and file references.

Both `workflow_engines` and `tasks` carry an `engineType` field. The execution dispatcher reads `task.engineType` and routes to the correct adapter at runtime.

Engine details (baseUrl, apiKey, engineType) are never exposed to manager or user roles. API responses for task endpoints strip all engine fields before responding to non-admin callers.

---

## Execution Queue and Background Processing

The execution queue is backed by **pg-boss** (PostgreSQL-based job queue) by default. pg-boss requires zero additional infrastructure for MVP -- it stores jobs in the same PostgreSQL database.

**JOB_QUEUE_BACKEND** controls which backend is used (default: `pg-boss`). Setting it to `bullmq` switches to a Redis-backed queue (requires `REDIS_URL`).

**Execution lifecycle:**

1. POST /api/executions creates an execution record with `status = 'pending'` and enqueues a job.
2. Queue worker picks up the job and updates `status = 'running'`, sets `startedAt`.
3. Worker dispatches to the engine adapter.
4. On success: updates `status = 'completed'`, sets `outputData`, `completedAt`, `durationMs`. Sends email notification.
5. On failure: increments `retryCount`. After 3 failures: updates `status = 'failed'`, sets `errorMessage` and `errorDetail`.
6. On timeout (exceeds `task.timeoutSeconds`): updates `status = 'timeout'` with clear user-facing message.

**Async model:** Execution submission (POST /api/executions) is non-blocking. The API returns immediately with `status = 'pending'` and an execution ID. The client polls GET /api/executions/:id to track progress. This is a fire-and-forget dispatch pattern using pg-boss's job queuing mechanism -- the HTTP response is sent before the engine execution begins.

**Duplicate prevention:** A 5-minute cooldown window is enforced per user per task. If a user submits the same task within the cooldown window, the API returns 429 with a time-remaining message. This check occurs before the execution record is created.

**Queue concurrency** is configurable via `QUEUE_CONCURRENCY` (default: 5 concurrent worker slots).

---

## File Storage

Execution files (inputs uploaded by staff, outputs returned by engines) are stored in cloud object storage. The adapter is selected by `FILE_STORAGE_BACKEND`:

- `r2` (default) - Cloudflare R2 using the S3-compatible API
- `s3` - AWS S3

Files are uploaded to a path pattern: `executions/{executionId}/{fileType}/{fileName}`. Presigned URLs are generated for downloads (short expiry, typically 15 minutes).

File records in `execution_files` include an `expiresAt` timestamp set to 30 days after upload (configurable via `FILE_RETENTION_DAYS`). A background cleanup job runs periodically to delete expired files from storage and mark records as expired.

The `execution_files.fileType` enum distinguishes `input` (uploaded by user before execution) from `output` (returned by engine after execution).

---

## Role-Based Access Control

Five roles are defined in the `user_role` enum: `system_admin`, `org_admin`, `manager`, `user`, `client_user`.

**Role hierarchy for Automation OS MVP:**
- `system_admin` - platform-wide, manages all organisations. Scoped to system-admin-only endpoints (GET/POST/PATCH/DELETE /api/organisations).
- `org_admin` - full control within their organisation. Manages engines, tasks, categories, permission groups, users.
- `manager` - executes permitted tasks, views history for accessible task categories.
- `user` - executes permitted tasks, views own execution history only.
- `client_user` - data model present in MVP; portal UI deferred to Phase 2.

Permission groups enable fine-grained access without creating per-user task assignments. A manager or user must belong to at least one permission group that includes a task's category to execute that task.

The `requireRole` middleware accepts a minimum role level and rejects requests from callers with insufficient privilege. Endpoints with `requiredRole: system_admin` reject all non-system-admin callers, including org_admin.

---

## Soft Delete Strategy

The following tables use soft deletion (deletedAt timestamp column):
- `organisations` - cascades to users, workflow_engines, task_categories, tasks, permission_groups
- `users`
- `workflow_engines` - cascades to tasks
- `task_categories`
- `tasks`
- `permission_groups`

The following tables use hard deletion (no soft delete):
- `permission_group_members` - membership records are hard deleted; application layer cleans up when parent is soft deleted
- `permission_group_categories` - same as above
- `executions` - immutable audit records, never deleted
- `execution_files` - expired via `expiresAt`, not soft deleted

All unique constraints on soft-deletable tables use `partialUnique: true` scoped to `where deleted_at IS NULL` to allow value reuse after deletion (e.g. an organisation name can be reused after the original org is deleted).

---

## Onboarding Telemetry

The platform instruments four key onboarding funnel events from day one:

1. **time-to-first-connection** - measured between org creation and first successful POST /api/engines/:id/test
2. **time-to-first-task** - measured between org creation and first POST /api/tasks with status reaching 'active'
3. **time-to-first-execution** - measured between org creation and first POST /api/executions reaching 'completed'
4. **drop-off points** - pages or API calls where new orgs stop progressing through the setup flow

Instrumentation is added at the service layer for these key events using server-side timestamps on the execution and engine records. Drop-off analysis uses the absence of subsequent funnel events within a time window.

---

## Database Schema Conventions

- All primary keys are UUID (`uuid` type, `primaryKey: true`)
- Timestamps use PostgreSQL `timestamp` type with Drizzle mode `date`
- All tables include `createdAt` and `updatedAt`; soft-delete tables add `deletedAt`
- Foreign keys are indexed (`indexed: true`)
- Enum columns use `text` PostgreSQL type with application-level validation (not PostgreSQL native enums, for migration flexibility)
- Drizzle ORM is used for type-safe schema definitions and queries

---

## Security Considerations

- JWT_SECRET requires minimum 256 bits of entropy (openssl rand -base64 32)
- Engine API keys (apiKey on workflow_engines) are stored as plaintext in MVP. Phase 2 should add encryption at rest for this field.
- Presigned URLs for file downloads have short expiry (15 minutes)
- Admin error detail (errorDetail JSONB) is only returned to org_admin and system_admin callers. Other roles receive only errorMessage (sanitised string).
- CORS origins should be restricted to the frontend domain in production via `CORS_ORIGINS`

---

## Machine-Readable Appendix

```json
{
  "applicationName": "Automation OS",
  "specVersion": "1.0",
  "generatedAt": "2026-02",
  "counts": {
    "endpointCount": 51,
    "pageCount": 16,
    "entityCount": 10,
    "gateScriptCount": 14,
    "qaScriptCount": 10
  },
  "requiredEntities": [
    "organisations",
    "users",
    "workflowEngines",
    "taskCategories",
    "tasks",
    "permissionGroups",
    "permissionGroupMembers",
    "permissionGroupCategories",
    "executions",
    "executionFiles"
  ],
  "deferredEntities": [
    "clientWorkspaces",
    "clientUsers"
  ],
  "allEntities": [
    "organisations",
    "users",
    "workflowEngines",
    "taskCategories",
    "tasks",
    "permissionGroups",
    "permissionGroupMembers",
    "permissionGroupCategories",
    "executions",
    "executionFiles",
    "clientWorkspaces",
    "clientUsers"
  ],
  "onboardingModel": "invite_only",
  "authenticationMethod": "jwt",
  "backgroundQueueDefault": "pg-boss",
  "fileStorageDefault": "r2",
  "fileRetentionDays": 30,
  "mvpEngineAdapters": ["n8n"],
  "phase2EngineAdapters": ["ghl"],
  "phase3EngineAdapters": ["make", "zapier", "custom_webhook"],
  "multiTenancyModel": "organisation-scoped",
  "softDeleteTables": ["organisations", "users", "workflow_engines", "task_categories", "tasks", "permission_groups"],
  "immutableAuditTables": ["executions"]
}
```
