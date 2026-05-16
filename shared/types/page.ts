/**
 * Shared row-shape types for `pages` and `page_projects`.
 *
 * Mirrors `server/db/schema/pages.ts` and `server/db/schema/pageProjects.ts`
 * but lives in `shared/` so server-route files do not import db/schema/* for
 * type-only purposes. Gate `verify-org-id-source.sh` (and related regex gates)
 * flag `import.*from '.*db/schema/.*'` patterns in route files; moving the
 * row types here keeps the schemas as the runtime source of truth while
 * routes consume the same shape without a cross-layer import.
 *
 * Drift detection is enforced by
 * `server/db/schema/__types-check__/page.types-check.ts` — that file compiles
 * iff `Page` / `PageProject` here remain structurally compatible with the
 * drizzle `$inferSelect` shapes in both directions. If the schema or this
 * file change, update them in the same commit and `npm run typecheck` will
 * flag misalignment immediately.
 */

export interface PageMeta {
  title?: string;
  description?: string;
  ogImage?: string;
  canonicalUrl?: string;
  noIndex?: boolean;
}

export interface PageFormConfig {
  fields: Array<{ name: string; type: string; required: boolean }>;
  actions: Record<string, { action: string; fields: Record<string, unknown> }>;
  thankYou: { type: 'redirect' | 'message'; value: string };
}

export interface PageProjectTheme {
  primaryColor?: string;
  secondaryColor?: string;
  fontHeading?: string;
  fontBody?: string;
  logoUrl?: string;
  faviconUrl?: string;
}

export interface Page {
  id: string;
  projectId: string;
  slug: string;
  pageType: 'website' | 'landing';
  title: string | null;
  html: string | null;
  status: 'draft' | 'published' | 'archived';
  meta: PageMeta | null;
  formConfig: PageFormConfig | null;
  createdByAgentId: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PageProject {
  id: string;
  organisationId: string;
  subaccountId: string;
  name: string;
  slug: string;
  theme: PageProjectTheme | null;
  customDomain: string | null;
  githubRepo: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}
