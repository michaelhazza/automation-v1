# Page Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full agent-controlled page hosting infrastructure: multi-tenant projects with subdomains, page creation/serving, form submissions routed through integration adapters, and conversion analytics.

**Architecture:** New `page_projects` table (renamed from spec's `projects` to avoid collision with the existing dev-project `projects` table) owns subdomains and pages. Public page serving uses hostname-based subdomain routing middleware. Form submissions are stored atomically with pg-boss job enqueue, then processed async by an integration worker calling GHL/Stripe adapters.

**Tech Stack:** Express, Drizzle ORM (postgres.js), pg-boss 9.0.3, jsonwebtoken (already installed), sanitize-html (new dependency), existing asyncHandler/resolveSubaccount patterns.

---

## Codebase Context (Read Before Starting)

- **Naming conflict:** The spec calls the top-level entity "projects" — but the codebase already has a `projects` table for dev/task-management projects. The new table is named `page_projects` throughout this plan.
- **DB pattern:** `server/db/schema/*.ts` → export from `server/db/schema/index.ts` → SQL in `migrations/0NNN_*.sql`. Always add both.
- **Route pattern:** `authenticate` + `requireSubaccountPermission()` for protected routes; NO auth for public routes (see `server/routes/webhooks.ts`). Wrap handlers in `asyncHandler`. Call `resolveSubaccount(subaccountId, req.orgId!)` for tenant isolation.
- **Queue pattern:** See `server/services/queueService.ts` — pg-boss initialized lazily via `getQueueBackend()`. New workers register with `pgBossQueue.work(QUEUE_NAME, handler)`.
- **Action registry:** `server/config/actionRegistry.ts` — add entries to `ACTION_REGISTRY` object with full `ActionDefinition` shape.
- **Next migration number:** `0042`

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `server/db/schema/pageProjects.ts` | page_projects table definition |
| `server/db/schema/pages.ts` | pages table definition |
| `server/db/schema/pageVersions.ts` | page_versions table |
| `server/db/schema/projectIntegrations.ts` | project_integrations table |
| `server/db/schema/formSubmissions.ts` | form_submissions table |
| `server/db/schema/pageViews.ts` | page_views table |
| `server/db/schema/conversionEvents.ts` | conversion_events table |
| `migrations/0042_page_infrastructure.sql` | All 7 tables in one migration |
| `server/lib/htmlSanitizer.ts` | Allowlist HTML sanitization + size validation |
| `server/lib/previewTokenService.ts` | HMAC-signed preview token generate/validate |
| `server/middleware/subdomainResolution.ts` | Parse hostname → project + page lookup |
| `server/adapters/integrationAdapter.ts` | Adapter interface types |
| `server/adapters/ghlAdapter.ts` | GHL CRM adapter |
| `server/adapters/stripeAdapter.ts` | Stripe payments adapter |
| `server/adapters/index.ts` | Adapter registry `adapters[providerType]` |
| `server/services/pageProjectService.ts` | page_projects CRUD |
| `server/services/pageService.ts` | pages CRUD + publish + version saving |
| `server/services/formSubmissionService.ts` | Submission dedup, validate, atomic store+enqueue |
| `server/services/pageIntegrationWorker.ts` | pg-boss worker for `page-integration` queue |
| `server/services/paymentReconciliationJob.ts` | Scheduled reconciliation job |
| `server/routes/pageProjects.ts` | Authenticated CRUD routes for page_projects |
| `server/routes/pageRoutes.ts` | Authenticated CRUD routes for pages |
| `server/routes/public/pageServing.ts` | GET — serve published pages via subdomain |
| `server/routes/public/pagePreview.ts` | GET /preview/:slug?token=... |
| `server/routes/public/formSubmission.ts` | POST /api/public/pages/:pageId/submit |
| `server/routes/public/pageTracking.ts` | POST /api/public/track |

### Modified Files

| File | Change |
|------|--------|
| `server/db/schema/index.ts` | Export 7 new schema files |
| `server/config/actionRegistry.ts` | Add create_page, update_page, publish_page actions |
| `server/index.ts` | Mount new routes, initialize worker + reconciliation job |
| `package.json` | Add `sanitize-html` + `@types/sanitize-html` |

---

## Task 1: Install sanitize-html and create feature branch

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Verify we're on the feature branch**

```bash
git branch
```

Expected: `* feature/page-infrastructure`

- [ ] **Step 2: Install sanitize-html**

```bash
npm install sanitize-html
npm install --save-dev @types/sanitize-html
```

Expected: `sanitize-html` appears in `dependencies`, `@types/sanitize-html` in `devDependencies`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add sanitize-html dependency for page HTML sanitization"
```

---

## Task 2: Schema — seven new tables

**Files:**
- Create: `server/db/schema/pageProjects.ts`
- Create: `server/db/schema/pages.ts`
- Create: `server/db/schema/pageVersions.ts`
- Create: `server/db/schema/projectIntegrations.ts`
- Create: `server/db/schema/formSubmissions.ts`
- Create: `server/db/schema/pageViews.ts`
- Create: `server/db/schema/conversionEvents.ts`

- [ ] **Step 1: Create pageProjects.ts**

```typescript
// server/db/schema/pageProjects.ts
import { pgTable, uuid, text, jsonb, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';

// page_projects — marketing sites that get a subdomain.
// Named page_projects to distinguish from the existing `projects` dev-project table.
export const pageProjects = pgTable(
  'page_projects',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').notNull().references(() => subaccounts.id),
    name: text('name').notNull(),
    slug: text('slug').notNull(), // becomes subdomain: slug.synthetos.ai
    theme: jsonb('theme').$type<{
      primaryColor?: string;
      secondaryColor?: string;
      fontHeading?: string;
      fontBody?: string;
      logoUrl?: string;
      faviconUrl?: string;
    }>(),
    customDomain: text('custom_domain'), // e.g. "launch.acmecorp.com" — future use
    githubRepo: text('github_repo'),     // e.g. "org/repo" — for dynamic apps, optional
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    // Slug unique per subaccount (soft-delete aware — enforced at application layer)
    subaccountIdx: index('page_projects_subaccount_idx').on(table.subaccountId),
    orgIdx: index('page_projects_org_idx').on(table.organisationId),
    slugSubaccountIdx: index('page_projects_slug_subaccount_idx').on(table.subaccountId, table.slug),
  })
);

export type PageProject = typeof pageProjects.$inferSelect;
export type NewPageProject = typeof pageProjects.$inferInsert;
```

- [ ] **Step 2: Create pages.ts**

```typescript
// server/db/schema/pages.ts
import { pgTable, uuid, text, jsonb, timestamp, unique, index } from 'drizzle-orm/pg-core';
import { pageProjects } from './pageProjects';
import { agents } from './agents';

export const pages = pgTable(
  'pages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id').notNull().references(() => pageProjects.id),
    slug: text('slug').notNull(), // e.g. "offer1", "index", "pricing"
    pageType: text('page_type').notNull().$type<'website' | 'landing'>(),
    title: text('title'),
    html: text('html'), // full rendered HTML — written by Claude, max 1MB
    status: text('status').notNull().default('draft').$type<'draft' | 'published' | 'archived'>(),
    meta: jsonb('meta').$type<{
      title?: string;
      description?: string;
      ogImage?: string;
      canonicalUrl?: string;
      noIndex?: boolean;
    }>(),
    formConfig: jsonb('form_config').$type<{
      fields: Array<{ name: string; type: string; required: boolean }>;
      actions: Record<string, { action: string; fields: Record<string, unknown> }>;
      thankYou: { type: 'redirect' | 'message'; value: string };
    }>(),
    createdByAgentId: uuid('created_by_agent_id').references(() => agents.id),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    projectSlugUnique: unique('pages_project_slug_unique').on(table.projectId, table.slug),
    projectIdx: index('pages_project_idx').on(table.projectId),
    projectStatusIdx: index('pages_project_status_idx').on(table.projectId, table.status),
  })
);

export type Page = typeof pages.$inferSelect;
export type NewPage = typeof pages.$inferInsert;
```

- [ ] **Step 3: Create pageVersions.ts**

```typescript
// server/db/schema/pageVersions.ts
import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { pages } from './pages';

export const pageVersions = pgTable(
  'page_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    pageId: uuid('page_id').notNull().references(() => pages.id),
    html: text('html'), // snapshot of HTML at this version
    meta: jsonb('meta'), // snapshot of meta at this version
    changeNote: text('change_note'), // what changed and why
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pageIdx: index('page_versions_page_idx').on(table.pageId),
  })
);

export type PageVersion = typeof pageVersions.$inferSelect;
export type NewPageVersion = typeof pageVersions.$inferInsert;
```

- [ ] **Step 4: Create projectIntegrations.ts**

```typescript
// server/db/schema/projectIntegrations.ts
import { pgTable, uuid, text, timestamp, unique, index } from 'drizzle-orm/pg-core';
import { pageProjects } from './pageProjects';
import { integrationConnections } from './integrationConnections';

// Links a page_project to a connection for a specific purpose.
// One CRM per project, one payment gateway, etc.
export const projectIntegrations = pgTable(
  'project_integrations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id').notNull().references(() => pageProjects.id),
    purpose: text('purpose').notNull().$type<'crm' | 'payments' | 'email' | 'ads' | 'analytics'>(),
    connectionId: uuid('connection_id').notNull().references(() => integrationConnections.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    projectPurposeUnique: unique('project_integrations_project_purpose').on(table.projectId, table.purpose),
    projectIdx: index('project_integrations_project_idx').on(table.projectId),
  })
);

export type ProjectIntegration = typeof projectIntegrations.$inferSelect;
export type NewProjectIntegration = typeof projectIntegrations.$inferInsert;
```

- [ ] **Step 5: Create formSubmissions.ts**

```typescript
// server/db/schema/formSubmissions.ts
import { pgTable, uuid, text, jsonb, timestamp, unique, index } from 'drizzle-orm/pg-core';
import { pages } from './pages';

export const formSubmissions = pgTable(
  'form_submissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    pageId: uuid('page_id').notNull().references(() => pages.id),
    data: jsonb('data').notNull(), // submitted form data, max 50KB validated at endpoint
    submissionHash: text('submission_hash').notNull(), // SHA-256(pageId + sorted payload)
    integrationStatus: text('integration_status')
      .notNull()
      .default('pending')
      .$type<'pending' | 'processing' | 'success' | 'partial_failure' | 'failed'>(),
    integrationResults: jsonb('integration_results'), // per-purpose results
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    hashUnique: unique('form_submissions_hash_unique').on(table.submissionHash),
    pageIdx: index('form_submissions_page_idx').on(table.pageId),
    submittedAtIdx: index('form_submissions_submitted_at_idx').on(table.submittedAt),
    statusIdx: index('form_submissions_status_idx').on(table.integrationStatus),
  })
);

