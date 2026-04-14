import { and, eq, ne, sql } from 'drizzle-orm';
import { db, type OrgScopedTx } from '../db/index.js';
import { systemSkills, type SystemSkill as SystemSkillRow } from '../db/schema/systemSkills.js';
import type { AnthropicTool } from './llmService.js';
import { isSkillVisibility, type SkillVisibility } from '../lib/skillVisibility.js';
import { isValidToolDefinitionShape } from '../../shared/skillParameters.js';
import { SKILL_HANDLERS } from './skillExecutor.js';
import { skillVersioningHelper, assertVersionOwnership, type VersionOpts } from './skillVersioningHelper.js';

// ---------------------------------------------------------------------------
// System Skill Service — DB-backed
// ---------------------------------------------------------------------------
// Source of truth: the `system_skills` Postgres table. The markdown files at
// server/skills/*.md are a seed source only — they are parsed by the Phase 0
// backfill script (scripts/backfill-system-skills.ts) into DB rows on first
// setup. Runtime reads and writes go through this service.
//
// Handler pairing: every row has a `handlerKey` that must resolve to a key in
// SKILL_HANDLERS (server/services/skillExecutor.ts). This invariant is enforced
// at three write-time gates — backfill script, createSystemSkill, and the
// analyzer execute gate — and at one boot-time gate: validateSystemSkillHandlers.
// See docs/skill-analyzer-v2-spec.md §5.5 for the full contract.
// ---------------------------------------------------------------------------

/** Public shape returned to callers. Preserves the legacy interface the
 *  file-based service exposed: callers see `id` (UUID from the DB row),
 *  `slug`, `name`, `description`, `isActive`, `visibility`, `definition`,
 *  `instructions` — the same property names as before. */
export interface SystemSkill {
  id: string;
  slug: string;
  name: string;
  description: string;
  isActive: boolean;
  visibility: SkillVisibility;
  definition: AnthropicTool;
  instructions: string | null;
}

/** Optional transaction handle — when provided, the method runs against the
 *  transaction instead of the module-level `db`. Standard Drizzle idiom for
 *  atomic multi-statement sequences (see docs/skill-analyzer-v2-spec.md §8.1). */
export interface WithTx {
  tx?: OrgScopedTx;
}

// ---------------------------------------------------------------------------
// Row → public shape mapping
// ---------------------------------------------------------------------------

function toPublic(row: SystemSkillRow): SystemSkill {
  // The schema stores `visibility` as plain text with app-layer enforcement
  // of the 'none' | 'basic' | 'full' cascade. Validate once at the service
  // boundary so downstream consumers can trust the union type.
  const visibility: SkillVisibility = isSkillVisibility(row.visibility)
    ? row.visibility
    : 'none';
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? '',
    isActive: row.isActive,
    visibility,
    definition: row.definition as AnthropicTool,
    instructions: row.instructions ?? null,
  };
}

// ---------------------------------------------------------------------------
// Write-time validators
// ---------------------------------------------------------------------------

function assertHandlerRegistered(handlerKey: string): void {
  if (!(handlerKey in SKILL_HANDLERS)) {
    throw {
      statusCode: 400,
      message: `No handler registered for skill '${handlerKey}'. Add an entry to SKILL_HANDLERS in server/services/skillExecutor.ts before creating this row.`,
    };
  }
}

function assertValidDefinition(definition: unknown): void {
  if (!isValidToolDefinitionShape(definition)) {
    throw {
      statusCode: 400,
      message: 'definition must be an Anthropic tool-definition object with name, description, and input_schema',
    };
  }
}

function assertValidVisibility(visibility: unknown): asserts visibility is SkillVisibility {
  if (!isSkillVisibility(visibility)) {
    throw { statusCode: 400, message: 'visibility must be one of: none, basic, full' };
  }
}

// ---------------------------------------------------------------------------
// Create / update input shapes
// ---------------------------------------------------------------------------

export interface CreateSystemSkillInput {
  slug: string;
  handlerKey: string;
  name: string;
  description: string;
  definition: AnthropicTool;
  instructions?: string | null;
  visibility?: SkillVisibility;
  isActive?: boolean;
}

