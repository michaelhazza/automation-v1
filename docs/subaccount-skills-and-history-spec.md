# Subaccount Skills, Skill Version History, and Analyser UI Improvements

**Status:** Draft (review fixes applied)
**Date:** 2026-04-14

---

## Table of Contents

1. [Overview and Dependencies](#1-overview-and-dependencies)
2. [Feature A: Subaccount-Level Skills](#2-feature-a-subaccount-level-skills)
   - 2.1 Schema Changes
   - 2.2 Service Changes
   - 2.3 Route Changes
   - 2.4 Permission Model
   - 2.5 Skill Resolution at Runtime (Three-Tier Merge)
   - 2.6 Frontend Changes
   - 2.7 Visibility Cascade Adjustments
3. [Feature B: Comprehensive Skill Version History](#3-feature-b-comprehensive-skill-version-history)
   - 3.1 Version Helper Service
   - 3.2 System Skill Write Paths
   - 3.3 Org/Subaccount Skill Write Paths
   - 3.4 Skill Analyser Write Paths
   - 3.5 Config Backup Restore Write Path
   - 3.6 Skill Studio Adjustments
4. [Feature C: Skill Analyser Backup/Restore UI](#4-feature-c-skill-analyser-backuprestore-ui)
   - 4.1 Job List Enhancements
   - 4.2 Completed Job Detail View
   - 4.3 Restore Flow from Job List
5. [Migration Strategy](#5-migration-strategy)
6. [Implementation Chunks](#6-implementation-chunks)
7. [Testing Considerations](#7-testing-considerations)

---

## 1. Overview and Dependencies

Three features built together because they share schema surface and service boundaries:

| Feature | Scope | Depends on |
|---------|-------|------------|
| **A: Subaccount-Level Skills** | New `subaccountId` column on `skills`, new routes/permissions, three-tier skill resolution | Migration first |
| **B: Comprehensive Skill Version History** | Write `skill_versions` rows from every mutation path | Feature A (subaccount skills need versioning too) |
| **C: Skill Analyser Backup/Restore UI** | Frontend: job list badges, persistent restore button | Independent of A and B; can be done in parallel |

**Cross-cutting invariant:** Feature B writes must be wired into every code path that creates or updates a skill row (system, org, or subaccount). If Feature A adds new write paths, Feature B must instrument them in the same commit.

### Key files referenced throughout

| File | Purpose |
|------|---------|
| `server/db/schema/skills.ts` | `skills` table definition |
| `server/db/schema/skillVersions.ts` | `skill_versions` table definition |
| `server/db/schema/systemSkills.ts` | `system_skills` table definition |
| `server/db/schema/subaccountAgents.ts` | `subaccount_agents` table (carries `skillSlugs`) |
| `server/services/skillService.ts` | Org/subaccount skill CRUD + resolution |
| `server/services/systemSkillService.ts` | System skill CRUD |
| `server/services/skillStudioService.ts` | Skill Studio reads/writes versions |
| `server/services/skillAnalyzerService.ts` | Skill analyser pipeline + executeApproved |
| `server/services/configBackupService.ts` | Backup/restore for skill analyser |
| `server/services/configHistoryService.ts` | Config history audit trail |
| `server/services/agentExecutionService.ts` | Runtime skill resolution (lines ~383, ~520) |
| `server/routes/skills.ts` | Org-level skill routes |
| `server/routes/skillAnalyzer.ts` | Skill analyser routes |
| `server/lib/permissions.ts` | Permission keys |
| `server/lib/skillVisibility.ts` | Visibility cascade helpers |
| `client/src/pages/SkillAnalyzerPage.tsx` | Job list page |
| `client/src/components/skill-analyzer/SkillAnalyzerWizard.tsx` | Wizard |
| `client/src/components/skill-analyzer/SkillAnalyzerExecuteStep.tsx` | Execute/restore step |
| `client/src/components/SkillPickerSection.tsx` | Skill picker used in agent edit pages |

---

## 2. Feature A: Subaccount-Level Skills

### 2.1 Schema Changes

#### 2.1.1 `skills` table: add `subaccountId` column

**File:** `server/db/schema/skills.ts`

Add a nullable FK column:

```typescript
subaccountId: uuid('subaccount_id')
  .references(() => subaccounts.id),
```

Add an index:

```typescript
subaccountIdx: index('skills_subaccount_idx').on(table.subaccountId),
```

**Tier semantics (enforced by application logic, documented in CHECK constraint):**

| Tier | `organisationId` | `subaccountId` |
|------|-------------------|----------------|
| System | `NULL` | `NULL` |
| Org | set | `NULL` |
| Subaccount | set | set |

Note: subaccount skills MUST have `organisationId` set (inherited from the subaccount's org). This preserves the existing org-scoping invariant for all queries.

#### 2.1.2 Slug uniqueness

The existing unique index `skills_slug_org_idx` on `(organisationId, slug)` must be replaced. Two subaccounts in the same org must be able to use the same slug, and a subaccount can shadow an org skill slug.

**Drop** `skills_slug_org_idx`.

**Create** a new partial unique index:

```sql
-- System skills: slug unique where both NULL
CREATE UNIQUE INDEX skills_slug_system_uniq
  ON skills (slug)
  WHERE organisation_id IS NULL AND subaccount_id IS NULL AND deleted_at IS NULL;

-- Org skills: slug unique per org (excluding subaccount skills)
CREATE UNIQUE INDEX skills_slug_org_uniq
  ON skills (organisation_id, slug)
  WHERE subaccount_id IS NULL AND deleted_at IS NULL;

-- Subaccount skills: slug unique per subaccount
CREATE UNIQUE INDEX skills_slug_subaccount_uniq
  ON skills (subaccount_id, slug)
  WHERE subaccount_id IS NOT NULL AND deleted_at IS NULL;
```

This uses partial indexes instead of a composite unique index to correctly handle NULLs (PostgreSQL's default NULL handling in unique indexes would allow duplicates).

#### 2.1.3 CHECK constraint for tier integrity

```sql
ALTER TABLE skills ADD CONSTRAINT skills_tier_check CHECK (
  -- System: both null
  (organisation_id IS NULL AND subaccount_id IS NULL) OR
  -- Org: org set, subaccount null
  (organisation_id IS NOT NULL AND subaccount_id IS NULL) OR
  -- Subaccount: both set
  (organisation_id IS NOT NULL AND subaccount_id IS NOT NULL)
);
```

#### 2.1.4 Migration SQL

**Migration file:** `migrations/0118_subaccount_skills.sql`

```sql
-- Add subaccount_id column to skills
ALTER TABLE skills ADD COLUMN subaccount_id uuid REFERENCES subaccounts(id);

-- Add tier integrity constraint
ALTER TABLE skills ADD CONSTRAINT skills_tier_check CHECK (
  (organisation_id IS NULL AND subaccount_id IS NULL) OR
  (organisation_id IS NOT NULL AND subaccount_id IS NULL) OR
  (organisation_id IS NOT NULL AND subaccount_id IS NOT NULL)
);

-- Replace slug uniqueness: drop old, create new partial indexes
DROP INDEX IF EXISTS skills_slug_org_idx;

CREATE UNIQUE INDEX skills_slug_system_uniq
  ON skills (slug)
  WHERE organisation_id IS NULL AND subaccount_id IS NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX skills_slug_org_uniq
  ON skills (organisation_id, slug)
  WHERE subaccount_id IS NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX skills_slug_subaccount_uniq
  ON skills (subaccount_id, slug)
  WHERE subaccount_id IS NOT NULL AND deleted_at IS NULL;

-- Index for subaccount skill queries
CREATE INDEX skills_subaccount_idx ON skills (subaccount_id);
```

**Backwards compatibility:** All existing rows have `subaccount_id = NULL`, so they pass the CHECK constraint. The new partial indexes cover the same uniqueness guarantee as the old `skills_slug_org_idx` for existing rows.

### 2.2 Service Changes

**File:** `server/services/skillService.ts`

#### 2.2.1 New methods

```typescript
/** List skills visible within a subaccount: system + org + this subaccount's own. */
async listSubaccountSkills(organisationId: string, subaccountId: string): Promise<Skill[]>

/** Get a single skill, validating it belongs to the given subaccount (or org/system). */
async getSubaccountSkill(id: string, organisationId: string, subaccountId: string): Promise<Skill>

/** Create a skill scoped to a subaccount. */
async createSubaccountSkill(organisationId: string, subaccountId: string, data: {
  name: string;
  slug: string;
  description?: string;
  definition: object;
  instructions?: string;
}): Promise<Skill>

/** Update a subaccount-scoped skill. */
async updateSubaccountSkill(id: string, organisationId: string, subaccountId: string, data: Partial<{
  name: string;
  description: string;
  definition: object;
  instructions: string;
  isActive: boolean;
  visibility: SkillVisibility;
}>): Promise<Skill>

/** Soft-delete a subaccount-scoped skill. */
async deleteSubaccountSkill(id: string, organisationId: string, subaccountId: string): Promise<{ message: string }>
```

#### 2.2.2 Modified methods

**`listSkills(organisationId)`** -- No change needed. This returns org + system skills (subaccountId IS NULL). Used by org-level UI.

**`getSkillBySlug(slug, organisationId)`** -- No change for the org-only path. Add a new overload:

```typescript
/** Resolve a slug with subaccount fallback chain: subaccount -> org -> system. */
async getSkillBySlugForSubaccount(
  slug: string,
  organisationId: string,
  subaccountId: string,
): Promise<Skill | null>
```

Resolution order (four layers, strict precedence):
1. **Subaccount** — active, non-deleted skill with this slug AND `subaccountId = subaccountId`
2. **Organisation** — active, non-deleted skill with this slug AND `organisationId = organisationId` AND `subaccountId IS NULL`
3. **Built-in (skills table)** — active, non-deleted skill with this slug AND `organisationId IS NULL` AND `subaccountId IS NULL`
4. **System (system_skills table)** — resolved via `systemSkillService.getSkillBySlug` (final fallback)

Return `null` if no layer matches.

**Important: system_skills vs skills table precedence.** There are two "system" layers:
- The `skills` table can hold built-in rows with `organisationId = NULL` (layer 3)
- The `system_skills` table holds global system skills (layer 4)

**Invariant:** A slug MUST NOT exist in both layers simultaneously. Enforcement: `systemSkillService.createSystemSkill` must reject slugs that already exist in the `skills` table (at any tier), and `skillService.createSkill` (when `organisationId IS NULL`) must reject slugs that exist in `system_skills`. This prevents undefined precedence between layers 3 and 4.

This is the key method for runtime skill resolution.

**`resolveSkillsForAgent`** -- Add optional `subaccountId` parameter and batch resolution:

```typescript
async resolveSkillsForAgent(
  skillSlugs: string[],
  organisationId: string,
  subaccountId?: string,
): Promise<{ tools: AnthropicTool[]; instructions: string[] }>
```

**Batch resolution (avoids N+1 queries):** Instead of calling `getSkillBySlugForSubaccount` per slug, resolve all slugs in a single query with precedence applied in memory:

```typescript
// 1. Batch-fetch all matching skills across tiers in one query
const candidates = await db.select().from(skills).where(and(
  inArray(skills.slug, skillSlugs),
  isNull(skills.deletedAt),
  eq(skills.isActive, true),
  or(
    // Subaccount tier
    subaccountId ? eq(skills.subaccountId, subaccountId) : sql`false`,
    // Org tier
    and(eq(skills.organisationId, organisationId), isNull(skills.subaccountId)),
    // Built-in tier
    and(isNull(skills.organisationId), isNull(skills.subaccountId)),
  ),
));

// 2. Group by slug, pick highest-precedence tier
const bySlug = new Map<string, Skill>();
for (const row of candidates) {
  const existing = bySlug.get(row.slug);
  if (!existing || tierPrecedence(row) > tierPrecedence(existing)) {
    bySlug.set(row.slug, row);
  }
}

// 3. Any slugs not found in skills table → fall back to systemSkillService (batch)
const missingSlugs = skillSlugs.filter(s => !bySlug.has(s));
if (missingSlugs.length > 0) {
  const systemSkills = await systemSkillService.getSkillsBySlugs(missingSlugs);
  // ... merge into result
}
```

Where `tierPrecedence` returns 3 for subaccount, 2 for org, 1 for built-in. This reduces the per-agent resolution from N queries to 1-2 queries regardless of skill count.

**Instruction payload size guard:** After resolving all skills, enforce a total instruction size limit to prevent LLM context blowout when many skills are concatenated:

```typescript
const MAX_TOTAL_SKILL_INSTRUCTIONS = 100_000; // characters

const allInstructions = resolvedSkills
  .map(s => s.instructions)
  .filter(Boolean) as string[];
const totalLength = allInstructions.reduce((sum, i) => sum + i.length, 0);

if (totalLength > MAX_TOTAL_SKILL_INSTRUCTIONS) {
  logger.warn('Skill instructions exceed limit', {
    totalLength,
    limit: MAX_TOTAL_SKILL_INSTRUCTIONS,
    skillCount: allInstructions.length,
  });
  // Truncate: include skills in priority order until limit is reached
  let remaining = MAX_TOTAL_SKILL_INSTRUCTIONS;
  const truncated: string[] = [];
  for (const instr of allInstructions) {
    if (remaining <= 0) break;
    truncated.push(instr.slice(0, remaining));
    remaining -= instr.length;
  }
  return { tools, instructions: truncated };
}
```

Add `MAX_TOTAL_SKILL_INSTRUCTIONS` to `server/config/limits.ts`.

**`decorateSkillForViewer`** -- Extend the owner-tier logic:

```typescript
const ownerTier: SkillTier = row.organisationId === null
  ? 'system'
  : row.subaccountId !== null
    ? 'subaccount'
    : 'organisation';
```

#### 2.2.3 Config history tracking

All subaccount skill CRUD methods call `configHistoryService.recordHistory` with:
- `entityType: 'skill'`
- `organisationId` from the subaccount's org
- Snapshot includes `subaccountId` field

This matches the existing pattern from `createSkill` / `updateSkill`.

#### 2.2.4 Implementation notes

- All subaccount skill queries MUST include `eq(skills.organisationId, organisationId)` for org scoping.
- All queries MUST include `isNull(skills.deletedAt)` for soft delete.
- The `createSubaccountSkill` method sets `skillType: 'custom'` (subaccount skills are always custom).
- Subaccount skills cannot be `'built_in'` type -- guard in `createSubaccountSkill`.

### 2.3 Route Changes

**New file:** `server/routes/subaccountSkills.ts`

All routes are nested under `/api/subaccounts/:subaccountId/skills`. Every handler calls `resolveSubaccount(req.params.subaccountId, req.orgId!)` first.

| Method | Path | Permission | Service method |
|--------|------|------------|----------------|
| `GET` | `/api/subaccounts/:subaccountId/skills` | `subaccount.skills.view` OR `org.agents.view` | `skillService.listSubaccountSkills(orgId, subaccountId)` |
| `GET` | `/api/subaccounts/:subaccountId/skills/:id` | `subaccount.skills.view` OR `org.agents.view` | `skillService.getSubaccountSkill(id, orgId, subaccountId)` |
| `POST` | `/api/subaccounts/:subaccountId/skills` | `subaccount.skills.manage` OR `org.agents.create` | `skillService.createSubaccountSkill(orgId, subaccountId, body)` |
| `PATCH` | `/api/subaccounts/:subaccountId/skills/:id` | `subaccount.skills.manage` OR `org.agents.edit` | `skillService.updateSubaccountSkill(id, orgId, subaccountId, body)` |
| `DELETE` | `/api/subaccounts/:subaccountId/skills/:id` | `subaccount.skills.manage` OR `org.agents.edit` | `skillService.deleteSubaccountSkill(id, orgId, subaccountId)` |
| `PATCH` | `/api/subaccounts/:subaccountId/skills/:id/visibility` | `subaccount.skills.manage` OR `org.agents.edit` | `skillService.updateSubaccountSkillVisibility(id, orgId, subaccountId, visibility)` |

**Permission dual-gate pattern:** Org admins (with `org.agents.*` permissions) can manage skills for any subaccount they manage. Subaccount users with the new `subaccount.skills.*` permissions can manage their own workspace's skills. The route uses `requireSubaccountPermission(SUB_PERM) || requireOrgPermission(ORG_PERM)` -- implemented as a middleware that passes if either check succeeds.

**Route registration:** Add to `server/index.ts` route mounting alongside existing skill routes.

**Request validation:** Create Zod schemas in `server/schemas/subaccountSkills.ts`:

```typescript
export const createSubaccountSkillBody = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9_]+$/),
  description: z.string().max(2000).optional(),
  definition: z.object({
    name: z.string(),
    description: z.string(),
    input_schema: z.object({}).passthrough(),
  }).passthrough()
    .refine(
      (def) => JSON.stringify(def).length <= 256_000,
      { message: 'Definition payload exceeds 256 KB limit' },
    ),
  instructions: z.string().max(50000).optional(),
});

export const updateSubaccountSkillBody = createSubaccountSkillBody.partial();
```

**Definition size guard:** The `.refine()` on `definition` prevents arbitrarily large JSON payloads that could bloat the database and slow LLM context assembly. The 256 KB limit is generous but prevents abuse. Add `MAX_SKILL_DEFINITION_SIZE = 256_000` to `server/config/limits.ts`.

### 2.4 Permission Model

**File:** `server/lib/permissions.ts`

Add two new subaccount-level permissions:

```typescript
// In SUBACCOUNT_PERMISSIONS:
SKILLS_VIEW: 'subaccount.skills.view',
SKILLS_MANAGE: 'subaccount.skills.manage',
```

Add to `ALL_PERMISSIONS` array:

```typescript
{ key: SUBACCOUNT_PERMISSIONS.SKILLS_VIEW, description: 'View subaccount-scoped skills', groupName: 'subaccount.skills' },
{ key: SUBACCOUNT_PERMISSIONS.SKILLS_MANAGE, description: 'Create, edit, and delete subaccount-scoped skills', groupName: 'subaccount.skills' },
```

Add to default permission set templates:
- **Subaccount Admin**: add both `SKILLS_VIEW` and `SKILLS_MANAGE`
- **Subaccount Manager**: add both `SKILLS_VIEW` and `SKILLS_MANAGE`
- **Subaccount User**: add `SKILLS_VIEW` only

**Org-level access:** Org admins implicitly have access through existing `org.agents.*` permissions. The route dual-gate pattern (section 2.3) checks either the org permission OR the subaccount permission.

**Migration:** Add a seed migration to insert the new permission rows into the `permissions` table. This follows the pattern of existing permission additions.

### 2.5 Skill Resolution at Runtime (Three-Tier Merge)

**Files:**
- `server/services/agentExecutionService.ts` (lines ~383, ~520)
- `server/services/skillService.ts` (`resolveSkillsForAgent`)

#### Current flow (two-tier)

1. Agent execution reads `configSkillSlugs` from `subaccountAgents.skillSlugs` (line ~383)
2. Calls `skillService.resolveSkillsForAgent(skillSlugs, organisationId)` (line ~521)
3. For each slug: looks up in `skills` table (org), falls back to `systemSkillService` (system)

#### New flow (three-tier)

1. Agent execution reads `configSkillSlugs` from `subaccountAgents.skillSlugs` (unchanged)
2. Calls `skillService.resolveSkillsForAgent(skillSlugs, organisationId, subaccountId)` -- **pass subaccountId**
3. For each slug: `getSkillBySlugForSubaccount` resolves via cascade (four layers, strict precedence):
   1. **Subaccount** skill (exact subaccountId match) -- highest priority
   2. **Organisation** skill (same org, no subaccount) -- middle priority
   3. **Built-in** skill from `skills` table (null org, null subaccount) -- fallback
   4. **System** skill via `systemSkillService.getSkillBySlug` -- final fallback
   
   Invariant: layers 3 and 4 must not overlap on slug (see section 2.2.2).

**Change in `agentExecutionService.ts`:**

At line ~521, change:

```typescript
// Before:
const { tools: skillTools, instructions: skillInstructions } = await skillService.resolveSkillsForAgent(
  skillSlugs,
  request.organisationId
);

// After:
const { tools: skillTools, instructions: skillInstructions } = await skillService.resolveSkillsForAgent(
  skillSlugs,
  request.organisationId,
  request.subaccountId,  // NEW: enables subaccount skill resolution
);
```

The `request.subaccountId` is already available on the execution request object.

#### Shadowing rules

A subaccount skill with slug `foo` shadows an org skill with the same slug `foo` for agents running in that subaccount. The org skill is NOT deleted -- it remains visible/usable in other subaccounts. This is the same pattern as subaccount board config overriding org board config.

**Shadowing overrides visibility filtering.** If an org skill has `visibility = 'none'` but a subaccount skill with the same slug exists, the subaccount skill wins regardless of the org skill's visibility setting. The visibility of the *resolved* skill (the subaccount one) applies, not the shadowed skill's visibility. This means a subaccount can effectively "replace" a hidden org skill with its own implementation.

**The `skillSlugs` array on `subaccountAgents` can now reference:**
- System skill slugs (resolved via `systemSkillService`)
- Org skill slugs (resolved via `skills` table, `subaccountId IS NULL`)
- Subaccount skill slugs (resolved via `skills` table, `subaccountId = <this subaccount>`)

No schema change needed on `subaccountAgents.skillSlugs` -- it is already a string array of slugs.

#### `allowedSkillSlugs` (tool restriction)

The `toolRestrictionMiddleware` in `server/services/middleware/toolRestriction.ts` checks `ctx.saLink.allowedSkillSlugs` against tool names. No change needed -- it already operates on tool names (which come from the resolved definition), not on slugs directly. Subaccount skills that resolve to tool definitions will be naturally gated by this middleware.

### 2.6 Frontend Changes

#### 2.6.1 Subaccount Skills Page

**New file:** `client/src/pages/SubaccountSkillsPage.tsx` (lazy-loaded)

A skills management page accessible from the subaccount admin area. Shows a table of skills scoped to this subaccount with standard column-header sort/filter (following `SystemSkillsPage.tsx` pattern).

**Columns:** Name, Slug, Type (always "custom"), Visibility, Status, Created At

**Actions:**
- Create new skill (modal or inline form)
- Edit skill (navigate to edit page or modal)
- Delete skill (confirmation dialog, soft-delete)
- Visibility toggle (inline segmented control: none/basic/full)

**Route:** `/admin/subaccounts/:subaccountId/skills`

**Router registration:** Add to `client/src/App.tsx` alongside existing subaccount admin routes. Gate visibility behind the `subaccount.skills.view` permission (or `org.agents.view` for org admins).

#### 2.6.2 Skill Picker Updates

**File:** `client/src/components/SkillPickerSection.tsx`

Currently the skill picker fetches from `/api/skills/all` which returns org + system skills. When used in the `SubaccountAgentEditPage`, it needs to also show subaccount-scoped skills.

**Change:** Accept an optional `subaccountId` prop. When provided, fetch from `/api/subaccounts/:subaccountId/skills` (which returns system + org + subaccount skills) instead of `/api/skills/all`. Add a visual grouping indicator (badge or section header) showing the tier: "System", "Org", "Subaccount".

**File:** `client/src/pages/SubaccountAgentEditPage.tsx`

Pass `subaccountId` to the `SkillPickerSection` so it includes subaccount-scoped skills in the picker.

#### 2.6.3 Subaccount navigation

Add a "Skills" link in the subaccount admin sidebar/navigation, gated by the `subaccount.skills.view` permission. Place it near the existing agent management links.

### 2.7 Visibility Cascade Adjustments

**File:** `server/lib/skillVisibility.ts`

The existing three-tier cascade (`system -> organisation -> subaccount`) already accounts for a `'subaccount'` tier in the `SkillTier` type. The helper functions work correctly for the new tier:

- **`isSkillVisibleToViewer`**: A subaccount-tier viewer sees org skills only when `visibility !== 'none'`. Owner-tier (subaccount viewing its own skill) always sees it. This is correct as-is.
- **`canViewContents`**: Subaccount viewer sees org skill body only when `visibility === 'full'`. Correct as-is.
- **`canManageSkill`**: Only owner-tier + manage permission can edit. A subaccount user cannot edit an org skill. Correct as-is.

**Change in `skillService.decorateSkillForViewer`:** The `ownerTier` derivation needs updating (see section 2.2.2) to recognize the subaccount tier:

```typescript
const ownerTier: SkillTier = row.organisationId === null
  ? 'system'
  : row.subaccountId !== null
    ? 'subaccount'
    : 'organisation';
```

**Viewer tier resolution for subaccount routes:** In `server/routes/subaccountSkills.ts`, the viewer is:

```typescript
function resolveSubaccountSkillViewer(req): { tier: SkillTier; hasManagePermission: boolean } {
  if (req.user?.role === 'system_admin') {
    return { tier: 'system', hasManagePermission: true };
  }
  // Org admins viewing a subaccount's skills are at 'organisation' tier
  if (isOrgAdmin(req)) {
    return { tier: 'organisation', hasManagePermission: true };
  }
  // Subaccount users are at 'subaccount' tier
  const hasManage = hasSubaccountPermission(req, SUBACCOUNT_PERMISSIONS.SKILLS_MANAGE);
  return { tier: 'subaccount', hasManagePermission: hasManage };
}
```

This means:
- **Org admin** viewing a subaccount's skill list sees all three tiers' skills (system visible at basic/full, org visible at basic/full, subaccount fully visible since they are above the owner tier)
- **Subaccount user** sees their own subaccount skills fully, org skills filtered by visibility, system skills filtered by visibility

### 2.8 Guardrails and Limits

#### 2.8.1 Skill count limit per subaccount

Prevent unbounded skill creation that degrades resolution performance:

```typescript
// In server/config/limits.ts
export const MAX_SKILLS_PER_SUBACCOUNT = 200;
```

Enforce in `createSubaccountSkill`:

```typescript
const count = await db.select({ count: sql<number>`count(*)` })
  .from(skills)
  .where(and(
    eq(skills.subaccountId, subaccountId),
    isNull(skills.deletedAt),
  ));
if (count[0].count >= MAX_SKILLS_PER_SUBACCOUNT) {
  throw { statusCode: 400, message: `Subaccount skill limit (${MAX_SKILLS_PER_SUBACCOUNT}) reached` };
}
```

#### 2.8.2 Execution-time skill validation

At agent runtime, after resolving a skill via `resolveSkillsForAgent`, validate that the resolved skill is still valid before injecting it into the LLM context:

- **Active check:** `isActive = true` (already covered by the resolution query WHERE clause)
- **Not deleted check:** `deletedAt IS NULL` (already covered)
- **Definition well-formed:** The definition has `name`, `description`, and `input_schema` fields (guard against corrupt data)

No additional query needed — the batch resolution query already filters active, non-deleted skills. Add a structural validation check on the resolved definition before injecting into tools.

### 2.9 Phase 2 Considerations (Not in This Build)

These items are out of scope for the initial build but should be planned:

#### 2.9.1 Cache layer for skill resolution

The `resolveSkillsForAgent` path runs on every agent execution and is latency-sensitive. Phase 2 should add:

- **In-memory LRU cache** keyed by `(orgId, subaccountId, slug)` with 60s TTL
- **Cache invalidation** on skill create/update/delete (clear relevant keys)
- **Fallback:** On cache miss, execute the batch query as normal

The batch resolution pattern (section 2.2.2) already reduces query count from N to 1-2, so caching is an optimisation rather than a requirement.

#### 2.9.2 Hard delete / archival strategy

Currently, soft-deleted skills retain their slug uniqueness constraint (via `WHERE deleted_at IS NULL` partial indexes). Over time:

- Slug namespace is not permanently consumed (partial indexes exclude deleted rows)
- Table size grows unboundedly

Phase 2 options:
- **Periodic purge job:** Move soft-deleted rows older than 90 days to a `skills_archive` table
- **Hard delete with grace period:** After 30 days in soft-deleted state, permanently delete
- **No action needed short-term:** Partial indexes mean slug reuse works immediately after soft delete. Table bloat is a long-term concern, not an immediate one.

---

## 3. Feature B: Comprehensive Skill Version History

### 3.1 Version Helper Service

**New file:** `server/services/skillVersioningHelper.ts`

A focused service that encapsulates the "write a new `skill_versions` row" logic. Every code path that mutates a skill calls this helper instead of duplicating the version-insert SQL.

```typescript
/** Structured change type for version history filtering and audit clarity. */
export type VersionChangeType = 'create' | 'update' | 'merge' | 'restore' | 'deactivate';

export interface WriteVersionParams {
  /** Set ONE of these to link the version to the correct skill. */
  systemSkillId?: string;
  skillId?: string;

  /** Snapshot of the skill state AFTER the mutation. */
  name: string;
  description?: string | null;
  definition: object;
  instructions?: string | null;

  /** Structured type of the change — enables filtering and analytics. */
  changeType: VersionChangeType;

  /** Human-readable description of what changed. */
  changeSummary: string;

  /** User who authored this change (null for system/automated). */
  authoredBy?: string | null;

  /** Optional idempotency key. When provided, duplicate writes with the same
   *  key for the same skill are silently skipped (ON CONFLICT DO NOTHING).
   *  Use for retry-prone paths: analyser execute, restore, bulk operations. */
  idempotencyKey?: string;

  /** Drizzle transaction handle. REQUIRED — all versioned writes MUST run
   *  inside the caller's transaction for atomicity with the skill mutation.
   *  Invariant: if the skill update succeeds but the version write fails,
   *  the transaction rolls back both. */
  tx: OrgScopedTx;
}

export const skillVersioningHelper = {
  /**
   * Append a new version row. Auto-increments versionNumber using
   * SELECT ... FOR UPDATE to prevent concurrent race conditions.
   *
   * Concurrency strategy:
   * 1. SELECT MAX(version_number) ... FOR UPDATE locks existing rows for this
   *    skill within the transaction, serialising concurrent version writes.
   * 2. A UNIQUE constraint on (COALESCE(system_skill_id, skill_id), version_number)
   *    acts as a safety net — if a race somehow slips through, the insert fails
   *    with a unique violation rather than creating duplicate version numbers.
   * 3. When idempotencyKey is provided, ON CONFLICT (skill ref, idempotency_key)
   *    DO NOTHING prevents duplicate writes on retries.
   *
   * Returns the created SkillVersion row (or null if idempotency key hit).
   */
  async writeVersion(params: WriteVersionParams): Promise<SkillVersion | null> {
    const runner = params.tx;
    const refColumn = params.systemSkillId
      ? skillVersions.systemSkillId
      : skillVersions.skillId;
    const refId = params.systemSkillId ?? params.skillId;

    // Get next version number with row-level lock to prevent race conditions.
    // FOR UPDATE locks all matching rows for this skill, serialising concurrent
    // version writes within overlapping transactions.
    const [maxRow] = await runner.execute(
      sql`SELECT COALESCE(MAX(version_number), 0) AS max_version
          FROM skill_versions
          WHERE ${refColumn} = ${refId}
          FOR UPDATE`
    );
    const nextVersion = ((maxRow as any)?.max_version ?? 0) + 1;

    // Insert with ON CONFLICT guard for idempotency when key is provided
    if (params.idempotencyKey) {
      const result = await runner.execute(
        sql`INSERT INTO skill_versions (
              system_skill_id, skill_id, version_number, name, description,
              definition, instructions, change_type, change_summary,
              authored_by, idempotency_key,
              simulation_pass_count, simulation_total_count
            ) VALUES (
              ${params.systemSkillId ?? null}, ${params.skillId ?? null},
              ${nextVersion}, ${params.name}, ${params.description ?? null},
              ${JSON.stringify(params.definition)}::jsonb, ${params.instructions ?? null},
              ${params.changeType}, ${params.changeSummary},
              ${params.authoredBy ?? null}, ${params.idempotencyKey},
              0, 0
            )
            ON CONFLICT (COALESCE(system_skill_id, skill_id), idempotency_key)
            DO NOTHING
            RETURNING *`
      );
      return (result.rows?.[0] as SkillVersion) ?? null;
    }

    const [version] = await runner
      .insert(skillVersions)
      .values({
        systemSkillId: params.systemSkillId ?? undefined,
        skillId: params.skillId ?? undefined,
        versionNumber: nextVersion,
        name: params.name,
        description: params.description ?? null,
        definition: params.definition as Record<string, unknown>,
        instructions: params.instructions ?? null,
        changeType: params.changeType,
        changeSummary: params.changeSummary,
        authoredBy: params.authoredBy ?? null,
        idempotencyKey: params.idempotencyKey ?? null,
        simulationPassCount: 0,
        simulationTotalCount: 0,
      })
      .returning();

    return version!;
  },
};
```

This helper is intentionally thin -- it owns only the version-number increment and row insert. It does NOT own the skill update itself; callers do that.

**Concurrency invariants:**

1. **Transaction required:** `tx` is mandatory. Every caller MUST pass the same transaction used for the skill mutation. If the version write fails, the skill mutation rolls back too.
2. **FOR UPDATE lock:** The MAX query locks existing version rows for the skill, preventing two concurrent transactions from computing the same `nextVersion`.
3. **Unique constraint safety net:** `skill_versions_version_uniq` on `(COALESCE(system_skill_id, skill_id), version_number)` catches any edge case where the lock is insufficient.
4. **Idempotency:** For retry-prone paths (analyser, restore), callers pass an `idempotencyKey` (e.g. `${jobId}:${skillId}:create`). The UNIQUE constraint on `(COALESCE(system_skill_id, skill_id), idempotency_key)` + ON CONFLICT DO NOTHING prevents version spam on retries.

**Drizzle schema update** (`server/db/schema/skillVersions.ts`): Add the two new columns:

```typescript
changeType: text('change_type').notNull(),     // 'create' | 'update' | 'merge' | 'restore' | 'deactivate'
idempotencyKey: text('idempotency_key'),        // optional, for retry dedup
```

**Why a separate helper instead of extending `skillStudioService.saveSkillVersion`:**

`saveSkillVersion` currently does two things: (1) insert a version row, and (2) update the live skill definition. The new write paths only need (1) because they update the skill themselves via their own service method. Extracting (1) into a reusable helper avoids coupling these paths to the Skill Studio's update logic.

### 3.2 System Skill Write Paths

**File:** `server/services/systemSkillService.ts`

#### 3.2.1 `createSystemSkill`

After the `insert(...).returning()` succeeds, call:

```typescript
await skillVersioningHelper.writeVersion({
  systemSkillId: row.id,
  name: row.name,
  description: row.description,
  definition: row.definition as object,
  instructions: row.instructions,
  changeType: 'create',
  changeSummary: 'System skill created',
  authoredBy: null,   // system-initiated
  tx,                  // MUST be inside a transaction
});
```

The version write uses the same `tx` as the create so it is atomic. If the caller does not currently use a transaction, wrap the create + version write in one.

#### 3.2.2 `updateSystemSkill`

After the `update(...).returning()` succeeds, call:

```typescript
await skillVersioningHelper.writeVersion({
  systemSkillId: row.id,
  name: row.name,
  description: row.description ?? null,
  definition: row.definition as object,
  instructions: row.instructions,
  changeType: 'update',
  changeSummary: 'System skill updated',
  authoredBy: null,
  tx,                  // MUST be inside a transaction
});
```

Note: both methods already accept `opts: WithTx = {}`, so passing `tx` through requires no signature change.

### 3.3 Org/Subaccount Skill Write Paths

**File:** `server/services/skillService.ts`

#### 3.3.1 `createSkill` (existing org skills)

After the `insert(...).returning()` succeeds (line ~141), add:

```typescript
await skillVersioningHelper.writeVersion({
  skillId: skill.id,
  name: skill.name,
  description: skill.description,
  definition: skill.definition as object,
  instructions: skill.instructions,
  changeType: 'create',
  changeSummary: 'Org skill created',
  authoredBy: userId ?? null,
  tx,                  // MUST be inside a transaction
});
```

**Change:** Add optional `userId` parameter to `createSkill` signature so the route can pass `req.user.id` for `authoredBy`. This is a non-breaking change (default `null`). Wrap the insert + version write in a transaction if not already transactional.

#### 3.3.2 `updateSkill` (existing org skills)

After the `update(...).returning()` succeeds (line ~193), add:

```typescript
await skillVersioningHelper.writeVersion({
  skillId: updated.id,
  name: updated.name,
  description: updated.description,
  definition: updated.definition as object,
  instructions: updated.instructions,
  changeType: 'update',
  changeSummary: 'Org skill updated',
  authoredBy: userId ?? null,
  tx,                  // MUST be inside a transaction
});
```

#### 3.3.3 `createSubaccountSkill` (new)

Same pattern -- write v1 after insert:

```typescript
await skillVersioningHelper.writeVersion({
  skillId: skill.id,
  name: skill.name,
  description: skill.description,
  definition: skill.definition as object,
  instructions: skill.instructions,
  changeType: 'create',
  changeSummary: 'Subaccount skill created',
  authoredBy: userId ?? null,
  tx,                  // MUST be inside a transaction
});
```

#### 3.3.4 `updateSubaccountSkill` (new)

Same pattern -- write new version after update:

```typescript
await skillVersioningHelper.writeVersion({
  skillId: updated.id,
  name: updated.name,
  description: updated.description,
  definition: updated.definition as object,
  instructions: updated.instructions,
  changeType: 'update',
  changeSummary: 'Subaccount skill updated',
  authoredBy: userId ?? null,
  tx,                  // MUST be inside a transaction
});
```

#### 3.3.5 User ID threading

Add optional `userId?: string` to the existing `createSkill` and `updateSkill` method signatures. Pass from the route handler: `req.user.id`. Default to `null` for backwards compatibility with existing callers that do not pass it.

### 3.4 Skill Analyser Write Paths

**File:** `server/services/skillAnalyzerService.ts` -- `executeApproved` function (line ~723)

#### 3.4.1 DISTINCT path (create new system skill) -- line ~916

After `systemSkillService.createSystemSkill(...)` returns `created`, add inside the transaction:

```typescript
await skillVersioningHelper.writeVersion({
  systemSkillId: created.id,
  name: created.name,
  description: created.description,
  definition: created.definition as object,
  instructions: created.instructions,
  changeType: 'create',
  changeSummary: `Created by Skill Analyzer job ${jobId}`,
  authoredBy: params.userId,
  idempotencyKey: `sa:${jobId}:${created.id}:create`,  // prevents duplicates on retry
  tx,
});
```

#### 3.4.2 PARTIAL_OVERLAP / IMPROVEMENT path (update existing) -- line ~841

After `systemSkillService.updateSystemSkill(...)` returns, add inside the transaction:

```typescript
// The merge was applied -- read the final state from the merge object
await skillVersioningHelper.writeVersion({
  systemSkillId: result.matchedSkillId!,
  name: merge.name,
  description: merge.description,
  definition: merge.definition as object,
  instructions: merge.instructions,
  changeType: 'merge',
  changeSummary: `${result.classification} merge from Skill Analyzer job ${jobId}`,
  authoredBy: params.userId,
  idempotencyKey: `sa:${jobId}:${result.matchedSkillId}:merge`,  // prevents duplicates on retry
  tx,
});
```

Note: the `tx` is already available from the `db.transaction(async (tx) => { ... })` wrapper on both paths.

### 3.5 Config Backup Restore Write Path

**File:** `server/services/configBackupService.ts` -- `restoreSkillAnalyzerEntities` function (line ~86)

#### 3.5.1 Skills reverted to snapshot

Inside the `for (const entity of skillEntities)` loop (line ~103), after the `tx.update(systemSkills).set(...)` call succeeds, add:

```typescript
await skillVersioningHelper.writeVersion({
  systemSkillId: entity.entityId,
  name: snapshot.name as string,
  description: (snapshot.description as string) ?? null,
  definition: snapshot.definition as object,
  instructions: (snapshot.instructions as string) ?? null,
  changeType: 'restore',
  changeSummary: `Reverted to backup snapshot`,
  authoredBy: null,  // system-initiated restore
  idempotencyKey: `restore:${backupId}:${entity.entityId}:revert`,  // prevents duplicates on retry
  tx,
});
```

#### 3.5.2 Skills deactivated (created after backup)

Inside the deactivation loop (line ~133), after the `tx.update(systemSkills).set({ isActive: false })` call, read the current skill state and write a version:

```typescript
// Read the current skill state for the version snapshot
const [current] = await tx.select().from(systemSkills).where(eq(systemSkills.id, skill.id));
if (current) {
  await skillVersioningHelper.writeVersion({
    systemSkillId: skill.id,
    name: current.name,
    description: current.description,
    definition: current.definition as object,
    instructions: current.instructions,
    changeType: 'deactivate',
    changeSummary: 'Deactivated during backup restore (created after backup)',
    authoredBy: null,
    idempotencyKey: `restore:${backupId}:${skill.id}:deactivate`,  // prevents duplicates on retry
    tx,
  });
}
```

Note: `tx` is the transaction handle passed to `restoreSkillAnalyzerEntities`. The version writes participate in the same transaction, so if the restore fails, no phantom version rows are created.

### 3.6 Skill Studio Adjustments

**File:** `server/services/skillStudioService.ts`

#### 3.6.1 `saveSkillVersion` (existing)

No change needed. This already writes to `skill_versions`. The new `skillVersioningHelper.writeVersion` is a separate entry point for non-Studio paths. The Studio continues to use its own `saveSkillVersion` which also updates the live skill definition.

#### 3.6.2 `listSkillsForStudio` (existing)

Currently supports `scope: 'system' | 'org'`. Add `'subaccount'` scope:

```typescript
if (scope === 'subaccount') {
  // subaccountId must be provided
  const rows = await db.execute<{...}>(sql`
    SELECT s.id, s.slug, s.name,
      (SELECT MAX(sv.created_at)::text FROM skill_versions sv WHERE sv.skill_id = s.id) AS last_version_at,
      0::int AS regression_count
    FROM skills s
    WHERE s.subaccount_id = ${subaccountId}
      AND s.deleted_at IS NULL
    ORDER BY s.name
  `);
  // ... map to SkillStudioListItem with scope: 'subaccount'
}
```

Add `subaccountId?: string` parameter to the function signature.

#### 3.6.3 `getSkillStudioContext` (existing)

Add `'subaccount'` to the scope type. The table lookup for subaccount scope uses the `skills` table (same as org scope), so the existing code path works -- the `scope` parameter just controls which FK column to join on for versions.

#### 3.6.4 Version history in Skill Studio UI

The Skill Studio UI already reads `skill_versions` to show revision history. By writing versions from all mutation paths, the history timeline automatically populates. No UI changes needed for the history display.

Each version row carries both a structured `changeType` and a human-readable `changeSummary`:

| `changeType` | `changeSummary` examples |
|--------------|--------------------------|
| `create` | "System skill created", "Org skill created", "Subaccount skill created", "Created by Skill Analyzer job {jobId}" |
| `update` | "System skill updated", "Org skill updated", "Subaccount skill updated", "Rollback to version {N}" (from `rollbackSkillVersion`) |
| `merge` | "PARTIAL_OVERLAP merge from Skill Analyzer job {jobId}", "IMPROVEMENT merge from Skill Analyzer job {jobId}" |
| `restore` | "Reverted to backup snapshot" |
| `deactivate` | "Deactivated during backup restore (created after backup)" |

The `changeType` field enables:
- **UI filtering:** Show only creates, or only restores
- **Analytics:** Count merge vs manual edits
- **Audit clarity:** Distinguish forward changes from rollbacks in version timeline

---

## 4. Feature C: Skill Analyser Backup/Restore UI

### 4.1 Job List Enhancements

**File:** `client/src/pages/SkillAnalyzerPage.tsx`

#### 4.1.1 Backup status on each job row

Currently, the job list shows `sourceType`, `candidateCount`, `comparisonCount`, `status`, and `createdAt`. Add a **backup status indicator** to each completed job.

**Data flow:** After fetching jobs from `/api/system/skill-analyser/jobs`, batch-fetch backup status for completed jobs. Two approaches:

**Preferred approach -- extend the job list API response:**

Add a new field to the `listJobs` response: for each job, include `backupStatus: 'none' | 'restorable' | 'restored'`.

**File:** `server/services/skillAnalyzerService.ts` -- `listJobs` function

```typescript
// After fetching jobs, batch-fetch backup info for all jobIds
const jobIds = jobs.map(j => j.id);
const backups = await db
  .select({
    sourceId: configBackups.sourceId,
    status: configBackups.status,
  })
  .from(configBackups)
  .where(and(
    inArray(configBackups.sourceId, jobIds),
    eq(configBackups.organisationId, organisationId),
  ));

const backupByJobId = new Map(backups.map(b => [b.sourceId, b.status]));

return jobs.map(j => ({
  ...j,
  backupStatus: backupByJobId.has(j.id)
    ? (backupByJobId.get(j.id) === 'active' ? 'restorable' : 'restored')
    : 'none',
}));
```

**UI rendering:**

```
[Badge] next to the status badge:
- 'restorable' → green dot + "Backup available"
- 'restored'   → amber dot + "Restored"
- 'none'       → no badge (job never executed or had no approved results)
```

#### 4.1.2 Updated `JobSummary` interface

```typescript
interface JobSummary {
  id: string;
  sourceType: 'paste' | 'upload' | 'github' | 'download';
  status: string;
  progressPct: number;
  candidateCount: number | null;
  exactDuplicateCount: number | null;
  comparisonCount: number | null;
  createdAt: string;
  completedAt: string | null;
  backupStatus: 'none' | 'restorable' | 'restored';  // NEW
}
```

### 4.2 Completed Job Detail View

**File:** `client/src/components/skill-analyzer/SkillAnalyzerWizard.tsx`

#### Current behaviour

When a user clicks a completed job in the list, the wizard opens with `initialJobId`. The `resolveStep` function sends it to `'results'` (since `job.status === 'completed'`). The results step shows the classification + action UI. From there the user can click "Next" to reach the execute step.

#### Problem

The execute step (`SkillAnalyzerExecuteStep`) currently requires `executeResult` in React state. When re-entering a past job, `executeResult` is `null`, so the execute step shows the "ready to execute" UI even if the job was already executed.

#### Solution

Detect whether the job has already been executed by checking result rows. If any result has `executionResult !== null`, the job has been executed.

**Changes to `SkillAnalyzerWizard.tsx`:**

1. After `loadJob` fetches job + results, derive `wasExecuted`:

```typescript
const wasExecuted = results.some(r => r.executionResult != null);
```

2. When `wasExecuted` is true and the user navigates to the execute step, reconstruct the `executeResult` from the result rows:

```typescript
if (wasExecuted) {
  const created = results.filter(r => r.executionResult === 'created').length;
  const updated = results.filter(r => r.executionResult === 'updated').length;
  const failed = results.filter(r => r.executionResult === 'failed').length;
  const errors = results
    .filter(r => r.executionResult === 'failed' && r.executionError)
    .map(r => ({ resultId: r.id, error: r.executionError! }));

  setExecuteResult({ created, updated, failed, errors, backupId: null });
}
```

3. The `backupId` is not available from the results API. Fetch it from the backup API:

```typescript
const backupRes = await api.get(`/api/system/skill-analyser/jobs/${jobId}/backup`);
const backup = backupRes.data.backup;
if (backup) {
  setExecuteResult(prev => prev ? { ...prev, backupId: backup.status === 'active' ? backup.id : null } : prev);
}
```

**Changes to `SkillAnalyzerExecuteStep.tsx`:**

The restore button currently checks `canRestore = hasChanges && executeResult.backupId && !restoreResult`. This will now work correctly because `backupId` is populated from the API.

Add a check: if `backup.status === 'restored'`, show the restore result instead of the restore button. Fetch the backup status on mount:

```typescript
useEffect(() => {
  if (executeResult?.backupId) return; // already have it from in-session execute
  // Fetch backup status from API
  api.get(`/api/system/skill-analyser/jobs/${job.id}/backup`).then(res => {
    const backup = res.data.backup;
    if (backup?.status === 'restored') {
      setRestoreResult({ skillsReverted: -1, skillsDeactivated: -1, agentsReverted: -1 });
      // -1 sentinel means "already restored, exact counts unknown"
    }
  });
}, [job.id]);
```

Better alternative: extend the backup GET response to include `restoredAt` and the restore stats (if available). This avoids sentinel values. **Decision: extend the backup response** -- the `configBackupService.getBackupBySourceId` already returns `restoredAt`, so the client can check `backup.status === 'restored'` and show "Changes were reverted on {date}" without needing counts.

### 4.3 Restore Flow from Job List

The restore flow from the job list follows the same path as clicking the job and navigating to the execute step:

1. User clicks a completed+executed job in the list
2. Wizard opens, `loadJob` fetches results and reconstructs execute state
3. User sees the execute step with execution summary
4. If backup is `active`, the "Revert Changes" button is shown
5. User clicks "Revert Changes", confirmation dialog appears
6. On confirm, `POST /api/system/skill-analyser/jobs/:jobId/restore` is called
7. On success, the UI shows the restore result and the button disappears

**After restore, updating the job list:** When the user closes the wizard after a restore, the job list reloads (existing `loadJobs()` in `useEffect`). The `backupStatus` for this job will now be `'restored'` since we fetch it from the API.

**No new API endpoints needed** -- the existing `GET /api/system/skill-analyser/jobs/:jobId/backup` and `POST /api/system/skill-analyser/jobs/:jobId/restore` endpoints are sufficient.

**Edge case: job was executed but had zero changes (phantom backup deleted).** The `executeApproved` function deletes the backup if `created === 0 && updated === 0` (line ~1000). In this case, `backupStatus` is `'none'` and no restore button is shown. This is correct behaviour.

---

## 5. Migration Strategy

### 5.1 Migration ordering

| Sequence | File | What it does |
|----------|------|-------------|
| `0118` | `0118_subaccount_skills.sql` | Add `subaccount_id` to `skills`, replace slug uniqueness indexes, add CHECK constraint |
| `0119` | `0119_subaccount_skill_permissions.sql` | Seed `subaccount.skills.view` and `subaccount.skills.manage` into `permissions` table |
| `0120` | `0120_skill_versions_integrity.sql` | Add `change_type`, `idempotency_key` columns + unique constraints to `skill_versions` |

Feature B now requires migration `0120` for new columns and constraints on `skill_versions`.

Feature C requires no schema migration -- it uses existing tables and endpoints.

#### 5.1.1 Migration 0120: skill_versions integrity

```sql
-- Add structured change type for filtering and audit clarity
ALTER TABLE skill_versions ADD COLUMN change_type TEXT;
-- Backfill existing rows (all from Skill Studio) as 'update'
UPDATE skill_versions SET change_type = 'update' WHERE change_type IS NULL;
-- Make NOT NULL after backfill
ALTER TABLE skill_versions ALTER COLUMN change_type SET NOT NULL;

-- Add idempotency key for retry-safe version writes
ALTER TABLE skill_versions ADD COLUMN idempotency_key TEXT;

-- Unique constraint: prevent duplicate version numbers per skill (safety net for FOR UPDATE lock)
CREATE UNIQUE INDEX skill_versions_version_uniq
  ON skill_versions (COALESCE(system_skill_id, skill_id), version_number);

-- Unique constraint: prevent duplicate idempotency keys per skill (retry dedup)
CREATE UNIQUE INDEX skill_versions_idempotency_uniq
  ON skill_versions (COALESCE(system_skill_id, skill_id), idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

**Backwards compatibility:** Existing rows get `change_type = 'update'` (safe default). `idempotency_key` is nullable so existing rows are unaffected. The `COALESCE` in the unique indexes correctly handles the dual-FK pattern (exactly one of `system_skill_id` or `skill_id` is set).

### 5.2 Backwards compatibility

- **All existing rows** have `subaccount_id = NULL`, which passes the new CHECK constraint.
- **The new partial indexes** cover the same uniqueness guarantees as the dropped `skills_slug_org_idx` for existing data (org skills where `subaccount_id IS NULL`).
- **No downtime required** -- the column addition is nullable, and the index changes are non-blocking.
- **Drizzle schema sync:** After the migration, run `npm run db:generate` to update the Drizzle schema snapshot. The Drizzle schema in `skills.ts` must be updated to include the new column before the migration runs.

### 5.3 Rollback plan

If the migration needs to be reverted:

```sql
-- Reverse of 0118
DROP INDEX IF EXISTS skills_slug_subaccount_uniq;
DROP INDEX IF EXISTS skills_slug_org_uniq;
DROP INDEX IF EXISTS skills_slug_system_uniq;
DROP INDEX IF EXISTS skills_subaccount_idx;
ALTER TABLE skills DROP CONSTRAINT IF EXISTS skills_tier_check;
ALTER TABLE skills DROP COLUMN IF EXISTS subaccount_id;
-- Recreate original index
CREATE UNIQUE INDEX skills_slug_org_idx ON skills (organisation_id, slug);
```

Note: rollback is only safe if no subaccount skills have been created. Once data exists with `subaccount_id IS NOT NULL`, rollback would lose data.

---

## 6. Implementation Chunks

### Chunk 1: Schema migration and Drizzle schema update

**Scope:** Migration file + Drizzle schema changes. No service/route changes.

**Files to create:**
- `migrations/0118_subaccount_skills.sql`
- `migrations/0119_subaccount_skill_permissions.sql`

**Files to modify:**
- `server/db/schema/skills.ts` -- add `subaccountId` column, update indexes in the table definition

**Dependencies:** None. Must be done first.

**Verification:** `npm run db:generate` succeeds, `npm run typecheck` passes.

---

### Chunk 2: Permission keys and seed data

**Scope:** Add new permission keys and update default permission set templates.

**Files to modify:**
- `server/lib/permissions.ts` -- add `SKILLS_VIEW` and `SKILLS_MANAGE` to `SUBACCOUNT_PERMISSIONS`, add to `ALL_PERMISSIONS`, update default templates

**Dependencies:** Chunk 1 (migration that seeds the permissions).

**Verification:** `npm run typecheck` passes. Permission keys are correctly typed.

---

### Chunk 3: Skill versioning helper + schema changes

**Scope:** Create the reusable version-write helper, add `change_type` and `idempotency_key` columns + unique constraints to `skill_versions`.

**Files to create:**
- `server/services/skillVersioningHelper.ts`
- `migrations/0120_skill_versions_integrity.sql`

**Files to modify:**
- `server/db/schema/skillVersions.ts` -- add `changeType`, `idempotencyKey` columns
- `server/config/limits.ts` -- add `MAX_TOTAL_SKILL_INSTRUCTIONS`, `MAX_SKILL_DEFINITION_SIZE`, `MAX_SKILLS_PER_SUBACCOUNT`

**Dependencies:** None (uses existing `skillVersions` schema).

**Verification:** `npm run db:generate` succeeds, `npm run typecheck` passes.

---

### Chunk 4: Wire versioning into system skill service

**Scope:** Add version writes to `createSystemSkill` and `updateSystemSkill`.

**Files to modify:**
- `server/services/systemSkillService.ts` -- import helper, add version writes

**Dependencies:** Chunk 3.

**Verification:** `npm run typecheck` passes. Manual test: create/update a system skill, check that `skill_versions` has new rows.

---

### Chunk 5: Wire versioning into org skill service

**Scope:** Add version writes to `createSkill` and `updateSkill`. Add `userId` parameter threading.

**Files to modify:**
- `server/services/skillService.ts` -- import helper, add version writes, add userId param
- `server/routes/skills.ts` -- pass `req.user.id` to createSkill/updateSkill

**Dependencies:** Chunk 3.

**Verification:** `npm run typecheck` passes. Manual test: create/update an org skill, check `skill_versions`.

---

### Chunk 6: Wire versioning into skill analyser

**Scope:** Add version writes to `executeApproved` for DISTINCT, PARTIAL_OVERLAP, and IMPROVEMENT paths.

**Files to modify:**
- `server/services/skillAnalyzerService.ts` -- import helper, add writes in executeApproved

**Dependencies:** Chunk 3.

**Verification:** `npm run typecheck` passes.

---

### Chunk 7: Wire versioning into config backup restore

**Scope:** Add version writes to `restoreSkillAnalyzerEntities`.

**Files to modify:**
- `server/services/configBackupService.ts` -- import helper, add writes in restore loop

**Dependencies:** Chunk 3.

**Verification:** `npm run typecheck` passes.

---

### Chunk 8: Subaccount skill service methods

**Scope:** Add CRUD methods for subaccount skills, modify `resolveSkillsForAgent` for three-tier batch resolution with instruction size guard, add `getSkillBySlugForSubaccount`, add skill count limit enforcement.

**Files to modify:**
- `server/services/skillService.ts` -- add new methods, rewrite resolve to batch pattern, add instruction size guard
- `server/services/systemSkillService.ts` -- add `getSkillsBySlugs` batch method, add slug overlap guard in `createSystemSkill`
- `server/config/limits.ts` -- reference limits added in Chunk 3

**Dependencies:** Chunk 1 (schema), Chunk 3 (versioning + limits).

**Verification:** `npm run typecheck` passes. Unit-testable: batch resolution precedence order, instruction size truncation, skill count limit.

---

### Chunk 9: Subaccount skill routes

**Scope:** Create route file, Zod schemas, register in index.

**Files to create:**
- `server/routes/subaccountSkills.ts`
- `server/schemas/subaccountSkills.ts`

**Files to modify:**
- `server/index.ts` -- register new route file

**Dependencies:** Chunk 2 (permissions), Chunk 8 (service methods).

**Verification:** `npm run typecheck` passes. Manual test: CRUD operations via API.

---

### Chunk 10: Runtime skill resolution (three-tier merge)

**Scope:** Pass `subaccountId` through in `agentExecutionService`.

**Files to modify:**
- `server/services/agentExecutionService.ts` -- pass `request.subaccountId` to `resolveSkillsForAgent`

**Dependencies:** Chunk 8 (three-tier resolution in service).

**Verification:** `npm run typecheck` passes. Existing agent runs still work (regression check).

---

### Chunk 11: Skill Studio adjustments

**Scope:** Add subaccount scope to `listSkillsForStudio` and `getSkillStudioContext`.

**Files to modify:**
- `server/services/skillStudioService.ts` -- add subaccount scope support

**Dependencies:** Chunk 1 (schema).

**Verification:** `npm run typecheck` passes.

---

### Chunk 12: Skill analyser UI -- backup status in job list

**Scope:** Extend `listJobs` API with `backupStatus`, update frontend.

**Files to modify:**
- `server/services/skillAnalyzerService.ts` -- extend `listJobs` to include backup status
- `client/src/pages/SkillAnalyzerPage.tsx` -- show backup badge

**Dependencies:** None.

**Verification:** `npm run build` passes. Job list shows backup badges.

---

### Chunk 13: Skill analyser UI -- persistent restore from completed job

**Scope:** Re-enter execute step for completed+executed jobs, fetch backup from API.

**Files to modify:**
- `client/src/components/skill-analyzer/SkillAnalyzerWizard.tsx` -- reconstruct executeResult from results
- `client/src/components/skill-analyzer/SkillAnalyzerExecuteStep.tsx` -- fetch backup status on mount, handle already-restored state

**Dependencies:** Chunk 12.

**Verification:** `npm run build` passes. Click a past completed job, see execution summary and restore button.

---

### Chunk 14: Frontend -- subaccount skills page

**Scope:** New page component, router registration, navigation link.

**Files to create:**
- `client/src/pages/SubaccountSkillsPage.tsx`

**Files to modify:**
- `client/src/App.tsx` -- add lazy-loaded route
- Subaccount admin navigation component -- add "Skills" link

**Dependencies:** Chunk 9 (routes available).

**Verification:** `npm run build` passes. Page renders, CRUD works.

---

### Chunk 15: Frontend -- skill picker subaccount support

**Scope:** Update SkillPickerSection to show subaccount skills when in subaccount context.

**Files to modify:**
- `client/src/components/SkillPickerSection.tsx` -- accept subaccountId, fetch from subaccount endpoint
- `client/src/pages/SubaccountAgentEditPage.tsx` -- pass subaccountId to skill picker

**Dependencies:** Chunk 9 (routes available), Chunk 14.

**Verification:** `npm run build` passes. Skill picker in SubaccountAgentEditPage shows subaccount skills.

---

### Chunk 16: Documentation updates

**Scope:** Update architecture.md, docs/capabilities.md, CLAUDE.md key files table.

**Files to modify:**
- `architecture.md` -- update Skill System section, add subaccount skills, update skill scoping table
- `docs/capabilities.md` -- add subaccount skills capability

**Dependencies:** All other chunks.

**Verification:** Manual review for accuracy.

---

## 7. Testing Considerations

### Feature A: Subaccount-Level Skills

**Schema integrity:**
- Creating a skill with `subaccountId` set but `organisationId` null should fail CHECK constraint
- Creating two skills with the same slug in the same subaccount should fail uniqueness
- Creating skills with the same slug in different subaccounts should succeed
- A subaccount skill can shadow an org skill slug
- A subaccount skill cannot shadow a system skill in the `skills` table (but system skills in `system_skills` are resolved separately and are already the final fallback)

**Service layer:**
- `listSubaccountSkills` returns system + org + subaccount skills
- `listSubaccountSkills` respects visibility cascade (org skill with visibility=none is hidden from subaccount viewers)
- `listSubaccountSkills` filters soft-deleted skills
- `getSkillBySlugForSubaccount` resolution order: subaccount -> org -> built-in -> system
- `getSkillBySlugForSubaccount` returns subaccount skill when both org and subaccount have same slug
- `createSubaccountSkill` sets `skillType: 'custom'`, `organisationId` from subaccount's org
- `deleteSubaccountSkill` sets `deletedAt` (soft delete), does not remove slug uniqueness conflict
- Config history is recorded for all subaccount skill CRUD

**Routes:**
- Permission check: subaccount user with `skills.manage` can CRUD
- Permission check: org admin with `agents.edit` can CRUD on any subaccount
- Permission check: subaccount user without `skills.manage` gets 403
- `resolveSubaccount` is called and rejects invalid subaccount IDs
- Zod validation rejects invalid slugs (must be `^[a-z0-9_]+$`)

**Runtime resolution:**
- Agent running in a subaccount resolves subaccount skills first
- Agent running in a subaccount falls back to org skills for unmatched slugs
- Agent running in a subaccount falls back to system skills for unmatched slugs
- `skillSlugs` array on `subaccountAgents` can reference a subaccount skill slug
- `allowedSkillSlugs` filtering still works with subaccount-resolved tool names
- Batch resolution returns same results as per-slug resolution (correctness check)
- Shadowing overrides visibility: subaccount skill wins even if org skill has `visibility = 'none'`

**Guardrails:**
- `createSubaccountSkill` rejects when skill count >= `MAX_SKILLS_PER_SUBACCOUNT` (200)
- `resolveSkillsForAgent` truncates instructions when total exceeds `MAX_TOTAL_SKILL_INSTRUCTIONS` (100K chars)
- `createSubaccountSkill` rejects definition payloads > 256 KB
- `systemSkillService.createSystemSkill` rejects slugs that exist in the `skills` table (slug overlap guard)
- `skillService.createSkill` (when `organisationId IS NULL`) rejects slugs that exist in `system_skills`

### Feature B: Skill Version History

**Versioning helper:**
- `writeVersion` auto-increments version numbers correctly
- `writeVersion` requires `tx` parameter — calling without a transaction is a type error
- `writeVersion` sets correct `changeType` for each mutation path
- `writeVersion` with `idempotencyKey` silently skips duplicate writes (ON CONFLICT DO NOTHING)

**Concurrency (critical):**
- Two concurrent updates to the same skill produce sequential version numbers (not duplicates)
- The unique constraint `skill_versions_version_uniq` rejects duplicate `(skill_ref, version_number)` pairs
- The unique constraint `skill_versions_idempotency_uniq` rejects duplicate `(skill_ref, idempotency_key)` pairs
- FOR UPDATE lock on MAX query serialises concurrent version writes within overlapping transactions

**Write path coverage:**
- `systemSkillService.createSystemSkill` produces v1 row with `changeType: 'create'`
- `systemSkillService.updateSystemSkill` produces new version with `changeType: 'update'`
- `skillService.createSkill` (org) produces v1 row with `changeType: 'create'`
- `skillService.updateSkill` (org) produces new version with `changeType: 'update'`
- `skillService.createSubaccountSkill` produces v1 row with `changeType: 'create'`
- `skillService.updateSubaccountSkill` produces new version with `changeType: 'update'`
- `executeApproved` DISTINCT path produces v1 row with `changeType: 'create'` and idempotencyKey
- `executeApproved` PARTIAL_OVERLAP/IMPROVEMENT path produces new version with `changeType: 'merge'` and idempotencyKey
- `configBackupService.restoreSkillAnalyzerEntities` produces version rows with `changeType: 'restore'` for reverts and `changeType: 'deactivate'` for deactivations, both with idempotencyKey

**Chronological correctness:**
- Versions for a given skill are numbered sequentially with no gaps
- Version `createdAt` timestamps are monotonically increasing per skill
- Skill Studio UI shows all versions in descending order

**Idempotency:**
- If `executeApproved` is called twice (retry), idempotencyKey prevents duplicate version rows
- If `restoreSkillAnalyzerEntities` is called twice, idempotencyKey prevents duplicate version rows
- Idempotency keys follow format: `sa:{jobId}:{skillId}:{action}` for analyser, `restore:{backupId}:{skillId}:{action}` for restore

### Feature C: Skill Analyser Backup/Restore UI

**Job list backup status:**
- Completed job with no execution shows `backupStatus: 'none'`
- Completed+executed job with backup shows `backupStatus: 'restorable'`
- Completed+executed+restored job shows `backupStatus: 'restored'`
- Job where execution had zero changes (backup deleted) shows `backupStatus: 'none'`

**Re-entering completed job:**
- Clicking a completed+not-executed job shows results step, then execute step with "Execute" button
- Clicking a completed+executed job shows results step, then execute step with execution summary
- Restore button appears when backup is `active`
- "Already restored" message appears when backup is `restored`
- After restoring, closing and reopening the job shows "restored" state

**Restore flow:**
- Restore button calls `POST /api/system/skill-analyser/jobs/:jobId/restore`
- On success, UI updates to show restore result
- On failure (already restored), error message is shown
- After restore, job list backup status updates on reload

### Cross-cutting

- `npm run typecheck` passes after all changes
- `npm run lint` passes
- `npm run build` (client) passes
- `npm test` passes (existing tests not broken)
- Existing org-level skill CRUD is unaffected (regression)
- Existing agent runs resolve skills correctly (regression)
- Existing Skill Studio version history is unaffected (regression)