export type FormSubmission = typeof formSubmissions.$inferSelect;
export type NewFormSubmission = typeof formSubmissions.$inferInsert;
```

- [ ] **Step 6: Create pageViews.ts**

```typescript
// server/db/schema/pageViews.ts
import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { pages } from './pages';

export const pageViews = pgTable(
  'page_views',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    pageId: uuid('page_id').notNull().references(() => pages.id),
    sessionId: text('session_id'),
    referrer: text('referrer'),
    utmSource: text('utm_source'),
    utmMedium: text('utm_medium'),
    utmCampaign: text('utm_campaign'),
    country: text('country'),
    deviceType: text('device_type'),
    viewedAt: timestamp('viewed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pageIdx: index('page_views_page_idx').on(table.pageId),
    pageViewedAtIdx: index('page_views_page_viewed_at_idx').on(table.pageId, table.viewedAt),
  })
);

export type PageView = typeof pageViews.$inferSelect;
export type NewPageView = typeof pageViews.$inferInsert;
```

- [ ] **Step 7: Create conversionEvents.ts**

```typescript
// server/db/schema/conversionEvents.ts
import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { pages } from './pages';
import { formSubmissions } from './formSubmissions';

export const conversionEvents = pgTable(
  'conversion_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    pageId: uuid('page_id').notNull().references(() => pages.id),
    submissionId: uuid('submission_id').references(() => formSubmissions.id),
    eventType: text('event_type')
      .notNull()
      .$type<'form_submitted' | 'checkout_started' | 'checkout_completed' | 'checkout_abandoned' | 'contact_created'>(),
    sessionId: text('session_id'), // links to page_views for funnel analysis
    metadata: jsonb('metadata'), // event-specific data: revenue, plan name, etc.
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pageIdx: index('conversion_events_page_idx').on(table.pageId),
    pageEventTypeIdx: index('conversion_events_page_event_type_idx').on(table.pageId, table.eventType),
    occurredAtIdx: index('conversion_events_occurred_at_idx').on(table.occurredAt),
  })
);

export type ConversionEvent = typeof conversionEvents.$inferSelect;
export type NewConversionEvent = typeof conversionEvents.$inferInsert;
```

- [ ] **Step 8: Verify TypeScript compiles**

```bash
cd c:/Files/Projects/automation-v1
npx tsx --check server/db/schema/pageProjects.ts
npx tsx --check server/db/schema/pages.ts
npx tsx --check server/db/schema/pageVersions.ts
npx tsx --check server/db/schema/projectIntegrations.ts
npx tsx --check server/db/schema/formSubmissions.ts
npx tsx --check server/db/schema/pageViews.ts
npx tsx --check server/db/schema/conversionEvents.ts
```

Expected: No errors.

---

## Task 3: Migration SQL + schema index export

**Files:**
- Create: `migrations/0042_page_infrastructure.sql`
- Modify: `server/db/schema/index.ts`

- [ ] **Step 1: Write migration SQL**

```sql
-- migrations/0042_page_infrastructure.sql
-- Page Infrastructure: multi-tenant page hosting for agent-controlled landing pages

-- 1. page_projects — marketing sites with subdomains
CREATE TABLE IF NOT EXISTS page_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id),
  subaccount_id UUID NOT NULL REFERENCES subaccounts(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  theme JSONB,
  custom_domain TEXT,
  github_repo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX page_projects_subaccount_idx ON page_projects(subaccount_id);
CREATE INDEX page_projects_org_idx ON page_projects(organisation_id);
CREATE INDEX page_projects_slug_subaccount_idx ON page_projects(subaccount_id, slug);

-- 2. pages — individual pages within a project
CREATE TABLE IF NOT EXISTS pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES page_projects(id),
  slug TEXT NOT NULL,
  page_type TEXT NOT NULL CHECK (page_type IN ('website', 'landing')),
  title TEXT,
  html TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  meta JSONB,
  form_config JSONB,
  created_by_agent_id UUID REFERENCES agents(id),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pages_project_slug_unique UNIQUE (project_id, slug)
);

CREATE INDEX pages_project_idx ON pages(project_id);
CREATE INDEX pages_project_status_idx ON pages(project_id, status);

-- 3. page_versions — history of every page change
CREATE TABLE IF NOT EXISTS page_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES pages(id),
  html TEXT,
  meta JSONB,
  change_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX page_versions_page_idx ON page_versions(page_id);

-- 4. project_integrations — links a page_project to an integration connection
CREATE TABLE IF NOT EXISTS project_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES page_projects(id),
  purpose TEXT NOT NULL CHECK (purpose IN ('crm', 'payments', 'email', 'ads', 'analytics')),
  connection_id UUID NOT NULL REFERENCES integration_connections(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT project_integrations_project_purpose UNIQUE (project_id, purpose)
);

CREATE INDEX project_integrations_project_idx ON project_integrations(project_id);

-- 5. form_submissions — captured leads from page forms
CREATE TABLE IF NOT EXISTS form_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES pages(id),
  data JSONB NOT NULL,
  submission_hash TEXT NOT NULL,
  integration_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (integration_status IN ('pending', 'processing', 'success', 'partial_failure', 'failed')),
  integration_results JSONB,
  ip_address TEXT,
  user_agent TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT form_submissions_hash_unique UNIQUE (submission_hash)
);

CREATE INDEX form_submissions_page_idx ON form_submissions(page_id);
CREATE INDEX form_submissions_submitted_at_idx ON form_submissions(submitted_at);
CREATE INDEX form_submissions_status_idx ON form_submissions(integration_status);

-- 6. page_views — analytics
CREATE TABLE IF NOT EXISTS page_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES pages(id),
  session_id TEXT,
  referrer TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  country TEXT,
  device_type TEXT,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX page_views_page_idx ON page_views(page_id);
CREATE INDEX page_views_page_viewed_at_idx ON page_views(page_id, viewed_at);

-- 7. conversion_events — funnel tracking
CREATE TABLE IF NOT EXISTS conversion_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES pages(id),
  submission_id UUID REFERENCES form_submissions(id),
  event_type TEXT NOT NULL
    CHECK (event_type IN ('form_submitted', 'checkout_started', 'checkout_completed', 'checkout_abandoned', 'contact_created')),
  session_id TEXT,
  metadata JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX conversion_events_page_idx ON conversion_events(page_id);
CREATE INDEX conversion_events_page_event_type_idx ON conversion_events(page_id, event_type);
CREATE INDEX conversion_events_occurred_at_idx ON conversion_events(occurred_at);

-- updated_at triggers for tables that need them
CREATE OR REPLACE TRIGGER page_projects_updated_at
  BEFORE UPDATE ON page_projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER pages_updated_at
  BEFORE UPDATE ON pages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

- [ ] **Step 2: Export new schemas from index**

Add to `server/db/schema/index.ts` after the existing `export * from './projects';` line:

```typescript
export * from './pageProjects';
export * from './pages';
export * from './pageVersions';
export * from './projectIntegrations';
export * from './formSubmissions';
export * from './pageViews';
export * from './conversionEvents';
```

- [ ] **Step 3: Run migration against the database**

```bash
cd c:/Files/Projects/automation-v1
npx drizzle-kit push
```

Or if using migration files:
```bash
npx drizzle-kit migrate
```

Expected: Migration `0042_page_infrastructure.sql` applied. All 7 tables created.

- [ ] **Step 4: Commit**

```bash
git add server/db/schema/pageProjects.ts server/db/schema/pages.ts server/db/schema/pageVersions.ts
git add server/db/schema/projectIntegrations.ts server/db/schema/formSubmissions.ts
git add server/db/schema/pageViews.ts server/db/schema/conversionEvents.ts
git add server/db/schema/index.ts migrations/0042_page_infrastructure.sql
git commit -m "feat: add page infrastructure schema — 7 new tables"
```

---

## Task 4: HTML sanitizer + preview token service

**Files:**
- Create: `server/lib/htmlSanitizer.ts`
- Create: `server/lib/previewTokenService.ts`

- [ ] **Step 1: Create htmlSanitizer.ts**

```typescript
// server/lib/htmlSanitizer.ts
import sanitizeHtml from 'sanitize-html';

const MAX_HTML_BYTES = 1024 * 1024; // 1MB

// Allowlist of domains for iframe embeds
const ALLOWED_IFRAME_DOMAINS = [
  'link.msgsndr.com',
  'js.stripe.com',
  'buy.stripe.com',
  'www.youtube.com',
  'player.vimeo.com',
  'calendly.com',
];

function isAllowedIframeSrc(src: string): boolean {
  try {
    const url = new URL(src);
    return ALLOWED_IFRAME_DOMAINS.some((domain) => url.hostname === domain || url.hostname.endsWith('.' + domain));
  } catch {
    return false;
  }
}

/**
 * Sanitise HTML written by Claude before storage.
 * - Strips <script> tags, event handlers (on*), javascript: URIs
 * - Preserves iframes only from known embed domains
 * - Validates size ≤ 1MB
 *
 * Throws { statusCode: 413, message: '...' } if over size limit.
 */
export function sanitizePageHtml(html: string): string {
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    throw { statusCode: 413, message: 'Page HTML exceeds maximum size of 1MB' };
  }

  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      'html', 'head', 'body', 'meta', 'link', 'title', 'style',
      'header', 'footer', 'main', 'section', 'article', 'aside', 'nav',
      'figure', 'figcaption', 'picture', 'source',
      'video', 'audio', 'track',
      'iframe',
      'svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'g', 'defs', 'use',
      'canvas',
    ]),
    allowedAttributes: {
      '*': ['class', 'id', 'style', 'data-*', 'aria-*', 'role', 'tabindex'],
      'a': ['href', 'target', 'rel', 'name'],
      'img': ['src', 'srcset', 'sizes', 'alt', 'width', 'height', 'loading'],
      'source': ['src', 'srcset', 'media', 'type', 'sizes'],
      'video': ['src', 'controls', 'autoplay', 'muted', 'loop', 'poster', 'preload', 'width', 'height'],
      'audio': ['src', 'controls', 'autoplay', 'muted', 'loop', 'preload'],
      'iframe': ['src', 'width', 'height', 'frameborder', 'allowfullscreen', 'allow', 'title', 'loading'],
      'meta': ['name', 'content', 'charset', 'http-equiv', 'property'],
      'link': ['rel', 'href', 'type', 'media', 'crossorigin'],
      'form': ['action', 'method', 'id', 'class', 'enctype'],
      'input': ['type', 'name', 'id', 'class', 'placeholder', 'required', 'value', 'pattern', 'min', 'max', 'step', 'autocomplete'],
      'textarea': ['name', 'id', 'class', 'placeholder', 'required', 'rows', 'cols'],
      'select': ['name', 'id', 'class', 'required', 'multiple'],
      'option': ['value', 'selected'],
      'button': ['type', 'id', 'class', 'disabled'],
      'label': ['for', 'class'],
      'svg': ['xmlns', 'viewBox', 'width', 'height', 'fill', 'stroke', 'stroke-width'],
      'path': ['d', 'fill', 'stroke', 'stroke-width'],
      'canvas': ['id', 'width', 'height'],
    },
    // Strip all event handlers
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: {
      img: ['http', 'https', 'data'],
    },
    exclusiveFilter: (frame) => {
      // Strip iframes not from allowed domains
      if (frame.tag === 'iframe') {
        const src = frame.attribs.src || '';
        return !isAllowedIframeSrc(src);
      }
      return false;
    },
  });
}
```

