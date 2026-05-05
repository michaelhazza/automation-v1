# Phase 1 — Data model foundations

**Spec anchors:** §10 Phase 1 · §5.1–§5.7, §5.11 · §6.1 · §7.1 · §8.1–§8.3
**Migrations:** 0202 → 0203 → 0204 → 0205 → 0206 → 0207 → 0208 (in order)
**Pre-condition:** branch `claude/implementation-plan-Y622C` up to date with main at commit `6ee97b7` or later; last prior migration `0201_universal_brief_permissions.sql` applied.

## Purpose

Land all base tables, their RLS policies, the three model-tier seed rows, and the `referenceDocumentService` + routes so documents can be uploaded, versioned, listed, paused, deprecated, and soft-deleted end to end. No bundle logic in this phase — bundles land in Phase 2's service code even though their table is created here.

Exit state: a user can upload a document via `POST /api/reference-documents/bulk-upload`, list it, read it back, rename it, and lifecycle-flag it. The document has token counts for all three model families. The bundle and snapshot tables exist but are only queried by Phase 2+ code.

## Chunked deliverables

Suggested sub-agent boundaries (the executing session may re-cut these):

### Chunk 1.1 — Migration 0202 + schema `reference_documents`

- Create `migrations/0202_reference_documents.sql` per §5.1.
- Create `server/db/schema/referenceDocuments.ts` with table definition, indexes (org+name partial-unique where `deleted_at IS NULL`, org index, subaccount partial index, active index), `ReferenceDocumentSourceType` enum export.
- Add RLS policies per §8.1 template (org isolation + subaccount isolation).
- Add manifest entry to `server/config/rlsProtectedTables.ts`.
- Seed permission keys `reference_documents.read`, `reference_documents.write`, `reference_documents.deprecate` into `server/config/permissions.ts` and the migration's permission upsert.

### Chunk 1.2 — Migration 0203 + schema `reference_document_versions`

- Create `migrations/0203_reference_document_versions.sql` per §5.2.
- Create `server/db/schema/referenceDocumentVersions.ts` with table definition + unique `(document_id, version)` + content-hash index + doc-version index.
- Add the soft-FK from `reference_documents.current_version_id` to `reference_document_versions.id` in this migration (circular-dep avoidance pattern per `memoryBlocks.ts`).
- RLS policy uses `EXISTS (SELECT 1 FROM reference_documents WHERE id = document_id AND organisation_id = current_setting(...))` — inherits via parent FK.
- Manifest entry.

### Chunk 1.3 — Migration 0204 + schema `document_bundles`

- Create `migrations/0204_document_bundles.sql` per §5.3 + §6.7 erratum (include `utilization_by_model_family` JSONB column).
- Create `server/db/schema/documentBundles.ts` with table, partial-unique named-name index, org index, subaccount partial index, named-bundle-lookup index.
- Attach CHECK constraint `document_bundles_name_matches_auto_flag` enforcing `(is_auto_created=true AND name IS NULL) OR (is_auto_created=false AND name IS NOT NULL AND length(trim(name)) > 0)`.
- Seed permission keys `document_bundles.read`, `document_bundles.write`, `document_bundles.attach` into `server/config/permissions.ts` and the migration's permission upsert.
- RLS policies + manifest entry.

### Chunk 1.4 — Migration 0205 + schema `document_bundle_members`

- `migrations/0205_document_bundle_members.sql` per §5.4.
- `server/db/schema/documentBundleMembers.ts` with partial-unique `(bundle_id, document_id) WHERE deleted_at IS NULL`, bundle index, doc index.
- `onDelete: 'restrict'` on the `referenceDocuments` FK.
- RLS policy inherits via bundle FK (`EXISTS` pattern) + manifest entry.

### Chunk 1.5 — Migration 0206 + schema `document_bundle_attachments`

- `migrations/0206_document_bundle_attachments.sql` per §5.5.
- `server/db/schema/documentBundleAttachments.ts` with `AttachmentSubjectType` + `AttachmentMode` enum exports, partial-unique `(bundle_id, subject_type, subject_id) WHERE deleted_at IS NULL`, subject index, org index.
- RLS policies + manifest entry.
- No DB-level FK on `subject_id` (service-enforced polymorphic).

### Chunk 1.6 — Migration 0207 + schema `bundle_resolution_snapshots`

- `migrations/0207_bundle_resolution_snapshots.sql` per §5.6.
- `server/db/schema/bundleResolutionSnapshots.ts` with `UNIQUE(bundle_id, prefix_hash)`, non-unique `prefix_hash` lookup index, `(bundle_id, bundle_version)` index, org index.
- No `deletedAt` column — snapshots are immutable.
- RLS policies + manifest entry.

### Chunk 1.7 — Migration 0208 + schema `model_tier_budget_policies` + seed rows

- `migrations/0208_model_tier_budget_policies.sql` per §5.7.
- `server/db/schema/modelTierBudgetPolicies.ts` with unique `(organisation_id, model_family)` (nullable org for platform defaults), model index.
- Attach CHECK constraint `max_input_tokens + reserve_output_tokens <= model_context_window`.
- Insert 3 platform-default rows (Sonnet 4.6, Opus 4.7, Haiku 4.5) in the same migration using the exact values in §5.7.
- RLS: **custom policy shape** (NOT the generic template). SELECT allows `organisation_id IS NULL OR organisation_id = current_setting(...)`; ALL (INSERT/UPDATE/DELETE) scopes to matching org via `USING` + `WITH CHECK` clauses.
- Manifest entry.