export interface UpdateSystemSkillPatch {
  name?: string;
  description?: string;
  definition?: AnthropicTool;
  instructions?: string | null;
  visibility?: SkillVisibility;
  isActive?: boolean;
  // Note: slug and handlerKey are intentionally not patchable — the
  // handlerKey = slug invariant is locked at create time. See §5.5.
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const systemSkillService = {
  /** No-op façade preserved for callers that imported the legacy name. The
   *  in-memory cache is gone — all reads hit the DB directly. Kept as an
   *  export so existing call sites compile unchanged. */
  invalidateCache(): void {
    // intentionally empty
  },

  /** Return all system skill rows regardless of isActive or visibility.
   *  Used by the skill analyzer so incoming candidates can be dedup-checked
   *  against the full library (including retired rows). */
  async listSkills(): Promise<SystemSkill[]> {
    const rows = await db.select().from(systemSkills).orderBy(systemSkills.name);
    return rows.map(toPublic);
  },

  /** Skills with `isActive = true`. Inactive rows are hidden but still live
   *  in the library (e.g. for dedup in the analyzer). */
  async listActiveSkills(): Promise<SystemSkill[]> {
    const rows = await db
      .select()
      .from(systemSkills)
      .where(eq(systemSkills.isActive, true))
      .orderBy(systemSkills.name);
    return rows.map(toPublic);
  },

  /** Skills that are both active AND visible to org/subaccount level
   *  (visibility !== 'none'). The caller is responsible for stripping the
   *  body via stripBodyForBasic() when visibility === 'basic'. */
  async listVisibleSkills(): Promise<SystemSkill[]> {
    const rows = await db
      .select()
      .from(systemSkills)
      .where(and(eq(systemSkills.isActive, true), ne(systemSkills.visibility, 'none')))
      .orderBy(systemSkills.name);
    return rows.map(toPublic);
  },

  /** Strip the body fields from a system skill so a 'basic' viewer only
   *  sees name + description + visibility (no instructions or tool definition).
   *  Pure helper — does not touch the DB. */
  stripBodyForBasic(skill: SystemSkill): SystemSkill {
    return {
      ...skill,
      instructions: null,
      definition: {
        name: skill.definition.name,
        description: skill.definition.description,
        input_schema: { type: 'object', properties: {}, required: [] },
      } as AnthropicTool,
    };
  },

  /** Get a skill by DB UUID. Throws 404 if not found. Note: the legacy
   *  file-based service keyed `getSkill(id)` by slug because id and slug
   *  were aliases. The DB-backed version is strictly UUID-keyed — callers
   *  that want slug lookup should use `getSkillBySlug`. The single existing
   *  caller (`server/routes/systemSkills.ts`) has been rewired accordingly. */
  async getSkill(id: string): Promise<SystemSkill> {
    const rows = await db
      .select()
      .from(systemSkills)
      .where(eq(systemSkills.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) throw { statusCode: 404, message: 'System skill not found' };
    return toPublic(row);
  },

  /** Get a skill by slug. Returns null when the skill is missing OR inactive
   *  — matches the legacy behaviour that filtered inactive rows out of the
   *  slug-lookup path. Use listSkills / listActiveSkills for queries that
   *  need visibility into inactive rows. */
  async getSkillBySlug(slug: string): Promise<SystemSkill | null> {
    const rows = await db
      .select()
      .from(systemSkills)
      .where(eq(systemSkills.slug, slug))
      .limit(1);
    const row = rows[0];
    if (!row || !row.isActive) return null;
    return toPublic(row);
  },

  /** Admin-facing slug lookup — unlike getSkillBySlug this does NOT filter
   *  inactive rows. Used by the system-admin GET /api/system/skills/:id
   *  route so admins can still view and manage retired skills. */
  async getSkillBySlugIncludingInactive(slug: string): Promise<SystemSkill | null> {
    const rows = await db
      .select()
      .from(systemSkills)
      .where(eq(systemSkills.slug, slug))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return toPublic(row);
  },

  /** Update the cascade visibility on a skill by slug. No more markdown
   *  frontmatter rewriting — the DB row is the source of truth now. */
  async updateSkillVisibility(slug: string, visibility: SkillVisibility): Promise<SystemSkill> {
    assertValidVisibility(visibility);
    const rows = await db
      .update(systemSkills)
      .set({ visibility, updatedAt: new Date() })
      .where(eq(systemSkills.slug, slug))
      .returning();
    const row = rows[0];
    if (!row) throw { statusCode: 404, message: 'System skill not found' };
    return toPublic(row);
  },

  /** Resolve an array of system skill slugs into Anthropic tool definitions
   *  and prompt instructions. Used by the agent execution path to hydrate a
   *  running agent with its configured system skills. */
  async resolveSystemSkills(
    skillSlugs: string[],
  ): Promise<{ tools: AnthropicTool[]; instructions: string[] }> {
    if (!skillSlugs || skillSlugs.length === 0) return { tools: [], instructions: [] };

    const tools: AnthropicTool[] = [];
    const instructions: string[] = [];

    // Single round-trip batch fetch — avoid an N+1 over getSkillBySlug.
    const rows = await db
      .select()
      .from(systemSkills)
      .where(and(eq(systemSkills.isActive, true), sql`${systemSkills.slug} = ANY(${skillSlugs})`));

    // Preserve caller order by indexing into a slug-keyed map.
    const bySlug = new Map(rows.map((r) => [r.slug, r]));
    for (const slug of skillSlugs) {
      const row = bySlug.get(slug);
      if (!row) continue;
      const def = row.definition as AnthropicTool;
      tools.push({
        name: def.name,
        description: def.description,
        input_schema: def.input_schema,
      });
      if (row.instructions) instructions.push(row.instructions);
    }

    return { tools, instructions };
  },

  /** Create a new system skill row. `handlerKey` must equal `slug` and must
   *  resolve to a key in SKILL_HANDLERS — these are the Phase 0 write-time
   *  gates against the "data refers to code" drift that opens the moment
   *  skill rows become DB-editable. */
  async createSystemSkill(
    input: CreateSystemSkillInput,
    opts: WithTx & VersionOpts = {},
  ): Promise<SystemSkill> {
    if (opts.skipVersionWrite) assertVersionOwnership(opts);

    if (input.handlerKey !== input.slug) {
      throw {
        statusCode: 400,
        message: 'handlerKey must equal slug — the invariant is locked at create time (see spec §5.5)',
      };
    }
    assertHandlerRegistered(input.handlerKey);
    assertValidDefinition(input.definition);
    if (input.visibility !== undefined) assertValidVisibility(input.visibility);

    // Ensure atomicity: skill create + version write in the same transaction.
    const doCreate = async (tx: OrgScopedTx): Promise<SystemSkill> => {
      // Cross-table slug guard: prevent slug collisions between system_skills and skills tables
      const [conflict] = await tx.execute(
        sql`SELECT 1 FROM skills WHERE slug = ${input.slug} AND deleted_at IS NULL FOR UPDATE`,
      );
      if (conflict) throw { statusCode: 409, message: 'Slug already exists in skills table' };

      const rows = await tx
        .insert(systemSkills)
        .values({
          slug: input.slug,
          handlerKey: input.handlerKey,
          name: input.name,
          description: input.description,
          definition: input.definition as unknown as object,
          instructions: input.instructions ?? null,
          visibility: input.visibility ?? 'none',
          isActive: input.isActive ?? true,
        })
        .returning();

      const row = rows[0];
      if (!row) throw { statusCode: 500, message: 'createSystemSkill: insert returned no rows' };

      if (!opts.skipVersionWrite) {
        await skillVersioningHelper.writeVersion({
          systemSkillId: row.id,
          name: row.name,
          description: row.description,
          definition: row.definition as object,
          instructions: row.instructions,
          changeType: 'create',
          changeSummary: 'System skill created',
          authoredBy: null,
          tx,
        });
      }

      return toPublic(row);
    };

    if (opts.tx) return doCreate(opts.tx);
    return db.transaction(doCreate);
  },

  /** Patch an existing system skill by DB UUID. Only the columns present in
   *  `patch` are touched — `slug` and `handlerKey` are NOT patchable (both
   *  are locked at create time to preserve the handlerKey = slug invariant). */
  async updateSystemSkill(
    id: string,
    patch: UpdateSystemSkillPatch,
    opts: WithTx & VersionOpts = {},
  ): Promise<SystemSkill> {
    if (opts.skipVersionWrite) assertVersionOwnership(opts);
    if (patch.definition !== undefined) assertValidDefinition(patch.definition);
    if (patch.visibility !== undefined) assertValidVisibility(patch.visibility);

    const doUpdate = async (tx: OrgScopedTx): Promise<SystemSkill> => {
      const update: Record<string, unknown> = { updatedAt: new Date() };
      if (patch.name !== undefined) update.name = patch.name;
      if (patch.description !== undefined) update.description = patch.description;
      if (patch.definition !== undefined) update.definition = patch.definition;
      if (patch.instructions !== undefined) update.instructions = patch.instructions;
      if (patch.visibility !== undefined) update.visibility = patch.visibility;
      if (patch.isActive !== undefined) update.isActive = patch.isActive;

      const rows = await tx
        .update(systemSkills)
        .set(update)
        .where(eq(systemSkills.id, id))
        .returning();

      const row = rows[0];
      if (!row) throw { statusCode: 404, message: 'System skill not found' };

      if (!opts.skipVersionWrite) {
        await skillVersioningHelper.writeVersion({
          systemSkillId: row.id,
          name: row.name,
          description: row.description ?? null,
          definition: row.definition as object,
          instructions: row.instructions,
          changeType: 'update',
          changeSummary: 'System skill updated',
          authoredBy: null,
          tx,
        });
      }

      return toPublic(row);
    };

    if (opts.tx) return doUpdate(opts.tx);
    return db.transaction(doUpdate);
  },
};