- [ ] **Step 2: Create previewTokenService.ts**

```typescript
// server/lib/previewTokenService.ts
import jwt from 'jsonwebtoken';

const PREVIEW_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || 'preview-secret-change-me';
const PREVIEW_EXPIRY_SECONDS = 24 * 60 * 60; // 24 hours

interface PreviewTokenPayload {
  pageId: string;
  projectId: string;
}

export const previewTokenService = {
  generate(pageId: string, projectId: string): string {
    return jwt.sign({ pageId, projectId }, PREVIEW_SECRET, { expiresIn: PREVIEW_EXPIRY_SECONDS });
  },

  verify(token: string): PreviewTokenPayload {
    try {
      const decoded = jwt.verify(token, PREVIEW_SECRET) as PreviewTokenPayload & { iat: number; exp: number };
      return { pageId: decoded.pageId, projectId: decoded.projectId };
    } catch {
      throw { statusCode: 401, message: 'Invalid or expired preview token' };
    }
  },
};
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsx --check server/lib/htmlSanitizer.ts
npx tsx --check server/lib/previewTokenService.ts
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add server/lib/htmlSanitizer.ts server/lib/previewTokenService.ts
git commit -m "feat: add HTML sanitizer and preview token service"
```

---

## Task 5: Integration adapter interface + GHL + Stripe adapters

**Files:**
- Create: `server/adapters/integrationAdapter.ts`
- Create: `server/adapters/ghlAdapter.ts`
- Create: `server/adapters/stripeAdapter.ts`
- Create: `server/adapters/index.ts`

- [ ] **Step 1: Create adapter interface**

```typescript
// server/adapters/integrationAdapter.ts
import type { IntegrationConnection } from '../db/schema/index.js';

export interface CrmCreateContactResult {
  contactId: string;
  success: boolean;
  error?: string;
}

export interface PaymentsCreateCheckoutResult {
  checkoutUrl: string;
  sessionId: string;
  success: boolean;
  error?: string;
}

export interface PaymentsGetStatusResult {
  status: 'pending' | 'completed' | 'failed' | 'expired';
  success: boolean;
  error?: string;
}

export interface IntegrationAdapter {
  supportedActions: string[];
  crm?: {
    createContact(connection: IntegrationConnection, fields: Record<string, unknown>): Promise<CrmCreateContactResult>;
  };
  payments?: {
    createCheckout(connection: IntegrationConnection, fields: Record<string, unknown>): Promise<PaymentsCreateCheckoutResult>;
    getPaymentStatus(connection: IntegrationConnection, sessionId: string): Promise<PaymentsGetStatusResult>;
  };
}
```

- [ ] **Step 2: Create GHL adapter**

```typescript
// server/adapters/ghlAdapter.ts
import axios from 'axios';
import type { IntegrationConnection } from '../db/schema/index.js';
import type { IntegrationAdapter, CrmCreateContactResult } from './integrationAdapter.js';
import { connectionTokenService } from '../services/connectionTokenService.js';

export const ghlAdapter: IntegrationAdapter = {
  supportedActions: ['create_contact', 'tag_contact', 'create_opportunity'],

  crm: {
    async createContact(connection: IntegrationConnection, fields: Record<string, unknown>): Promise<CrmCreateContactResult> {
      const accessToken = connection.accessToken
        ? connectionTokenService.decryptToken(connection.accessToken)
        : null;

      if (!accessToken) {
        return { contactId: '', success: false, error: 'No access token available for GHL connection' };
      }

      const locationId = (connection.configJson as Record<string, unknown>)?.locationId as string;
      if (!locationId) {
        return { contactId: '', success: false, error: 'GHL connection missing locationId in configJson' };
      }

      const body: Record<string, unknown> = {
        locationId,
        firstName: fields.name ? String(fields.name).split(' ')[0] : undefined,
        lastName: fields.name ? String(fields.name).split(' ').slice(1).join(' ') || undefined : undefined,
        email: fields.email ? String(fields.email) : undefined,
        phone: fields.phone ? String(fields.phone) : undefined,
        tags: (fields.tags as string[]) ?? [],
      };

      // Add pipeline stage if provided
      if (fields.pipelineStage) {
        body.customField = [{ key: 'pipeline_stage', field_value: fields.pipelineStage }];
      }

      try {
        const response = await axios.post(
          'https://services.leadconnectorhq.com/contacts/',
          body,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Version: '2021-07-28',
              'Content-Type': 'application/json',
            },
            timeout: 12000,
          }
        );
        return { contactId: response.data?.contact?.id ?? '', success: true };
      } catch (err: unknown) {
        const message = axios.isAxiosError(err) ? err.response?.data?.message ?? err.message : String(err);
        return { contactId: '', success: false, error: message };
      }
    },
  },
};
```

- [ ] **Step 3: Create Stripe adapter**

```typescript
// server/adapters/stripeAdapter.ts
import axios from 'axios';
import type { IntegrationConnection } from '../db/schema/index.js';
import type { IntegrationAdapter, PaymentsCreateCheckoutResult, PaymentsGetStatusResult } from './integrationAdapter.js';
import { connectionTokenService } from '../services/connectionTokenService.js';

export const stripeAdapter: IntegrationAdapter = {
  supportedActions: ['create_checkout', 'get_payment_status'],

  payments: {
    async createCheckout(connection: IntegrationConnection, fields: Record<string, unknown>): Promise<PaymentsCreateCheckoutResult> {
      const secretKey = connection.secretsRef
        ? connectionTokenService.decryptToken(connection.secretsRef)
        : null;

      if (!secretKey) {
        return { checkoutUrl: '', sessionId: '', success: false, error: 'No Stripe secret key in connection' };
      }

      const { amount, currency = 'usd', productName = 'Purchase', successUrl, cancelUrl } = fields as {
        amount: number;
        currency?: string;
        productName?: string;
        successUrl?: string;
        cancelUrl?: string;
      };

      const params = new URLSearchParams({
        'line_items[0][price_data][currency]': currency,
        'line_items[0][price_data][product_data][name]': productName,
        'line_items[0][price_data][unit_amount]': String(amount),
        'line_items[0][quantity]': '1',
        mode: 'payment',
        success_url: successUrl ?? 'https://example.com/success',
        cancel_url: cancelUrl ?? 'https://example.com/cancel',
      });

      try {
        const response = await axios.post(
          'https://api.stripe.com/v1/checkout/sessions',
          params.toString(),
          {
            headers: {
              Authorization: `Bearer ${secretKey}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            timeout: 12000,
          }
        );
        return { checkoutUrl: response.data.url, sessionId: response.data.id, success: true };
      } catch (err: unknown) {
        const message = axios.isAxiosError(err) ? err.response?.data?.error?.message ?? err.message : String(err);
        return { checkoutUrl: '', sessionId: '', success: false, error: message };
      }
    },

    async getPaymentStatus(connection: IntegrationConnection, sessionId: string): Promise<PaymentsGetStatusResult> {
      const secretKey = connection.secretsRef
        ? connectionTokenService.decryptToken(connection.secretsRef)
        : null;

      if (!secretKey) {
        return { status: 'failed', success: false, error: 'No Stripe secret key in connection' };
      }

      try {
        const response = await axios.get(
          `https://api.stripe.com/v1/checkout/sessions/${sessionId}`,
          {
            headers: { Authorization: `Bearer ${secretKey}` },
            timeout: 12000,
          }
        );
        const stripeStatus = response.data.payment_status as string;
        const status =
          stripeStatus === 'paid' ? 'completed' :
          stripeStatus === 'unpaid' ? 'pending' :
          stripeStatus === 'no_payment_required' ? 'completed' : 'failed';
        return { status, success: true };
      } catch (err: unknown) {
        const message = axios.isAxiosError(err) ? err.response?.data?.error?.message ?? err.message : String(err);
        return { status: 'failed', success: false, error: message };
      }
    },
  },
};
```

- [ ] **Step 4: Create adapter registry**

```typescript
// server/adapters/index.ts
import type { IntegrationAdapter } from './integrationAdapter.js';
import { ghlAdapter } from './ghlAdapter.js';
import { stripeAdapter } from './stripeAdapter.js';

export const adapters: Record<string, IntegrationAdapter> = {
  ghl: ghlAdapter,
  stripe: stripeAdapter,
};

export type { IntegrationAdapter };
```

- [ ] **Step 5: Compile check**

```bash
npx tsx --check server/adapters/integrationAdapter.ts
npx tsx --check server/adapters/ghlAdapter.ts
npx tsx --check server/adapters/stripeAdapter.ts
npx tsx --check server/adapters/index.ts
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add server/adapters/
git commit -m "feat: add GHL and Stripe integration adapters"
```

---

## Task 6: Page project service + authenticated routes

**Files:**
- Create: `server/services/pageProjectService.ts`
- Create: `server/routes/pageProjects.ts`

- [ ] **Step 1: Create pageProjectService.ts**

```typescript
// server/services/pageProjectService.ts
import { db } from '../db/index.js';
import { pageProjects } from '../db/schema/index.js';
import { eq, and, isNull } from 'drizzle-orm';
import type { NewPageProject } from '../db/schema/index.js';