### Chunk 1.8 — `referenceDocumentService` + Pure + `anthropicAdapter.countTokens` helper

- Create `server/services/referenceDocumentServicePure.ts` per §6.1 pure surface: `hashContent`, `hashSerialized`, `serializeDocument` (delimiter format `---DOC_START---\nid: ...\nversion: ...\n---\n<content>\n---DOC_END---\n`). **Note:** `serializeDocument` is also exported from `contextAssemblyEnginePure` in Phase 3 — the two must produce byte-identical output for identical inputs. Decision: the Phase 3 engine imports from `referenceDocumentServicePure` to keep one implementation; Phase 1 ships the definition; Phase 3 re-exports.
- Create `server/services/referenceDocumentService.ts` per §6.1 stateful surface. All methods: `create`, `updateContent`, `rename`, `pause`, `resume`, `deprecate`, `softDelete`, `listByOrg`, `getByIdWithCurrentVersion`, `listVersions`, `getVersion`.
- Add `countTokens(args: { modelFamily: string; content: string }): Promise<number>` helper to `server/services/providers/anthropicAdapter.ts` (new function, not on the existing `call` path). Wraps the Anthropic `count_tokens` endpoint. Phase 1 is the only caller.
- Error-code exports: `CACHED_CONTEXT_DOC_NAME_TAKEN` (409), `CACHED_CONTEXT_DOC_NOT_FOUND` (404), `CACHED_CONTEXT_DOC_ALREADY_DEPRECATED` (409), `CACHED_CONTEXT_DOC_TOKEN_COUNT_FAILED` (502), `CACHED_CONTEXT_DOC_CONTAINS_DELIMITER` (400), `CACHED_CONTEXT_DOC_TOKEN_COUNT_MISSING` (500 — thrown by resolution service in Phase 4, but the error-code constant lives here).
- Idempotent `updateContent`: if new content hash matches current version's `contentHash`, return existing version without inserting.
- Strict token-count failure policy: if `countTokens` fails for any of the three families, roll back the whole create/update. No partial writes.
- Content-delimiter guard: reject content containing the literal `---DOC_END---` string at `create` / `updateContent` with `CACHED_CONTEXT_DOC_CONTAINS_DELIMITER`.

### Chunk 1.9 — Pure tests

- `server/services/__tests__/referenceDocumentServicePure.test.ts` per §11.1:
  - `hashContent` is SHA-256 over raw bytes (assert against known fixture).
  - `hashSerialized` hashes the serialized form including delimiters.
  - `serializeDocument` output contains the exact delimiter sequence.
- Run via tsx + existing static-gate convention. No vitest / jest.

### Chunk 1.10 — Routes `server/routes/referenceDocuments.ts`

- Thin handlers per §7.1: `GET /api/reference-documents`, `POST /api/reference-documents`, `POST /api/reference-documents/bulk-upload`, `GET/:id`, `PATCH/:id`, `PUT/:id/content`, `POST/:id/pause`, `POST/:id/resume`, `POST/:id/deprecate`, `DELETE/:id`, `GET/:id/versions`, `GET/:id/versions/:v`.
- Middleware chain: `authenticate` → `requireOrgPermission('reference_documents.read'|...)` → `resolveSubaccount` when needed → `asyncHandler`-wrapped handler.
- `POST /bulk-upload` (§7.1 detailed contract): multipart parser, per-file 10 MB limit, MIME whitelist (`text/markdown`, `application/pdf`, `text/plain`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`), `names[].length === files[].length` validation, single DB transaction, `Idempotency-Key` header support.
- `attachTo` JSON body param support is **stubbed** in Phase 1: the handler parses and validates the field but defers calling `documentBundleService.findOrCreateUnnamedBundle` + `attach` until Phase 2 (TODO comment in the handler). Without Phase 2, passing `attachTo` returns `501 NOT_IMPLEMENTED_UNTIL_PHASE_2`. Documents-only uploads work fully in Phase 1.
- Mount the router in `server/index.ts`.

## Acceptance (Phase 1 complete)

- [ ] All seven migrations (0202–0208) apply cleanly from scratch on an empty DB.
- [ ] `npm run db:generate` produces no diff (schema matches migrations).
- [ ] `scripts/gates/verify-rls-coverage.sh` passes (7 new manifest entries present).
- [ ] `scripts/gates/verify-rls-contract-compliance.sh` passes (no bypasses in new service).
- [ ] `referenceDocumentServicePure.test.ts` passes.
- [ ] Manual smoke: upload a 10 KB markdown doc via `POST /bulk-upload`, verify `reference_documents` row + `reference_document_versions` row with `tokenCounts` for Sonnet, Opus, Haiku; rename it; pause it; verify it disappears from `active` index; resume it; deprecate it.
- [ ] `npm run typecheck` + `npm run lint` green.
- [ ] `spec-conformance: verify phase 1 of docs/cached-context-infrastructure-spec.md` reports `CONFORMANT` (or `CONFORMANT_AFTER_FIXES` with a clean re-run).
- [ ] `pr-reviewer` run clean.

## Out of scope for Phase 1

- Any bundle service logic (Phase 2).
- Any attach routes (Phase 2).
- Budget resolver, assembly engine, orchestrator (Phase 3/4).
- `agent_runs` / `llm_requests` column additions (Phase 4/5).
- `utilization_by_model_family` job (registered in Phase 2, enabled in Phase 6).