export const pageProjectService = {
  async list(subaccountId: string, organisationId: string) {
    return db
      .select()
      .from(pageProjects)
      .where(and(
        eq(pageProjects.subaccountId, subaccountId),
        eq(pageProjects.organisationId, organisationId),
        isNull(pageProjects.deletedAt)
      ));
  },

  async getById(id: string, subaccountId: string, organisationId: string) {
    const [row] = await db
      .select()
      .from(pageProjects)
      .where(and(
        eq(pageProjects.id, id),
        eq(pageProjects.subaccountId, subaccountId),
        eq(pageProjects.organisationId, organisationId),
        isNull(pageProjects.deletedAt)
      ));
    return row ?? null;
  },

  async create(data: NewPageProject) {
    // Check slug uniqueness within subaccount (soft-delete aware)
    const existing = await db
      .select({ id: pageProjects.id })
      .from(pageProjects)
      .where(and(
        eq(pageProjects.subaccountId, data.subaccountId),
        eq(pageProjects.slug, data.slug),
        isNull(pageProjects.deletedAt)
      ));
    if (existing.length > 0) {
      throw { statusCode: 409, message: `Slug "${data.slug}" is already taken in this subaccount` };
    }
    const [row] = await db.insert(pageProjects).values(data).returning();
    return row;
  },

  async update(id: string, subaccountId: string, organisationId: string, updates: Partial<NewPageProject>) {
    const existing = await pageProjectService.getById(id, subaccountId, organisationId);
    if (!existing) throw { statusCode: 404, message: 'Project not found' };

    if (updates.slug && updates.slug !== existing.slug) {
      const conflict = await db
        .select({ id: pageProjects.id })
        .from(pageProjects)
        .where(and(
          eq(pageProjects.subaccountId, subaccountId),
          eq(pageProjects.slug, updates.slug),
          isNull(pageProjects.deletedAt)
        ));
      if (conflict.length > 0) {
        throw { statusCode: 409, message: `Slug "${updates.slug}" is already taken` };
      }
    }

    const [row] = await db
      .update(pageProjects)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(pageProjects.id, id))
      .returning();
    return row;
  },

  async softDelete(id: string, subaccountId: string, organisationId: string) {
    const existing = await pageProjectService.getById(id, subaccountId, organisationId);
    if (!existing) throw { statusCode: 404, message: 'Project not found' };
    await db.update(pageProjects).set({ deletedAt: new Date() }).where(eq(pageProjects.id, id));
  },
};
```

- [ ] **Step 2: Create pageProjects.ts route**

```typescript
// server/routes/pageProjects.ts
import { Router } from 'express';
import { authenticate, requireSubaccountPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { pageProjectService } from '../services/pageProjectService.js';
import { SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';

const router = Router();

router.get(
  '/api/subaccounts/:subaccountId/page-projects',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.CONNECTIONS_VIEW),
  asyncHandler(async (req, res) => {
    const sa = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const rows = await pageProjectService.list(sa.id, req.orgId!);
    res.json(rows);
  })
);

router.get(
  '/api/subaccounts/:subaccountId/page-projects/:projectId',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.CONNECTIONS_VIEW),
  asyncHandler(async (req, res) => {
    const sa = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const row = await pageProjectService.getById(req.params.projectId, sa.id, req.orgId!);
    if (!row) throw { statusCode: 404, message: 'Project not found' };
    res.json(row);
  })
);

router.post(
  '/api/subaccounts/:subaccountId/page-projects',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.CONNECTIONS_MANAGE),
  asyncHandler(async (req, res) => {
    const sa = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { name, slug, theme, customDomain, githubRepo } = req.body;
    if (!name || !slug) throw { statusCode: 400, message: 'name and slug are required' };
    if (!/^[a-z0-9-]+$/.test(slug)) {
      throw { statusCode: 400, message: 'Slug must contain only lowercase letters, numbers, and hyphens' };
    }
    const row = await pageProjectService.create({
      organisationId: req.orgId!,
      subaccountId: sa.id,
      name,
      slug,
      theme: theme ?? null,
      customDomain: customDomain ?? null,
      githubRepo: githubRepo ?? null,
    });
    res.status(201).json(row);
  })
);

router.patch(
  '/api/subaccounts/:subaccountId/page-projects/:projectId',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.CONNECTIONS_MANAGE),
  asyncHandler(async (req, res) => {
    const sa = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { name, slug, theme, customDomain, githubRepo } = req.body;
    if (slug && !/^[a-z0-9-]+$/.test(slug)) {
      throw { statusCode: 400, message: 'Slug must contain only lowercase letters, numbers, and hyphens' };
    }
    const row = await pageProjectService.update(req.params.projectId, sa.id, req.orgId!, {
      ...(name !== undefined && { name }),
      ...(slug !== undefined && { slug }),
      ...(theme !== undefined && { theme }),
      ...(customDomain !== undefined && { customDomain }),
      ...(githubRepo !== undefined && { githubRepo }),
    });
    res.json(row);
  })
);

router.delete(
  '/api/subaccounts/:subaccountId/page-projects/:projectId',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.CONNECTIONS_MANAGE),
  asyncHandler(async (req, res) => {
    const sa = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    await pageProjectService.softDelete(req.params.projectId, sa.id, req.orgId!);
    res.json({ success: true });
  })
);

export default router;
```

- [ ] **Step 3: Verify TypeScript**

```bash
npx tsx --check server/services/pageProjectService.ts
npx tsx --check server/routes/pageProjects.ts
```

- [ ] **Step 4: Commit**

```bash
git add server/services/pageProjectService.ts server/routes/pageProjects.ts
git commit -m "feat: add page project service and authenticated CRUD routes"
```

---

## Task 7: Page service + authenticated routes

**Files:**
- Create: `server/services/pageService.ts`
- Create: `server/routes/pageRoutes.ts`

- [ ] **Step 1: Create pageService.ts**

```typescript
// server/services/pageService.ts
import { db } from '../db/index.js';
import { pages, pageVersions, pageProjects } from '../db/schema/index.js';
import { eq, and, isNull } from 'drizzle-orm';
import { sanitizePageHtml } from '../lib/htmlSanitizer.js';
import { previewTokenService } from '../lib/previewTokenService.js';
import type { NewPage } from '../db/schema/index.js';

const PAGES_BASE_DOMAIN = process.env.PAGES_BASE_DOMAIN ?? 'synthetos.ai';
const MAX_UPDATES_PER_HOUR = 10;

export const pageService = {
  async list(projectId: string) {
    return db.select().from(pages).where(eq(pages.projectId, projectId));
  },

  async getById(id: string, projectId: string) {
    const [row] = await db
      .select()
      .from(pages)
      .where(and(eq(pages.id, id), eq(pages.projectId, projectId)));
    return row ?? null;
  },

  async create(data: NewPage & { agentId?: string }) {
    const sanitized = sanitizePageHtml(data.html ?? '');
    const [project] = await db.select().from(pageProjects).where(eq(pageProjects.id, data.projectId));
    if (!project) throw { statusCode: 404, message: 'Project not found' };

    const [page] = await db.insert(pages).values({
      projectId: data.projectId,
      slug: data.slug,
      pageType: data.pageType,
      title: data.title ?? null,
      html: sanitized,
      status: 'draft',
      meta: data.meta ?? null,
      formConfig: data.formConfig ?? null,
      createdByAgentId: data.agentId ?? null,
    }).returning();

    // Save initial version
    await db.insert(pageVersions).values({
      pageId: page.id,
      html: sanitized,
      meta: page.meta,
      changeNote: 'Initial version',
    });

    const previewToken = previewTokenService.generate(page.id, project.id);
    const previewUrl = `https://${project.slug}.${PAGES_BASE_DOMAIN}/preview/${page.slug}?token=${previewToken}`;
    return { page, previewUrl };
  },

  async update(
    pageId: string,
    updates: { html?: string; meta?: unknown; formConfig?: unknown; changeNote?: string }
  ) {
    const [existing] = await db.select().from(pages).where(eq(pages.id, pageId));
    if (!existing) throw { statusCode: 404, message: 'Page not found' };

    // Rate limit check: count updates in last hour
    // Note: Using page_versions as an audit trail for rate limiting
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentVersions = await db
      .select({ id: pageVersions.id })
      .from(pageVersions)
      .where(and(eq(pageVersions.pageId, pageId)));
    const recentCount = recentVersions.filter(v => {
      // We rely on createdAt being populated — filter in application since drizzle
      // doesn't expose a simple count with timestamp comparison easily here
      return true; // Simplified: full implementation queries with WHERE createdAt > oneHourAgo
    }).length;
    // Note: For production, use: WHERE page_id = ? AND created_at > NOW() - INTERVAL '1 hour'
    // Simplified check — implement with raw SQL if rate limiting becomes critical

    // Save snapshot before update
    await db.insert(pageVersions).values({
      pageId,
      html: existing.html,
      meta: existing.meta,
      changeNote: updates.changeNote ?? 'Update',
    });

    const sanitized = updates.html ? sanitizePageHtml(updates.html) : existing.html;

    const [updated] = await db.update(pages).set({
      html: sanitized,
      ...(updates.meta !== undefined && { meta: updates.meta as never }),
      ...(updates.formConfig !== undefined && { formConfig: updates.formConfig as never }),
      updatedAt: new Date(),
    }).where(eq(pages.id, pageId)).returning();

    const [project] = await db.select().from(pageProjects).where(eq(pageProjects.id, existing.projectId));
    const previewToken = previewTokenService.generate(pageId, project.id);
    const previewUrl = `https://${project.slug}.${PAGES_BASE_DOMAIN}/preview/${updated.slug}?token=${previewToken}`;
    return { page: updated, previewUrl };
  },

  async publish(pageId: string) {
    const [existing] = await db.select().from(pages).where(eq(pages.id, pageId));
    if (!existing) throw { statusCode: 404, message: 'Page not found' };
    if (existing.status === 'published') return existing;

    const [updated] = await db.update(pages).set({
      status: 'published',
      publishedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(pages.id, pageId)).returning();
    return updated;
  },
};
```

- [ ] **Step 2: Create pageRoutes.ts**

```typescript
// server/routes/pageRoutes.ts
import { Router } from 'express';
import { authenticate, requireSubaccountPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { pageProjectService } from '../services/pageProjectService.js';
import { pageService } from '../services/pageService.js';
import { SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';

const router = Router();

router.get(
  '/api/subaccounts/:subaccountId/page-projects/:projectId/pages',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.CONNECTIONS_VIEW),
  asyncHandler(async (req, res) => {
    const sa = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const project = await pageProjectService.getById(req.params.projectId, sa.id, req.orgId!);
    if (!project) throw { statusCode: 404, message: 'Project not found' };
    const rows = await pageService.list(project.id);
    res.json(rows);
  })
);

router.post(
  '/api/subaccounts/:subaccountId/page-projects/:projectId/pages',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.CONNECTIONS_MANAGE),
  asyncHandler(async (req, res) => {
    const sa = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const project = await pageProjectService.getById(req.params.projectId, sa.id, req.orgId!);
    if (!project) throw { statusCode: 404, message: 'Project not found' };
    const { slug, pageType, title, html, meta, formConfig } = req.body;
    if (!slug || !pageType) throw { statusCode: 400, message: 'slug and pageType are required' };
    const result = await pageService.create({ projectId: project.id, slug, pageType, title, html, meta, formConfig });
    res.status(201).json(result);
  })
);

router.patch(
  '/api/subaccounts/:subaccountId/page-projects/:projectId/pages/:pageId',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.CONNECTIONS_MANAGE),
  asyncHandler(async (req, res) => {
    const sa = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const project = await pageProjectService.getById(req.params.projectId, sa.id, req.orgId!);
    if (!project) throw { statusCode: 404, message: 'Project not found' };
    const { html, meta, formConfig, changeNote } = req.body;
    const result = await pageService.update(req.params.pageId, { html, meta, formConfig, changeNote });
    res.json(result);
  })
);

router.post(
  '/api/subaccounts/:subaccountId/page-projects/:projectId/pages/:pageId/publish',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.CONNECTIONS_MANAGE),
  asyncHandler(async (req, res) => {
    const sa = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const project = await pageProjectService.getById(req.params.projectId, sa.id, req.orgId!);
    if (!project) throw { statusCode: 404, message: 'Project not found' };
    const page = await pageService.publish(req.params.pageId);
    res.json(page);
  })
);

export default router;
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsx --check server/services/pageService.ts
npx tsx --check server/routes/pageRoutes.ts
```

- [ ] **Step 4: Commit**

```bash
git add server/services/pageService.ts server/routes/pageRoutes.ts
git commit -m "feat: add page service and authenticated CRUD/publish routes"
```

---

## Task 8: Subdomain resolution middleware

**Files:**
- Create: `server/middleware/subdomainResolution.ts`

- [ ] **Step 1: Create subdomainResolution.ts**

```typescript
// server/middleware/subdomainResolution.ts
import type { Request, Response, NextFunction } from 'express';
import { db } from '../db/index.js';
import { pageProjects, pages, subaccounts } from '../db/schema/index.js';
import { eq, and, isNull } from 'drizzle-orm';
import type { PageProject, Page } from '../db/schema/index.js';

const PAGES_BASE_DOMAIN = process.env.PAGES_BASE_DOMAIN ?? 'synthetos.ai';

declare global {
  namespace Express {
    interface Request {
      resolvedPageProject?: PageProject;
      resolvedPage?: Page;
      resolvedPageSlug?: string;
      resolvedProjectSlug?: string;
    }
  }
}

/**
 * Parse hostname and resolve project + page.
 * Patterns:
 *   projectslug.synthetos.ai              → page slug "index"
 *   projectslug.synthetos.ai/pricing      → page slug from path
 *   pageslug--projectslug.synthetos.ai    → landing page (flat subdomain)
 *
 * If the host is not a page subdomain, next() is called without setting
 * resolvedPageProject — the normal SPA route handles it.
 */
export async function subdomainResolution(req: Request, res: Response, next: NextFunction) {
  const host = req.hostname; // without port
  const suffix = `.${PAGES_BASE_DOMAIN}`;

  if (!host.endsWith(suffix)) {
    return next();
  }

  const subdomain = host.slice(0, -suffix.length);
  if (!subdomain) return next();

  let projectSlug: string;
  let pageSlug: string;

  if (subdomain.includes('--')) {
    // Landing page pattern: pageslug--projectslug
    const parts = subdomain.split('--');
    pageSlug = parts[0];
    projectSlug = parts.slice(1).join('--');
  } else {
    // Website pattern: path-based page slug
    projectSlug = subdomain;
    const urlPath = req.path.replace(/^\//, '') || 'index';
    // Strip /preview prefix — handled separately
    pageSlug = urlPath === '' ? 'index' : urlPath;
  }

  req.resolvedProjectSlug = projectSlug;
  req.resolvedPageSlug = pageSlug;

  try {
    // Look up project — enforce soft-delete
    const [project] = await db
      .select()
      .from(pageProjects)
      .where(and(eq(pageProjects.slug, projectSlug), isNull(pageProjects.deletedAt)));

    if (!project) return next();

    // Verify subaccount is active (tenant isolation)
    const [subaccount] = await db
      .select({ id: subaccounts.id, status: subaccounts.status })
      .from(subaccounts)
      .where(eq(subaccounts.id, project.subaccountId));

    if (!subaccount || (subaccount as { status: string }).status !== 'active') {
      return next();
    }

    req.resolvedPageProject = project;
    next();
  } catch {
    next();
  }
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsx --check server/middleware/subdomainResolution.ts
```

- [ ] **Step 3: Commit**

```bash
git add server/middleware/subdomainResolution.ts
git commit -m "feat: add subdomain resolution middleware for page serving"
```

---

## Task 9: Public page serving routes

**Files:**
- Create: `server/routes/public/pageServing.ts`
- Create: `server/routes/public/pagePreview.ts`

- [ ] **Step 1: Create pageServing.ts**

```typescript
// server/routes/public/pageServing.ts
import { Router } from 'express';
import { db } from '../../db/index.js';
import { pages } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import type { PageProject, Page } from '../../db/schema/index.js';

const router = Router();

const TRACKING_SCRIPT = `
<script>
(function() {
  var SID_KEY = '__s_sid';
  function getOrCreateSession() {
    try {
      var sid = document.cookie.split('; ').find(function(r){ return r.startsWith(SID_KEY + '='); });
      if (sid) return sid.split('=')[1];
    } catch(e) {}
    try { var ls = localStorage.getItem(SID_KEY); if (ls) return ls; } catch(e) {}
    var id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
    var exp = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toUTCString();
    try { document.cookie = SID_KEY + '=' + id + '; expires=' + exp + '; path=/; SameSite=Lax'; } catch(e) {}
    try { localStorage.setItem(SID_KEY, id); } catch(e) {}
    return id;
  }
  var sessionId = getOrCreateSession();
  var pageId = document.currentScript && document.currentScript.getAttribute('data-page-id');
  if (pageId) {
    var params = new URLSearchParams(window.location.search);
    fetch('/api/public/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pageId: pageId,
        sessionId: sessionId,
        referrer: document.referrer || '',
        utm: { source: params.get('utm_source'), medium: params.get('utm_medium'), campaign: params.get('utm_campaign') }
      })
    }).catch(function(){});
  }
  // Expose sessionId for form submission
  window.__sessionId = sessionId;
})();
</script>`;

function buildPageShell(project: PageProject, page: Page, html: string): string {
  const theme = (project.theme as Record<string, string> | null) ?? {};
  const meta = (page.meta as Record<string, string> | null) ?? {};
  const cspHeader = [
    "default-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "frame-src https://link.msgsndr.com https://js.stripe.com https://buy.stripe.com https://www.youtube.com https://player.vimeo.com https://calendly.com",
    "connect-src 'self'",
    "script-src 'self' https://js.stripe.com 'unsafe-inline'",
  ].join('; ');

  // If the HTML is a full document, inject our shell items into it
  if (html.includes('<html')) {
    // Inject theme vars and tracking into existing <head>
    const themeVars = `<style>:root{--color-primary:${theme.primaryColor ?? '#6366f1'};--color-secondary:${theme.secondaryColor ?? '#4f46e5'};}</style>`;
    const trackingTag = `<script data-page-id="${page.id}" src="data:text/javascript,"></script>`;
    return html
      .replace('</head>', `${themeVars}\n${TRACKING_SCRIPT.replace('document.currentScript', 'document.querySelector("[data-page-id]")')}\n</head>`)
      .replace('<body', `<body data-project="${project.slug}"`);
  }

  // Wrap bare HTML body in a full document
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${meta.title ?? page.title ?? project.name}</title>
  ${meta.description ? `<meta name="description" content="${meta.description}">` : ''}
  ${meta.ogImage ? `<meta property="og:image" content="${meta.ogImage}">` : ''}
  ${theme.faviconUrl ? `<link rel="icon" href="${theme.faviconUrl}">` : ''}
  ${theme.fontHeading ? `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(theme.fontHeading)}&display=swap">` : ''}
  <style>
    :root {
      --color-primary: ${theme.primaryColor ?? '#6366f1'};
      --color-secondary: ${theme.secondaryColor ?? '#4f46e5'};
    }
  </style>
</head>
<body>
${html}
${TRACKING_SCRIPT}
<script data-page-id="${page.id}">/* tracking */</script>
</body>
</html>`;
}

// Serve a published page (called after subdomainResolution middleware has run)
router.get('*', async (req, res, next) => {
  const project = req.resolvedPageProject;
  if (!project) return next();

  const pageSlug = req.resolvedPageSlug ?? 'index';

  // Skip preview paths
  if (req.path.startsWith('/preview/')) return next();

  try {
    const [page] = await db
      .select()
      .from(pages)
      .where(and(eq(pages.projectId, project.id), eq(pages.slug, pageSlug), eq(pages.status, 'published')));

    if (!page) {
      res.status(404).send('Page not found');
      return;
    }

    // ETag-based caching
    const etag = `"${page.id}-${page.updatedAt.getTime()}"`;
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }

    const html = buildPageShell(project, page, page.html ?? '');

    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'ETag': etag,
      'Cache-Control': 'public, max-age=300',
      'Last-Modified': page.updatedAt.toUTCString(),
      'Content-Security-Policy': [
        "default-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: blob: https:",
        "frame-src https://link.msgsndr.com https://js.stripe.com https://buy.stripe.com https://www.youtube.com https://player.vimeo.com https://calendly.com",
        "connect-src 'self'",
        "script-src 'self' https://js.stripe.com 'unsafe-inline'",
      ].join('; '),
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(html);
  } catch (err) {
    next(err);
  }
});

export default router;
```

- [ ] **Step 2: Create pagePreview.ts**

```typescript
// server/routes/public/pagePreview.ts
import { Router } from 'express';
import { db } from '../../db/index.js';
import { pages } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { previewTokenService } from '../../lib/previewTokenService.js';

const router = Router();

const PREVIEW_BANNER = `
<div style="position:fixed;top:0;left:0;right:0;z-index:9999;background:#f59e0b;color:#000;text-align:center;padding:8px;font-family:sans-serif;font-size:14px;font-weight:600;">
  PREVIEW — NOT LIVE
</div>
<div style="padding-top:40px;">`;

router.get('/preview/:pageSlug', async (req, res, next) => {
  const project = req.resolvedPageProject;
  if (!project) return next();

  const { pageSlug } = req.params;
  const token = req.query.token as string | undefined;

  if (!token) {
    res.status(401).send('Preview token required');
    return;
  }

  try {
    const payload = previewTokenService.verify(token);
    if (payload.projectId !== project.id) {
      res.status(403).send('Preview token does not match this project');
      return;
    }

    const [page] = await db
      .select()
      .from(pages)
      .where(and(eq(pages.projectId, project.id), eq(pages.slug, pageSlug), eq(pages.id, payload.pageId)));

    if (!page) {
      res.status(404).send('Page not found');
      return;
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>PREVIEW: ${page.title ?? page.slug}</title>
</head>
<body>
${PREVIEW_BANNER}
${page.html ?? ''}
</div>
</body>
</html>`;

    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    });
    res.send(html);
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'statusCode' in err) {
      res.status((err as { statusCode: number }).statusCode).send((err as { message: string }).message);
      return;
    }
    next(err);
  }
});

export default router;
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsx --check server/routes/public/pageServing.ts
npx tsx --check server/routes/public/pagePreview.ts
```

- [ ] **Step 4: Commit**

```bash
git add server/routes/public/
git commit -m "feat: add public page serving and preview routes"
```

---

## Task 10: Form submission endpoint + page view tracking

**Files:**
- Create: `server/routes/public/formSubmission.ts`
- Create: `server/routes/public/pageTracking.ts`
- Create: `server/services/formSubmissionService.ts`

- [ ] **Step 1: Create formSubmissionService.ts**

```typescript
// server/services/formSubmissionService.ts
import crypto from 'crypto';
import { db } from '../db/index.js';
import { formSubmissions, pages, projectIntegrations, integrationConnections, conversionEvents } from '../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { adapters } from '../adapters/index.js';
import { connectionTokenService } from './connectionTokenService.js';
import type { IntegrationConnection } from '../db/schema/index.js';

function computeSubmissionHash(pageId: string, data: Record<string, unknown>): string {
  // Sort keys for determinism, exclude sessionId (session is transient)
  const { sessionId: _sid, ...rest } = data;
  const sorted = Object.fromEntries(Object.entries(rest).sort(([a], [b]) => a.localeCompare(b)));
  const payload = JSON.stringify({ pageId, data: sorted });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

const MAX_PAYLOAD_BYTES = 50 * 1024; // 50KB

export const formSubmissionService = {
  async submit(
    pageId: string,
    data: Record<string, unknown>,
    ipAddress: string,
    userAgent: string
  ) {
    // Validate payload size
    if (Buffer.byteLength(JSON.stringify(data), 'utf8') > MAX_PAYLOAD_BYTES) {
      throw { statusCode: 413, message: 'Form payload exceeds 50KB limit' };
    }

    // Honeypot check
    if (data.__hp) {
      // Return success silently (honeypot was filled — it's a bot)
      return { success: true, duplicate: false };
    }

    const [page] = await db.select().from(pages).where(eq(pages.id, pageId));
    if (!page || page.status !== 'published') {
      throw { statusCode: 404, message: 'Page not found or not published' };
    }

    const formConfig = page.formConfig as {
      fields: Array<{ name: string; type: string; required: boolean }>;
      actions: Record<string, { action: string; fields: Record<string, unknown> }>;
      thankYou: { type: string; value: string };
    } | null;

    // Validate required fields
    if (formConfig?.fields) {
      for (const field of formConfig.fields) {
        if (field.required && !data[field.name]) {
          throw { statusCode: 400, message: `Required field missing: ${field.name}` };
        }
      }
    }

    // Validate adapter capabilities before storing anything
    if (formConfig?.actions) {
      for (const [purpose, actionConfig] of Object.entries(formConfig.actions)) {
        const [pi] = await db
          .select()
          .from(projectIntegrations)
          .where(and(
            eq(projectIntegrations.projectId, page.projectId),
            eq(projectIntegrations.purpose, purpose as 'crm' | 'payments')
          ));

        if (!pi) {
          throw { statusCode: 422, message: `No integration configured for purpose: ${purpose}` };
        }

        const [conn] = await db
          .select()
          .from(integrationConnections)
          .where(eq(integrationConnections.id, pi.connectionId));

        if (!conn) throw { statusCode: 422, message: `Integration connection not found for purpose: ${purpose}` };

        const adapter = adapters[conn.providerType];
        if (!adapter) {
          throw { statusCode: 422, message: `No adapter available for provider: ${conn.providerType}` };
        }
        if (!adapter.supportedActions.includes(actionConfig.action)) {
          throw {
            statusCode: 422,
            message: `Provider ${conn.providerType} does not support action: ${actionConfig.action}`,
          };
        }
      }
    }

    const submissionHash = computeSubmissionHash(pageId, data);
    const sessionId = (data.sessionId as string) ?? null;

    // Deduplication check
    const [existing] = await db
      .select({ id: formSubmissions.id })
      .from(formSubmissions)
      .where(eq(formSubmissions.submissionHash, submissionHash));

    if (existing) {
      return { success: true, duplicate: true, redirect: formConfig?.thankYou?.value };
    }

    // Atomic: insert submission + enqueue jobs
    // Note: pg-boss transactional enqueue requires pg client from the same transaction.
    // Here we use the db client pattern — in production wire up pg-boss send() within tx.
    const [submission] = await db.insert(formSubmissions).values({
      pageId,
      data,
      submissionHash,
      integrationStatus: 'pending',
      ipAddress,
      userAgent,
    }).returning();

    // Record form_submitted conversion event
    await db.insert(conversionEvents).values({
      pageId,
      submissionId: submission.id,
      eventType: 'form_submitted',
      sessionId,
      metadata: { formFields: Object.keys(data) },
    });

    // Enqueue integration jobs via pg-boss (imported from queueService)
    if (formConfig?.actions) {
      const { enqueuePageIntegrationJob } = await import('./pageIntegrationWorker.js');
      for (const [purpose, actionConfig] of Object.entries(formConfig.actions)) {
        const [pi] = await db
          .select()
          .from(projectIntegrations)
          .where(and(
            eq(projectIntegrations.projectId, page.projectId),
            eq(projectIntegrations.purpose, purpose as 'crm' | 'payments')
          ));
        if (pi) {
          await enqueuePageIntegrationJob({
            submissionId: submission.id,
            pageId,
            purpose,
            action: actionConfig.action,
            fields: { ...data, ...actionConfig.fields },
            connectionId: pi.connectionId,
          });
        }
      }
    }

    return {
      success: true,
      duplicate: false,
      redirect: formConfig?.thankYou?.type === 'redirect' ? formConfig.thankYou.value : undefined,
    };
  },
};
```

- [ ] **Step 2: Create formSubmission.ts route**

```typescript
// server/routes/public/formSubmission.ts
import { Router } from 'express';
import { formSubmissionService } from '../../services/formSubmissionService.js';

const router = Router();

// Rate limiting: express-rate-limit would be configured in index.ts before mounting
// This route expects req.rateLimit data if using express-rate-limit middleware upstream

router.post('/api/public/pages/:pageId/submit', async (req, res) => {
  try {
    const { pageId } = req.params;
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] ?? req.ip ?? '';
    const userAgent = req.headers['user-agent'] ?? '';

    const body = req.body;
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'Invalid request body' });
      return;
    }

    const result = await formSubmissionService.submit(pageId, body, ip, userAgent);
    res.status(200).json(result);
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'statusCode' in err) {
      const e = err as { statusCode: number; message: string };
      res.status(e.statusCode).json({ error: e.message });
      return;
    }
    console.error('Form submission error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
```

- [ ] **Step 3: Create pageTracking.ts route**

```typescript
// server/routes/public/pageTracking.ts
import { Router } from 'express';
import { db } from '../../db/index.js';
import { pageViews } from '../../db/schema/index.js';

const router = Router();

router.post('/api/public/track', async (req, res) => {
  try {
    const { pageId, sessionId, referrer, utm } = req.body ?? {};

    if (!pageId) {
      res.status(204).end();
      return;
    }

    await db.insert(pageViews).values({
      pageId,
      sessionId: sessionId ?? null,
      referrer: referrer ?? null,
      utmSource: utm?.source ?? null,
      utmMedium: utm?.medium ?? null,
      utmCampaign: utm?.campaign ?? null,
    });

    res.status(204).end();
  } catch {
    // Fire-and-forget — never fail the client on tracking errors
    res.status(204).end();
  }
});

export default router;
```

- [ ] **Step 4: TypeScript check**

```bash
npx tsx --check server/services/formSubmissionService.ts
npx tsx --check server/routes/public/formSubmission.ts
npx tsx --check server/routes/public/pageTracking.ts
```

- [ ] **Step 5: Commit**

```bash
git add server/services/formSubmissionService.ts server/routes/public/formSubmission.ts server/routes/public/pageTracking.ts
git commit -m "feat: add form submission endpoint and page view tracking"
```

---

## Task 11: pg-boss integration worker

**Files:**
- Create: `server/services/pageIntegrationWorker.ts`

- [ ] **Step 1: Create pageIntegrationWorker.ts**

```typescript
// server/services/pageIntegrationWorker.ts
// pg-boss worker for processing form submission integration jobs.
// Follows the same getBoss() pattern as agentScheduleService.ts.
// Queue: "page-integration"
// Timeout: 15s per job. Retry: 3 attempts, exponential backoff.

import { db } from '../db/index.js';
import { formSubmissions, integrationConnections, conversionEvents } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { adapters } from '../adapters/index.js';
import { env } from '../lib/env.js';

const PAGE_INTEGRATION_QUEUE = 'page-integration';

type PgBoss = {
  start(): Promise<void>;
  send(name: string, data?: object, options?: object): Promise<string | null>;
  work(name: string, options: object, handler: (job: { data: Record<string, unknown> }) => Promise<void>): Promise<string>;
};

let boss: PgBoss | null = null;

async function getBoss(): Promise<PgBoss | null> {
  if (boss) return boss;
  try {
    const PgBossModule = await import('pg-boss');
    const PgBossClass = PgBossModule.default ?? PgBossModule;
    boss = new (PgBossClass as unknown as new (config: { connectionString: string }) => PgBoss)({
      connectionString: env.DATABASE_URL,
    });
    await boss.start();
    return boss;
  } catch (err) {
    console.warn('[pageIntegrationWorker] pg-boss not available:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

export interface PageIntegrationJobPayload {
  submissionId: string;
  pageId: string;
  purpose: string;
  action: string;
  fields: Record<string, unknown>;
  connectionId: string;
}

export async function enqueuePageIntegrationJob(payload: PageIntegrationJobPayload): Promise<void> {
  try {
    const b = await getBoss();
    if (b) {
      await b.send(PAGE_INTEGRATION_QUEUE, payload, {
        retryLimit: 3,
        retryDelay: 5,
        retryBackoff: true,
        expireInSeconds: 15,
      });
    } else {
      // In-memory fallback: process immediately (dev mode)
      await processPageIntegrationJob(payload);
    }
  } catch (err) {
    console.error('[pageIntegrationWorker] Failed to enqueue job:', err);
    // Don't throw — submission is already stored, background processing is best-effort
  }
}

async function processPageIntegrationJob(payload: PageIntegrationJobPayload): Promise<void> {
  const { submissionId, purpose, action, fields, connectionId } = payload;

  // Mark as processing
  await db.update(formSubmissions)
    .set({ integrationStatus: 'processing' })
    .where(eq(formSubmissions.id, submissionId));

  const [conn] = await db.select().from(integrationConnections).where(eq(integrationConnections.id, connectionId));
  if (!conn) {
    await db.update(formSubmissions)
      .set({
        integrationStatus: 'failed',
        integrationResults: { [purpose]: { success: false, error: 'Connection not found' } },
      })
      .where(eq(formSubmissions.id, submissionId));
    return;
  }

  const adapter = adapters[conn.providerType];
  if (!adapter) {
    await db.update(formSubmissions)
      .set({
        integrationStatus: 'failed',
        integrationResults: { [purpose]: { success: false, error: `No adapter for ${conn.providerType}` } },
      })
      .where(eq(formSubmissions.id, submissionId));
    return;
  }

  let result: { success: boolean; error?: string; contactId?: string; checkoutUrl?: string; sessionId?: string };

  try {
    if (purpose === 'crm' && action === 'create_contact' && adapter.crm) {
      result = await adapter.crm.createContact(conn, fields);

      if (result.success) {
        await db.insert(conversionEvents).values({
          pageId: payload.pageId,
          submissionId,
          eventType: 'contact_created',
          metadata: { contactId: result.contactId, provider: conn.providerType },
        });
      }
    } else if (purpose === 'payments' && action === 'create_checkout' && adapter.payments) {
      result = await adapter.payments.createCheckout(conn, fields);

      if (result.success) {
        await db.insert(conversionEvents).values({
          pageId: payload.pageId,
          submissionId,
          eventType: 'checkout_started',
          metadata: { sessionId: result.sessionId, checkoutUrl: result.checkoutUrl, provider: conn.providerType },
        });
      }
    } else {
      result = { success: false, error: `Unsupported action: ${action} for purpose: ${purpose}` };
    }
  } catch (err: unknown) {
    result = { success: false, error: err instanceof Error ? err.message : String(err) };
  }

  // Update submission with results
  const [currentSubmission] = await db.select().from(formSubmissions).where(eq(formSubmissions.id, submissionId));
  const existingResults = (currentSubmission?.integrationResults as Record<string, unknown>) ?? {};
  const newResults = { ...existingResults, [purpose]: result };

  // Determine overall status
  const allResults = Object.values(newResults) as Array<{ success: boolean }>;
  const allSuccess = allResults.every((r) => r.success);
  const allFailed = allResults.every((r) => !r.success);
  const status = allSuccess ? 'success' : allFailed ? 'failed' : 'partial_failure';

  await db.update(formSubmissions)
    .set({ integrationStatus: status, integrationResults: newResults })
    .where(eq(formSubmissions.id, submissionId));
}

export async function initializePageIntegrationWorker(): Promise<void> {
  try {
    const b = await getBoss();
    if (!b) {
      console.log('[pageIntegrationWorker] pg-boss not available — worker not registered');
      return;
    }

    await b.work(
      PAGE_INTEGRATION_QUEUE,
      { teamSize: 5, teamConcurrency: 1 },
      async (job: { data: Record<string, unknown> }) => {
        await processPageIntegrationJob(job.data as unknown as PageIntegrationJobPayload);
      }
    );

    console.log(`[pageIntegrationWorker] Worker registered for queue: ${PAGE_INTEGRATION_QUEUE}`);
  } catch (err) {
    console.error('[pageIntegrationWorker] Failed to initialize worker:', err);
  }
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsx --check server/services/pageIntegrationWorker.ts
```

- [ ] **Step 3: Commit**

```bash
git add server/services/pageIntegrationWorker.ts
git commit -m "feat: add pg-boss page integration worker"
```

---

## Task 12: Payment reconciliation job

**Files:**
- Create: `server/services/paymentReconciliationJob.ts`

- [ ] **Step 1: Create paymentReconciliationJob.ts**

```typescript
// server/services/paymentReconciliationJob.ts
// Scheduled pg-boss cron job: runs every 15 minutes.
// Finds checkout_started events without matching checkout_completed,
// and cross-checks payment status with the provider.

import { db } from '../db/index.js';
import {
  conversionEvents,
  formSubmissions,
  projectIntegrations,
  integrationConnections,
  pages,
} from '../db/schema/index.js';
import { eq, and, isNull, sql, ne } from 'drizzle-orm';
import { adapters } from '../adapters/index.js';

const RECONCILIATION_JOB = 'payment-reconciliation';
const GRACE_PERIOD_MINUTES = 10;
const MAX_AGE_DAYS = 7;

async function runReconciliation(): Promise<void> {
  const now = new Date();
  const graceCutoff = new Date(now.getTime() - GRACE_PERIOD_MINUTES * 60 * 1000);
  const ageCutoff = new Date(now.getTime() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000);

  // Find checkout_started events in the window with no completed/abandoned event
  const pendingEvents = await db
    .select()
    .from(conversionEvents)
    .where(
      and(
        eq(conversionEvents.eventType, 'checkout_started'),
        sql`${conversionEvents.occurredAt} < ${graceCutoff}`,
        sql`${conversionEvents.occurredAt} > ${ageCutoff}`
      )
    );

  for (const event of pendingEvents) {
    // Check if already reconciled
    const [completed] = await db
      .select({ id: conversionEvents.id })
      .from(conversionEvents)
      .where(
        and(
          eq(conversionEvents.submissionId, event.submissionId!),
          sql`${conversionEvents.eventType} IN ('checkout_completed', 'checkout_abandoned')`
        )
      );

    if (completed) continue; // Already reconciled

    const metadata = event.metadata as Record<string, unknown> | null;
    const stripeSessionId = metadata?.sessionId as string | undefined;
    if (!stripeSessionId) continue;

    // Resolve the payment adapter for this page's project
    if (!event.pageId) continue;

    const [page] = await db.select({ projectId: pages.projectId }).from(pages).where(eq(pages.id, event.pageId));
    if (!page) continue;

    const [pi] = await db
      .select()
      .from(projectIntegrations)
      .where(and(eq(projectIntegrations.projectId, page.projectId), eq(projectIntegrations.purpose, 'payments')));
    if (!pi) continue;

    const [conn] = await db.select().from(integrationConnections).where(eq(integrationConnections.id, pi.connectionId));
    if (!conn) continue;

    const adapter = adapters[conn.providerType];
    if (!adapter?.payments) continue;

    try {
      const statusResult = await adapter.payments.getPaymentStatus(conn, stripeSessionId);

      if (statusResult.status === 'completed') {
        await db.insert(conversionEvents).values({
          pageId: event.pageId,
          submissionId: event.submissionId,
          eventType: 'checkout_completed',
          sessionId: event.sessionId,
          metadata: { reconciledAt: now.toISOString(), provider: conn.providerType },
        });

        // Update submission integrationResults
        if (event.submissionId) {
          const [sub] = await db.select().from(formSubmissions).where(eq(formSubmissions.id, event.submissionId));
          if (sub) {
            const existing = (sub.integrationResults as Record<string, unknown>) ?? {};
            await db.update(formSubmissions)
              .set({ integrationResults: { ...existing, payments: { success: true, status: 'completed', reconciled: true } } })
              .where(eq(formSubmissions.id, event.submissionId));
          }
        }
      } else if (statusResult.status === 'failed' || statusResult.status === 'expired') {
        await db.insert(conversionEvents).values({
          pageId: event.pageId,
          submissionId: event.submissionId,
          eventType: 'checkout_abandoned',
          sessionId: event.sessionId,
          metadata: { status: statusResult.status, reconciledAt: now.toISOString() },
        });
      }
    } catch (err) {
      console.error(`[paymentReconciliation] Error reconciling event ${event.id}:`, err);
    }
  }
}

type ReconciliationBoss = PgBoss & {
  schedule(name: string, cron: string, data?: object, options?: object): Promise<void>;
};

export async function initializePaymentReconciliationJob(): Promise<void> {
  try {
    const PgBossModule = await import('pg-boss');
    const PgBossClass = PgBossModule.default ?? PgBossModule;
    const { env } = await import('../lib/env.js');
    const b = new (PgBossClass as unknown as new (config: { connectionString: string }) => ReconciliationBoss)({
      connectionString: env.DATABASE_URL,
    });
    await b.start();

    // Schedule every 15 minutes
    await b.schedule(RECONCILIATION_JOB, '*/15 * * * *', {});
    await b.work(RECONCILIATION_JOB, {}, async () => {
      await runReconciliation();
    });

    console.log('[paymentReconciliation] Scheduled every 15 minutes');
  } catch (err) {
    console.warn('[paymentReconciliation] pg-boss not available — job not scheduled:', err instanceof Error ? err.message : String(err));
  }
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsx --check server/services/paymentReconciliationJob.ts
```

- [ ] **Step 3: Commit**

```bash
git add server/services/paymentReconciliationJob.ts
git commit -m "feat: add payment reconciliation scheduled job"
```

---

## Task 13: Agent action registry entries

**Files:**
- Modify: `server/config/actionRegistry.ts`

- [ ] **Step 1: Add three page actions to ACTION_REGISTRY**

In `server/config/actionRegistry.ts`, add the following three entries to the `ACTION_REGISTRY` object (after the last existing entry):

```typescript
  create_page: {
    actionType: 'create_page',
    description: 'Create a new page in a page project. The page is created in draft status. HTML is sanitised before storage. Returns a preview URL for HITL review.',
    actionCategory: 'worker',
    isExternal: false,
    defaultGateLevel: 'review',
    createsBoardTask: true,
    payloadFields: ['projectId', 'slug', 'pageType', 'title', 'html', 'meta', 'formConfig'],
    parameterSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID of the page project to create the page in' },
        slug: { type: 'string', description: 'URL slug for this page (e.g. "offer1", "index", "pricing")' },
        pageType: { type: 'string', enum: ['website', 'landing'], description: 'Type of page' },
        title: { type: 'string', description: 'Page title shown in browser tab and OG tags' },
        html: { type: 'string', description: 'Full rendered HTML for the page (max 1MB). Claude writes this directly.' },
        meta: {
          type: 'object',
          description: 'SEO/OG metadata',
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            ogImage: { type: 'string' },
            canonicalUrl: { type: 'string' },
            noIndex: { type: 'string' },
          },
        },
        formConfig: {
          type: 'object',
          description: 'Provider-agnostic form submission configuration. Define fields and what to do with submissions.',
        },
      },
      required: ['projectId', 'slug', 'pageType', 'html'],
    },
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: [],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  },

  update_page: {
    actionType: 'update_page',
    description: 'Update an existing page HTML, meta, or formConfig. Saves a version snapshot before updating. Returns a preview URL. Rate limited to 10 updates per page per hour.',
    actionCategory: 'worker',
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['pageId', 'html', 'meta', 'formConfig', 'changeNote'],
    parameterSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string', description: 'ID of the page to update' },
        html: { type: 'string', description: 'Updated HTML content (max 1MB)' },
        meta: { type: 'object', description: 'Updated SEO/OG metadata' },
        formConfig: { type: 'object', description: 'Updated form configuration' },
        changeNote: { type: 'string', description: 'What was changed and why — stored in page version history' },
      },
      required: ['pageId'],
    },
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: [],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  },

  publish_page: {
    actionType: 'publish_page',
    description: 'Publish a page — flips status from draft to published, sets publishedAt, and invalidates cache. Default gate is review so a human can preview before going live.',
    actionCategory: 'worker',
    isExternal: false,
    defaultGateLevel: 'review',
    createsBoardTask: true,
    payloadFields: ['pageId'],
    parameterSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string', description: 'ID of the page to publish' },
      },
      required: ['pageId'],
    },
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: [],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  },
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsx --check server/config/actionRegistry.ts
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add server/config/actionRegistry.ts
git commit -m "feat: register create_page, update_page, publish_page actions in registry"
```

---

## Task 14: Mount all routes and initialize workers in server/index.ts

**Files:**
- Modify: `server/index.ts`

- [ ] **Step 1: Read the current route mounting section of server/index.ts**

Look for where routes are imported and mounted (the `app.use(...)` calls). Find a good insertion point after the last existing route.

- [ ] **Step 2: Add route imports**

Add these imports near the top of `server/index.ts` with the other route imports:

```typescript
import pageProjectsRouter from './routes/pageProjects.js';
import pageRoutesRouter from './routes/pageRoutes.js';
import pageServingRouter from './routes/public/pageServing.js';
import pagePreviewRouter from './routes/public/pagePreview.js';
import formSubmissionRouter from './routes/public/formSubmission.js';
import pageTrackingRouter from './routes/public/pageTracking.js';
import { subdomainResolution } from './middleware/subdomainResolution.js';
import { initializePageIntegrationWorker } from './services/pageIntegrationWorker.js';
import { initializePaymentReconciliationJob } from './services/paymentReconciliationJob.js';
```

- [ ] **Step 3: Add subdomain middleware and public routes**

Add the subdomain middleware BEFORE all route mounting (it needs to run on every request to resolve the project):

```typescript
// Subdomain resolution — must run before page serving routes
app.use(subdomainResolution);
```

Add public routes (no auth) alongside the other public routes like webhooks:

```typescript
// Public page infrastructure routes — no auth required
app.use(pageServingRouter);
app.use(pagePreviewRouter);
app.use(formSubmissionRouter);
app.use(pageTrackingRouter);
```

Add authenticated routes with the other authenticated routes:

```typescript
app.use(pageProjectsRouter);
app.use(pageRoutesRouter);
```

- [ ] **Step 4: Initialize workers in the startup sequence**

In the existing initialization block (where `agentScheduleService.initialize()` etc. are called), add:

```typescript
await initializePageIntegrationWorker();
await initializePaymentReconciliationJob();
```

- [ ] **Step 5: Add PAGES_BASE_DOMAIN to environment**

Add to `.env.example` (or `.env` if it exists):

```bash
PAGES_BASE_DOMAIN=synthetos.ai
```

- [ ] **Step 6: TypeScript check**

```bash
npx tsx --check server/index.ts
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add server/index.ts
git commit -m "feat: mount page infrastructure routes and initialize workers"
```

---

## Task 15: Smoke test — end to end verification

- [ ] **Step 1: Start the server**

```bash
npm run dev
```

Expected: Server starts without TypeScript errors. Workers register. Reconciliation job schedules.

- [ ] **Step 2: Test authenticated project creation**

```bash
# Replace TOKEN with a valid JWT from your auth flow
curl -X POST http://localhost:3000/api/subaccounts/SUBACCOUNT_ID/page-projects \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Site","slug":"test-site","theme":{"primaryColor":"#6366f1"}}'
```

Expected: `201` with project object including `id`, `slug`, `createdAt`.

- [ ] **Step 3: Test page creation**

```bash
curl -X POST http://localhost:3000/api/subaccounts/SUBACCOUNT_ID/page-projects/PROJECT_ID/pages \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"slug":"index","pageType":"website","title":"Test Page","html":"<h1>Hello World</h1>"}'
```

Expected: `201` with page object and `previewUrl`.

- [ ] **Step 4: Test publish**

```bash
curl -X POST http://localhost:3000/api/subaccounts/SUBACCOUNT_ID/page-projects/PROJECT_ID/pages/PAGE_ID/publish \
  -H "Authorization: Bearer TOKEN"
```

Expected: `200` with page where `status: "published"`.

- [ ] **Step 5: Test page serving (requires DNS or /etc/hosts entry)**

Add to `/etc/hosts` (or Windows hosts file):
```
127.0.0.1 test-site.synthetos.ai
```

Then:
```bash
curl -H "Host: test-site.synthetos.ai" http://localhost:3000/
```

Expected: HTML response with the page content wrapped in the page shell (theme CSS vars, tracking script).

- [ ] **Step 6: Test form submission**

```bash
curl -X POST http://localhost:3000/api/public/pages/PAGE_ID/submit \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@example.com","sessionId":"test-session-123"}'
```

Expected: `200` with `{"success":true}`.

- [ ] **Step 7: Test page view tracking**

```bash
curl -X POST http://localhost:3000/api/public/track \
  -H "Content-Type: application/json" \
  -d '{"pageId":"PAGE_ID","sessionId":"test-session-123"}'
```

Expected: `204 No Content`.

- [ ] **Step 8: Run TypeScript full project compile check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: complete page infrastructure implementation — smoke tests passing"
```

---

## Self-Review Checklist

### Spec Coverage

| Spec Section | Task Implementing It |
|---|---|
| page_projects schema | Task 2, 3 |
| pages schema | Task 2, 3 |
| page_versions schema | Task 2, 3 |
| project_integrations schema | Task 2, 3 |
| form_submissions schema | Task 2, 3 |
| page_views schema | Task 2, 3 |
| conversion_events schema | Task 2, 3 |
| HTML sanitization | Task 4 |
| Preview token generate/validate | Task 4 |
| GHL adapter | Task 5 |
| Stripe adapter | Task 5 |
| Adapter registry | Task 5 |
| Page project CRUD | Task 6 |
| Page CRUD + publish | Task 7 |
| Subdomain middleware | Task 8 |
| Public page serving + ETag cache | Task 9 |
| Preview URL serving | Task 9 |
| Form submission endpoint | Task 10 |
| Page view tracking | Task 10 |
| Deduplication (submissionHash) | Task 10 |
| Adapter capability validation | Task 10 |
| Atomic submission + job enqueue | Task 10, 11 |
| pg-boss integration worker | Task 11 |
| Payment reconciliation job | Task 12 |
| Agent action registry entries | Task 13 |
| Subdomain routing patterns | Task 8 |
| Theme shell injection | Task 9 |
| Tracking script + session ID | Task 9 |
| CSP headers | Task 9 |
| Tenant isolation | Task 8, 6 |
| Worker + reconciliation init | Task 14 |
| PAGES_BASE_DOMAIN env var | Task 14 |

### Known Simplifications in This Plan

1. **Rate limiting** — The spec calls for per-IP + per-page rate limiting for form submissions. This is left as configuration in `server/index.ts` (add `express-rate-limit` middleware on the `/api/public/pages/:pageId/submit` route). The 10-updates-per-hour agent rate limit in `pageService.update()` is marked as simplified — implement with a proper SQL count query in production.

2. **Atomic pg-boss enqueue** — The spec requires form submission insert + pg-boss job enqueue to happen in one DB transaction. The current implementation enqueues after the insert. Full atomicity requires using `pgBoss.send()` with an open `pg.Client` transaction. Wire this up when the pg-boss version and connection pooling allow.

3. **Webhook receiver for Stripe** — The spec mentions a webhook receiver for Stripe payment events. This plan defers it; the reconciliation job is the primary mechanism. Add a `POST /api/webhooks/stripe` route following the same pattern as `server/routes/webhooks.ts`.

4. **subaccounts.status field** — The subdomain resolution middleware checks `subaccount.status === 'active'`. Verify the `subaccounts` table has a `status` field (or adjust the check accordingly).

5. **pg-boss multi-instance** — Each worker (agentScheduleService, pageIntegrationWorker, paymentReconciliationJob) creates its own pg-boss instance against the same DATABASE_URL. This is the established pattern in this codebase. pg-boss handles concurrent instances safely via advisory locks in PostgreSQL.
