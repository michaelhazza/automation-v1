import { eq, and, or, isNull, sql, inArray } from 'drizzle-orm';
import { db, type OrgScopedTx } from '../db/index.js';
import { skills } from '../db/schema/index.js';
import { configHistoryService } from './configHistoryService.js';
import { softDeleteByTarget } from './agentTestFixturesService.js';
import type { AnthropicTool } from './llmService.js';
import { systemSkillService } from './systemSkillService.js';
import {
  canViewContents as canViewContentsHelper,
  canManageSkill as canManageSkillHelper,
  isSkillVisibleToViewer,
  isSkillVisibility,
  type SkillTier,
  type SkillVisibility,
} from '../lib/skillVisibility.js';
import { skillVersioningHelper } from './skillVersioningHelper.js';
import { logger } from '../lib/logger.js';
import {
  MAX_TOTAL_SKILL_INSTRUCTIONS,
  MAX_SKILLS_PER_SUBACCOUNT,
} from '../config/limits.js';

// ---------------------------------------------------------------------------
// Skill Service — manages the skill library and resolves skills for agents
// ---------------------------------------------------------------------------

export const skillService = {
  /**
   * List skills available to an org (built-in + org-specific)
   */
  async listSkills(organisationId?: string) {
    const conditions = organisationId
      ? or(isNull(skills.organisationId), eq(skills.organisationId, organisationId))
      : isNull(skills.organisationId);

    return db
      .select()
      .from(skills)
      .where(and(conditions, eq(skills.isActive, true), isNull(skills.deletedAt)))
      .orderBy(skills.skillType, skills.name);
  },

  async getSkill(id: string, organisationId?: string) {
    // Skill must be active AND either a system skill or belonging to the caller's org
    const orgCondition = organisationId
      ? or(isNull(skills.organisationId), eq(skills.organisationId, organisationId))
      : isNull(skills.organisationId);

    const [skill] = await db
      .select()
      .from(skills)
      .where(and(eq(skills.id, id), orgCondition, eq(skills.isActive, true), isNull(skills.deletedAt)));
    if (!skill) throw { statusCode: 404, message: 'Skill not found' };
    return skill;
  },

  async getSkillBySlug(slug: string, organisationId?: string) {
    // Prefer org-specific skill, fall back to built-in
    const orgCondition = organisationId
      ? or(isNull(skills.organisationId), eq(skills.organisationId, organisationId))
      : isNull(skills.organisationId);

    const rows = await db
      .select()
      .from(skills)
      .where(and(eq(skills.slug, slug), eq(skills.isActive, true), orgCondition, isNull(skills.deletedAt)));

    if (organisationId) {
      const orgSkill = rows.find(s => s.organisationId === organisationId);
      if (orgSkill) return orgSkill;
    }
    const builtIn = rows.find(s => s.organisationId === null);
    return builtIn ?? null;
  },

  /**
   * Resolve a slug with subaccount fallback chain: subaccount -> org -> built-in -> system.
   */
  async getSkillBySlugForSubaccount(
    slug: string,
    organisationId: string,
    subaccountId: string,
  ): Promise<typeof skills.$inferSelect | null> {
    const rows = await db
      .select()
      .from(skills)
      .where(and(
        eq(skills.slug, slug),
        eq(skills.isActive, true),
        isNull(skills.deletedAt),
        or(
          and(eq(skills.subaccountId, subaccountId), eq(skills.organisationId, organisationId)),
          and(eq(skills.organisationId, organisationId), isNull(skills.subaccountId)),
          and(isNull(skills.organisationId), isNull(skills.subaccountId)),
        ),
      ));

    // Precedence: subaccount > org > built-in
    const subaccount = rows.find(s => s.subaccountId === subaccountId);
    if (subaccount) return subaccount;
    const org = rows.find(s => s.organisationId === organisationId && !s.subaccountId);
    if (org) return org;
    const builtIn = rows.find(s => !s.organisationId && !s.subaccountId);
    return builtIn ?? null;
  },

  /**
   * Resolve an array of skill slugs into Anthropic tool definitions + prompt instructions.
   * Batch resolution: single query for all slugs, then in-memory precedence.
   */
  async resolveSkillsForAgent(
    skillSlugs: string[],
    organisationId: string,
    subaccountId?: string,
  ): Promise<{ tools: AnthropicTool[]; instructions: string[]; truncated: boolean }> {
    if (!skillSlugs || skillSlugs.length === 0) return { tools: [], instructions: [], truncated: false };

    // Batch-fetch all matching skills across tiers in one query
    const candidates = await db
      .select()
      .from(skills)
      .where(and(
        inArray(skills.slug, skillSlugs),
        isNull(skills.deletedAt),
        eq(skills.isActive, true),
        or(
          subaccountId ? and(eq(skills.subaccountId, subaccountId), eq(skills.organisationId, organisationId)) : sql`false`,
          and(eq(skills.organisationId, organisationId), isNull(skills.subaccountId)),
          and(isNull(skills.organisationId), isNull(skills.subaccountId)),
        ),
      ));

    // Tier precedence: subaccount (3) > org (2) > built-in (1)
    function tierPrecedence(row: typeof skills.$inferSelect): number {
      if (subaccountId && row.subaccountId === subaccountId) return 3;
      if (row.organisationId && !row.subaccountId) return 2;
      return 1;
    }

    const bySlug = new Map<string, typeof skills.$inferSelect>();
    for (const row of candidates) {
      const existing = bySlug.get(row.slug);
      if (!existing || tierPrecedence(row) > tierPrecedence(existing)) {
        bySlug.set(row.slug, row);
      }
    }

    // Any slugs not found in skills table → fall back to systemSkillService (batch)
    const missingSlugs = skillSlugs.filter(s => !bySlug.has(s));
    const systemFallbacks = new Map<string, { definition: AnthropicTool; instructions: string | null }>();
    if (missingSlugs.length > 0) {
      try {
        const systemMap = await systemSkillService.getActiveBySlugsBatch(missingSlugs);
        for (const [slug, systemSkill] of systemMap) {
          if (systemSkill.visibility !== 'none') {
            systemFallbacks.set(slug, {
              definition: systemSkill.definition,
              instructions: systemSkill.instructions,
            });
          }
        }
      } catch (err) {
        logger.error('[skillService] System skill batch lookup failed', {
          missingSlugs,
          organisationId,
          subaccountId,
          error: String(err),
        });
        throw err;
      }
    }

    // Build tools and instructions in resolution-priority order (original slug array order)
    const tools: AnthropicTool[] = [];
    const allInstructions: string[] = [];

    for (const slug of skillSlugs) {
      const skill = bySlug.get(slug);
      if (skill) {
        const def = skill.definition as { name: string; description: string; input_schema: AnthropicTool['input_schema'] };
        if (def && def.name) {
          tools.push({
            name: def.name,
            description: def.description,
            input_schema: def.input_schema,
          });
        }
        if (skill.instructions) allInstructions.push(skill.instructions);
      } else {
        const fallback = systemFallbacks.get(slug);
        if (fallback) {
          tools.push({
            name: fallback.definition.name,
            description: fallback.definition.description,
            input_schema: fallback.definition.input_schema,
          });
          if (fallback.instructions) allInstructions.push(fallback.instructions);
        }
      }
    }

    // Instruction payload size guard
    const totalLength = allInstructions.reduce((sum, i) => sum + i.length, 0);
    if (totalLength > MAX_TOTAL_SKILL_INSTRUCTIONS) {
      logger.error('Skill instructions exceed limit — agent capability degraded', {
        totalLength,
        limit: MAX_TOTAL_SKILL_INSTRUCTIONS,
        skillCount: allInstructions.length,
      });
      let remaining = MAX_TOTAL_SKILL_INSTRUCTIONS;
      const truncatedInstructions: string[] = [];
      for (const instr of allInstructions) {
        if (remaining <= 0) break;
        const slice = instr.slice(0, remaining);
        truncatedInstructions.push(slice);
        remaining -= slice.length;
      }
      return { tools, instructions: truncatedInstructions, truncated: true };
    }

    return { tools, instructions: allInstructions, truncated: false };
  },

  /**
   * Create a custom skill for an org.
   */
  async createSkill(organisationId: string, data: {
    name: string;
    slug: string;
    description?: string;
    definition: object;
    instructions?: string;
  }, userId?: string) {
    const skill = await db.transaction(async (tx) => {
      // Cross-table slug guard when creating a built-in (org=null) skill
      if (!organisationId) {
        const [conflict] = await tx.execute(
          sql`SELECT 1 FROM system_skills WHERE slug = ${data.slug} AND deleted_at IS NULL FOR UPDATE`,
        );
        if (conflict) throw { statusCode: 409, message: 'Slug already exists in system_skills table' };
      }

      const [row] = await tx
        .insert(skills)
        .values({
          organisationId,
          name: data.name,
          slug: data.slug,
          description: data.description ?? null,
          skillType: 'custom',
          definition: data.definition,
          instructions: data.instructions ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      await skillVersioningHelper.writeVersion({
        skillId: row.id,
        name: row.name,
        description: row.description,
        definition: row.definition as object,
        instructions: row.instructions,
        changeType: 'create',
        changeSummary: 'Org skill created',
        authoredBy: userId ?? null,
        tx,
      });

      return row;
    });

    await configHistoryService.recordHistory({
      entityType: 'skill',
      entityId: skill.id,
      organisationId,
      snapshot: skill as unknown as Record<string, unknown>,
      changedBy: userId ?? null,
      changeSource: 'api',
    });

    return skill;
  },

  async updateSkill(id: string, organisationId: string, data: Partial<{
    name: string;
    description: string;
    definition: object;
    instructions: string;
    isActive: boolean;
    visibility: SkillVisibility;
  }>, userId?: string) {
    if (data.visibility !== undefined) {
      if (!isSkillVisibility(data.visibility)) {
        throw { statusCode: 400, message: 'visibility must be one of: none, basic, full' };
      }
    }

    const updated = await db.transaction(async (tx) => {
      // Read pre-mutation snapshot inside the transaction so history is atomic
      // with the update — a rollback won't leave a phantom history entry.
      const [existing] = await tx
        .select()
        .from(skills)
        .where(and(
          eq(skills.id, id),
          eq(skills.organisationId, organisationId),
          isNull(skills.subaccountId),
          isNull(skills.deletedAt),
        ));

      if (!existing) throw { statusCode: 404, message: 'Skill not found' };
      if (existing.skillType === 'built_in') throw { statusCode: 400, message: 'Cannot modify built-in skills' };

      await configHistoryService.recordHistory({
        entityType: 'skill',
        entityId: id,
        organisationId,
        snapshot: existing as unknown as Record<string, unknown>,
        changedBy: userId ?? null,
        changeSource: 'api',
      }, tx);

      const update: Record<string, unknown> = { updatedAt: new Date() };
      if (data.name !== undefined) update.name = data.name;
      if (data.description !== undefined) update.description = data.description;
      if (data.definition !== undefined) update.definition = data.definition;
      if (data.instructions !== undefined) update.instructions = data.instructions;
      if (data.isActive !== undefined) update.isActive = data.isActive;
      if (data.visibility !== undefined) update.visibility = data.visibility;

      const [row] = await tx.update(skills).set(update).where(and(
        eq(skills.id, id),
        eq(skills.organisationId, organisationId),
        isNull(skills.subaccountId),
      )).returning();

      if (row) {
        await skillVersioningHelper.writeVersion({
          skillId: row.id,
          name: row.name,
          description: row.description,
          definition: row.definition as object,
          instructions: row.instructions,
          changeType: 'update',
          changeSummary: 'Org skill updated',
          authoredBy: userId ?? null,
          tx,
        });
      }

      return row;
    });

    return updated;
  },

  /**
   * Update only the visibility cascade flag — used by the inline segmented
   * control on the skills list page. Separate from updateSkill so it can
   * have its own permission requirement and audit signal.
   */
  async updateSkillVisibility(id: string, organisationId: string, visibility: SkillVisibility) {
    if (!isSkillVisibility(visibility)) {
      throw { statusCode: 400, message: 'visibility must be one of: none, basic, full' };
    }
    const [existing] = await db
      .select()
      .from(skills)
      .where(and(eq(skills.id, id), eq(skills.organisationId, organisationId), isNull(skills.deletedAt)));
    if (!existing) throw { statusCode: 404, message: 'Skill not found' };
    if (existing.skillType === 'built_in') {
      throw { statusCode: 400, message: 'Built-in skill visibility is managed at the system tier' };
    }
    const [updated] = await db
      .update(skills)
      .set({ visibility, updatedAt: new Date() })
      .where(and(eq(skills.id, id), eq(skills.organisationId, organisationId)))
      .returning();
    return updated;
  },

  /**
   * Decorate a skill row for an API response, applying the cascade
   * visibility gate. Returns null when the skill is invisible to the
   * viewer's tier (caller must filter nulls out of list responses).
   *
   * Visibility states for lower-tier viewers:
   *   none  → returns null (filtered)
   *   basic → returns id + slug + name + description + visibility + flags
   *   full  → returns the full row
   *
   * Owner-tier viewers always receive the full row regardless of visibility.
   * Spec round 4.
   */
  decorateSkillForViewer(
    row: typeof skills.$inferSelect,
    viewer: { tier: SkillTier; hasManagePermission: boolean },
  ): (Record<string, unknown> & { id: string }) | null {
    const ownerTier: SkillTier = row.organisationId === null
      ? 'system'
      : row.subaccountId !== null
        ? 'subaccount'
        : 'organisation';
    const vis = { ownerTier, visibility: row.visibility };
    if (!isSkillVisibleToViewer(vis, viewer)) return null;
    const view = canViewContentsHelper(vis, viewer);
    const manage = canManageSkillHelper(vis, viewer);
    if (view) {
      return {
        ...row,
        canViewContents: true,
        canManageSkill: manage,
      };
    }
    // Basic mode — name + description only.
    return {
      id: row.id,
      organisationId: row.organisationId,
      name: row.name,
      slug: row.slug,
      description: row.description,
      skillType: row.skillType,
      isActive: row.isActive,
      visibility: row.visibility,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      canViewContents: false,
      canManageSkill: false,
    };
  },

  // ---------------------------------------------------------------------------
  // Subaccount skill CRUD
  // ---------------------------------------------------------------------------

  /** List skills visible within a subaccount: own + org + built-in, filtered by visibility cascade. */
  async listSubaccountSkills(organisationId: string, subaccountId: string) {
    const rows = await db
      .select()
      .from(skills)
      .where(and(
        or(
          // Subaccount's own skills
          eq(skills.subaccountId, subaccountId),
          // Org skills
          and(eq(skills.organisationId, organisationId), isNull(skills.subaccountId)),
          // Built-in skills
          and(isNull(skills.organisationId), isNull(skills.subaccountId)),
        ),
        eq(skills.isActive, true),
        isNull(skills.deletedAt),
      ))
      .orderBy(skills.skillType, skills.name);

    // Apply visibility cascade — subaccount viewer sees own skills in full,
    // org/system skills filtered by their visibility setting.
    const viewer = { tier: 'subaccount' as SkillTier, hasManagePermission: false };
    return rows
      .map((row) => skillService.decorateSkillForViewer(row, viewer))
      .filter((r): r is NonNullable<typeof r> => r !== null);
  },

  /** Get a single skill, validating it belongs to the given subaccount (or org/system). */
  async getSubaccountSkill(id: string, organisationId: string, subaccountId: string) {
    const [skill] = await db
      .select()
      .from(skills)
      .where(and(
        eq(skills.id, id),
        or(
          eq(skills.subaccountId, subaccountId),
          and(eq(skills.organisationId, organisationId), isNull(skills.subaccountId)),
          and(isNull(skills.organisationId), isNull(skills.subaccountId)),
        ),
        eq(skills.isActive, true),
        isNull(skills.deletedAt),
      ));
    if (!skill) throw { statusCode: 404, message: 'Skill not found' };

    // Apply visibility cascade for the single-row case
    const viewer = { tier: 'subaccount' as SkillTier, hasManagePermission: false };
    const decorated = skillService.decorateSkillForViewer(skill, viewer);
    if (!decorated) throw { statusCode: 404, message: 'Skill not found' };
    return decorated;
  },

  /** Create a skill scoped to a subaccount. */
  async createSubaccountSkill(organisationId: string, subaccountId: string, data: {
    name: string;
    slug: string;
    description?: string;
    definition: object;
    instructions?: string;
  }, userId?: string) {
    const skill = await db.transaction(async (tx) => {
      // Enforce per-subaccount skill count limit
      const [countRow] = await tx
        .select({ count: sql<number>`count(*)` })
        .from(skills)
        .where(and(eq(skills.subaccountId, subaccountId), isNull(skills.deletedAt)));
      if ((countRow?.count ?? 0) >= MAX_SKILLS_PER_SUBACCOUNT) {
        throw { statusCode: 400, message: `Subaccount skill limit (${MAX_SKILLS_PER_SUBACCOUNT}) reached` };
      }

      const [row] = await tx
        .insert(skills)
        .values({
          organisationId,
          subaccountId,
          name: data.name,
          slug: data.slug,
          description: data.description ?? null,
          skillType: 'custom',
          definition: data.definition,
          instructions: data.instructions ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      await skillVersioningHelper.writeVersion({
        skillId: row.id,
        name: row.name,
        description: row.description,
        definition: row.definition as object,
        instructions: row.instructions,
        changeType: 'create',
        changeSummary: 'Subaccount skill created',
        authoredBy: userId ?? null,
        tx,
      });

      await configHistoryService.recordHistory({
        entityType: 'skill',
        entityId: row.id,
        organisationId,
        snapshot: { ...row, subaccountId } as unknown as Record<string, unknown>,
        changedBy: userId ?? null,
        changeSource: 'api',
      }, tx);

      return row;
    });

    return skill;
  },

  /** Update a subaccount-scoped skill. */
  async updateSubaccountSkill(id: string, organisationId: string, subaccountId: string, data: Partial<{
    name: string;
    description: string;
    definition: object;
    instructions: string;
    isActive: boolean;
    visibility: SkillVisibility;
  }>, userId?: string) {
    if (data.visibility !== undefined) {
      if (!isSkillVisibility(data.visibility)) {
        throw { statusCode: 400, message: 'visibility must be one of: none, basic, full' };
      }
    }

    const updated = await db.transaction(async (tx) => {
      // Read pre-mutation snapshot inside the transaction so history is atomic
      // with the update — a rollback won't leave a phantom history entry.
      const [existing] = await tx
        .select()
        .from(skills)
        .where(and(
          eq(skills.id, id),
          eq(skills.organisationId, organisationId),
          eq(skills.subaccountId, subaccountId),
          isNull(skills.deletedAt),
        ));

      if (!existing) throw { statusCode: 404, message: 'Skill not found' };

      await configHistoryService.recordHistory({
        entityType: 'skill',
        entityId: id,
        organisationId,
        snapshot: existing as unknown as Record<string, unknown>,
        changedBy: userId ?? null,
        changeSource: 'api',
      }, tx);

      const update: Record<string, unknown> = { updatedAt: new Date() };
      if (data.name !== undefined) update.name = data.name;
      if (data.description !== undefined) update.description = data.description;
      if (data.definition !== undefined) update.definition = data.definition;
      if (data.instructions !== undefined) update.instructions = data.instructions;
      if (data.isActive !== undefined) update.isActive = data.isActive;
      if (data.visibility !== undefined) update.visibility = data.visibility;

      const [row] = await tx.update(skills).set(update).where(and(
        eq(skills.id, id),
        eq(skills.organisationId, organisationId),
        eq(skills.subaccountId, subaccountId),
      )).returning();

      if (row) {
        await skillVersioningHelper.writeVersion({
          skillId: row.id,
          name: row.name,
          description: row.description,
          definition: row.definition as object,
          instructions: row.instructions,
          changeType: 'update',
          changeSummary: 'Subaccount skill updated',
          authoredBy: userId ?? null,
          tx,
        });
      }

      return row;
    });

    return updated;
  },

  /** Soft-delete a subaccount-scoped skill. */
  async deleteSubaccountSkill(id: string, organisationId: string, subaccountId: string) {
    const [existing] = await db
      .select()
      .from(skills)
      .where(and(
        eq(skills.id, id),
        eq(skills.organisationId, organisationId),
        eq(skills.subaccountId, subaccountId),
        isNull(skills.deletedAt),
      ));

    if (!existing) throw { statusCode: 404, message: 'Skill not found' };

    const now = new Date();
    await db.update(skills).set({ deletedAt: now, updatedAt: now }).where(and(
      eq(skills.id, id),
      eq(skills.organisationId, organisationId),
      eq(skills.subaccountId, subaccountId),
    ));
    return { message: 'Skill deleted' };
  },

  async deleteSkill(id: string, organisationId: string) {
    const [existing] = await db
      .select()
      .from(skills)
      .where(and(eq(skills.id, id), eq(skills.organisationId, organisationId), isNull(skills.deletedAt)));

    if (!existing) throw { statusCode: 404, message: 'Skill not found' };
    if (existing.skillType === 'built_in') throw { statusCode: 400, message: 'Cannot delete built-in skills' };

    const now = new Date();
    await db.update(skills).set({ deletedAt: now, updatedAt: now }).where(and(eq(skills.id, id), eq(skills.organisationId, organisationId)));
    // Feature 2 §9 orphan cleanup: soft-delete test fixtures for this skill
    // (best-effort — not in the same DB transaction as the skill soft-delete above).
    await softDeleteByTarget(organisationId, 'skill', id);
    return { message: 'Skill deleted' };
  },

  /**
   * Seed built-in skills (idempotent — skips if slug already exists)
   */
  async seedBuiltInSkills() {
    const builtInSkills = getBuiltInSkillDefinitions();

    for (const def of builtInSkills) {
      const existing = await db
        .select()
        .from(skills)
        .where(and(isNull(skills.organisationId), eq(skills.slug, def.slug)));

      if (existing.length > 0) {
        // Update existing built-in skill with latest instructions (if changed)
        const current = existing[0];
        if (current.instructions !== (def.instructions ?? null)) {
          await db.update(skills).set({
            instructions: def.instructions ?? null,
            updatedAt: new Date(),
          // guard-ignore-next-line: org-scoped-writes reason="built-in skills have null organisationId by design; current.id obtained from prior SELECT filtered by isNull(skills.organisationId) and slug"
          }).where(eq(skills.id, current.id));
        }
        continue;
      }

      await db.insert(skills).values({
        organisationId: null,
        name: def.name,
        slug: def.slug,
        description: def.description,
        skillType: 'built_in',
        definition: def.definition,
        instructions: def.instructions,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  },
};

// ---------------------------------------------------------------------------
// Built-in skill definitions
// ---------------------------------------------------------------------------

function getBuiltInSkillDefinitions() {
  return [
    {
      name: 'Web Search',
      slug: 'web_search',
      description: 'Search the web for current information using Tavily AI search.',
      definition: {
        name: 'web_search',
        description: 'Search the web for current information. Use this when you need to find up-to-date facts, news, competitor information, or any real-time data.',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The search query' },
            max_results: { type: 'number', description: 'Maximum number of results to return (default 5, max 10)' },
          },
          required: ['query'],
        },
      },
      instructions: `You have access to web search. Use it to find current information, verify facts, research competitors, or gather data that may not be in your training data.

## Web Search Methodology

### Phase 1: Broad Scan
Start with a broad query to understand the landscape. Use general terms first to identify what information is available and what angles exist. Request 5-10 results to get a representative spread.

### Phase 2: Targeted Deep-Dive
Based on broad scan results, formulate 2-3 specific follow-up queries targeting the most relevant angles. Use precise terms, names, or phrases discovered in Phase 1. Reduce max_results to 3-5 for focused results.

### Phase 3: Verification & Synthesis
Cross-reference key claims across multiple search results. If a critical fact appears in only one source, run a verification query. Prefer recent results over older ones for time-sensitive information.

### Decision Rules
- **Always search** when: the question involves dates, prices, current events, competitor activity, or anything that changes over time.
- **Search before asserting** when: you are not fully confident in a specific fact, statistic, or claim.
- **Multiple queries** when: the topic has multiple dimensions (e.g. competitor research = products + pricing + reviews + news).
- **Skip search** when: the information is clearly within your training data and does not change (e.g. general concepts, historical facts).

### Quality Bar
- Never present a single search result as authoritative. Always synthesise across results.
- Clearly distinguish between facts found via search and your own analysis/interpretation.
- Note when information may be outdated or when sources conflict.`,
    },
    {
      name: 'Read Workspace',
      slug: 'read_workspace',
      description: 'Read tasks and activities from the shared board.',
      definition: {
        name: 'read_workspace',
        description: 'Read tasks (board cards) and their activities from the shared board. Use this to see what work exists, what other agents have done, and what needs attention.',
        input_schema: {
          type: 'object',
          properties: {
            status: { type: 'string', description: 'Filter by board column status (e.g. "inbox", "todo", "assigned", "in_progress", "review", "done")' },
            assigned_to_me: { type: 'boolean', description: 'If true, only return tasks assigned to you' },
            limit: { type: 'number', description: 'Maximum tasks to return (default 20)' },
            include_activities: { type: 'boolean', description: 'If true, include recent activity log for each task (default false)' },
          },
          required: [],
        },
      },
      instructions: `You can read the shared board to see what tasks exist, their status, and what other agents have been working on. Check the board regularly to stay coordinated with the team.

## Read Workspace Methodology

### Phase 1: Orientation
At the start of every run, read the board without filters to understand the current state. Look at task distribution across columns, identify what has changed since your last run, and note any urgent or blocked items.

### Phase 2: Focused Queries
After orientation, use targeted filters:
- Filter by \`assigned_to_me: true\` to see your current workload.
- Filter by specific statuses to find tasks that need your attention (e.g. "inbox" for new items, "review" for items awaiting feedback).
- Include activities for tasks you plan to work on, to understand their full history.

### Phase 3: Pattern Recognition
Look for patterns across the board:
- Tasks stuck in the same status for a long time may need escalation.
- Clusters of related tasks may indicate a larger initiative.
- Recent activity from other agents may inform your own work.

### Decision Rules
- **Read before writing**: Always check the board state before creating new tasks or updating existing ones, to avoid duplicates.
- **Limit scope**: Use the \`limit\` parameter to avoid pulling excessive data. Start with 20 tasks; only increase if needed.
- **Include activities sparingly**: Only request activities for tasks you intend to act on. Activity logs add significant context volume.`,
    },
    {
      name: 'Write Workspace',
      slug: 'write_workspace',
      description: 'Add an activity entry to a task.',
      definition: {
        name: 'write_workspace',
        description: 'Add a progress note or activity entry to an existing task. Use this to log what you have done, share findings, or update the team.',
        input_schema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'The ID of the task to add an activity to' },
            activity_type: { type: 'string', description: 'Type of activity: "progress", "note", "completed", "blocked"' },
            message: { type: 'string', description: 'The activity message content' },
          },
          required: ['task_id', 'activity_type', 'message'],
        },
      },
      instructions: `Always log your progress and findings to tasks so other agents and the team can see what you have done.

## Write Workspace Methodology

### When to Write
- **Progress**: Log meaningful progress updates as you work, not just at the end. Other agents and team members monitor the activity feed.
- **Findings**: When you discover something relevant to a task (research results, data points, insights), log it immediately so it is not lost.
- **Blockers**: If you cannot complete something, log a "blocked" activity explaining why and what is needed to unblock.
- **Completion**: Always log a "completed" activity with a summary of what was done before moving a task to review/done.

### Quality Standards
- Be specific and actionable. "Researched competitors" is too vague. "Identified 3 key competitors: X, Y, Z. X leads on pricing, Y on features, Z on brand recognition" is useful.
- Include data and evidence, not just conclusions.
- Write for your team — assume the reader has context on the task but not on what you just did.

### Decision Rules
- **One activity per logical step**: Do not batch everything into a single activity at the end. Multiple focused updates are more useful than one long dump.
- **Do not duplicate**: Check existing activities before writing. If the information is already logged, do not re-log it.
- **Link to deliverables**: If your work produced an output, add a deliverable (using add_deliverable) instead of pasting content into an activity message.`,
    },
    {
      name: 'Trigger Process',
      slug: 'trigger_process',
      description: 'Trigger an automation process/workflow via the task execution system.',
      definition: {
        name: 'trigger_process',
        description: 'Trigger an automation process/workflow. Use this when you need to execute a specific automation like sending an email, posting to social media, or updating a CRM.',
        input_schema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'The ID of the process to trigger' },
            process_name: { type: 'string', description: 'The human-readable name of the process' },
            input_data: { type: 'string', description: 'JSON string of input data to pass to the task. Use {} if no input needed.' },
            reason: { type: 'string', description: 'Brief explanation of why you are triggering this task' },
          },
          required: ['task_id', 'process_name', 'input_data', 'reason'],
        },
      },
      instructions: `## Trigger Process Methodology

### Before Triggering
1. Confirm the process is the right one for this situation. Read the process name and description carefully.
2. Validate your input data matches what the process expects. Use valid JSON in the input_data field.
3. Document your reasoning — the \`reason\` field exists for audit trail. Be specific about why this process is being triggered now.

### Decision Rules
- **Trigger only when justified**: Each process execution has real-world effects (sending emails, updating CRMs, posting content). Never trigger a process "to test" or "just in case."
- **One trigger per intent**: Do not trigger the same process multiple times for the same reason in a single run.
- **Check workspace first**: Before triggering, check if another agent has already triggered this process recently for the same reason.
- **Handle failures gracefully**: If a trigger returns an error, log the failure to the task board and move on. Do not retry automatically.`,
    },
    {
      name: 'Create Task',
      slug: 'create_task',
      description: 'Create a new task (card) on the workspace board.',
      definition: {
        name: 'create_task',
        description: 'Create a new task (board card). Use this when you identify new work that needs to be done, or when you want to assign a task to another agent.',
        input_schema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short title for the work item' },
            description: { type: 'string', description: 'Detailed description of what needs to be done' },
            brief: { type: 'string', description: 'Brief/instructions for the assigned agent' },
            priority: { type: 'string', description: 'Priority level: "low", "normal", "high", "urgent" (default: "normal")' },
            status: { type: 'string', description: 'Initial board column: "inbox", "todo", "assigned" (default: "inbox")' },
            assigned_agent_id: { type: 'string', description: 'ID of the agent to assign this work to (optional)' },
          },
          required: ['title'],
        },
      },
      instructions: `You can create new tasks to assign work, track new tasks, or flag issues for the team.

## Create Task Methodology

### Task Quality Checklist
Before creating a task, verify it meets these criteria:
1. **Clear title**: Short, specific, action-oriented. "Draft Q1 competitor analysis report" not "Competitor stuff."
2. **Actionable description**: What needs to be done, what the expected output is, and any relevant context or constraints.
3. **Correct priority**: Use "urgent" only for time-sensitive items with real deadlines. Default to "normal."
4. **Appropriate status**: Use "inbox" for unassigned new work, "assigned" if you are assigning to a specific agent, "todo" if it is planned but unassigned.

### Decision Rules
- **Check for duplicates first**: Always read the workspace before creating a task. If a similar task already exists, update it instead of creating a new one.
- **One task per deliverable**: Each task should have a single clear outcome. If you are identifying multiple pieces of work, create separate tasks.
- **Assign when possible**: If you know which agent should handle a task, assign it. Unassigned tasks may sit in inbox indefinitely.
- **Include a brief for assigned tasks**: The brief field gives the assigned agent its instructions. Without a brief, the agent has to guess what to do.`,
    },
    {
      name: 'Move Task',
      slug: 'move_task',
      description: 'Move a task to a different board column.',
      definition: {
        name: 'move_task',
        description: 'Move a task to a different board column. Use this to update the status of work — for example, moving a task to "in_progress" when you start, or to "review" when you are done.',
        input_schema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'The ID of the task to move' },
            status: { type: 'string', description: 'The target column: "todo", "assigned", "in_progress", "review", "acceptance", "done"' },
          },
          required: ['task_id', 'status'],
        },
      },
      instructions: `Move tasks through the board as you work on them. Move to "in_progress" when starting, "review" when done and ready for human review.

## Move Task Methodology

### Status Transitions
Follow these standard workflow transitions:
- **inbox → todo**: Task has been triaged and is ready to be planned.
- **todo → assigned**: Task has been assigned to a specific agent.
- **assigned → in_progress**: Agent has started working on the task.
- **in_progress → review**: Work is complete and ready for human review.
- **review → acceptance**: Human has reviewed and approved, pending final sign-off.
- **acceptance → done**: Task is fully completed and closed.

### Decision Rules
- **Always log before moving**: Write a progress activity explaining what was accomplished before moving a task to the next status.
- **Do not skip statuses**: Follow the workflow order. Do not jump from "inbox" to "done."
- **Move to "in_progress" at the start of work**: This signals to other agents and the team that someone is actively working on it.
- **Move to "review" only when there is a deliverable**: Do not move to review unless the task has an attached deliverable or a clear completion summary.`,
    },
    {
      name: 'Add Deliverable',
      slug: 'add_deliverable',
      description: 'Attach a deliverable (output/artifact) to a task.',
      definition: {
        name: 'add_deliverable',
        description: 'Attach a deliverable to a task. Use this to submit your work output — reports, drafts, analysis, recommendations, or any structured content that needs human review.',
        input_schema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'The ID of the task to attach the deliverable to' },
            title: { type: 'string', description: 'Title of the deliverable' },
            deliverable_type: { type: 'string', description: 'Type: "artifact" (text content), "url" (link), "file" (file reference)' },
            description: { type: 'string', description: 'The deliverable content. For artifacts, this is the full content (report, draft, analysis, etc.)' },
          },
          required: ['task_id', 'title', 'deliverable_type', 'description'],
        },
      },
      instructions: `When you complete work, always attach the output as a deliverable so it can be reviewed. Put the full content in the description field.

## Add Deliverable Methodology

### Deliverable Types
Choose the correct type for your output:
- **artifact**: Full text content (reports, analysis, drafts, recommendations). The content goes in the description field. Use this for anything the agent produces as text.
- **url**: A link to external content (Google Doc, published post, dashboard). The URL goes in the path field, with a description of what it links to.
- **file**: A reference to a generated file. The file path goes in the path field.

### Quality Standards
- **Title must be descriptive**: "Q1 Competitor Analysis — March 2025" not "Report."
- **Content must be complete**: Do not add a deliverable that says "see above" or references conversation context. The deliverable should stand alone.
- **Structure long content**: Use headings, bullet points, and sections for artifacts longer than a few paragraphs. The deliverable will be read by humans who may not have context on the agent run.

### Decision Rules
- **One deliverable per output**: If your work produced a report and a data summary, create two separate deliverables.
- **Always attach to the right task**: The deliverable must belong to the task it fulfills. Do not attach work to unrelated tasks.
- **Add deliverable before moving to review**: A task in "review" status should always have at least one deliverable attached.`,
    },
    {
      name: 'Reassign Task',
      slug: 'reassign_task',
      description: 'Reassign an existing task to another agent to continue working on it.',
      definition: {
        name: 'reassign_task',
        description: 'Reassign an existing task to another agent to continue working on it. Use this when you have completed your part of a task and another agent should take over. This wakes the target agent to start working immediately. Check your team roster to see available agents.',
        input_schema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'ID of the task to reassign' },
            assigned_agent_id: { type: 'string', description: 'ID of the agent to assign the task to (from your team roster)' },
            handoff_context: { type: 'string', description: 'Context for the next agent — what you did, what they should do next' },
          },
          required: ['task_id', 'assigned_agent_id'],
        },
      },
      instructions: `You can reassign tasks to other agents on your team. Use this when you have completed your part of a task and another agent should continue. Always provide handoff context explaining what you did and what the next agent should do.

## Task Reassignment Methodology

### When to Reassign
- You have completed the work within your expertise and a different specialist should continue
- The task explicitly calls for a multi-agent workflow (e.g. "research then write then review")
- You've identified that another agent is better suited for the remaining work

### When NOT to Reassign
- You can complete the entire task yourself — just finish it
- You're stuck and hoping another agent can figure it out — log the blocker instead
- The task is almost done — finish it and move to review

### Handoff Context Quality
Always include in your handoff_context:
1. **What you did**: Brief summary of your contribution
2. **Key findings**: Any important information the next agent needs
3. **What to do next**: Clear instructions for the next step
4. **Where you left off**: If partially complete, what remains

Bad: "Done, passing to content writer"
Good: "Completed competitor analysis: found 3 competitors with new pricing. Key findings attached as activity. Content Writer should draft a comparison report focusing on our pricing advantage vs Competitor X."`,
    },
    {
      name: 'Spawn Sub-Agents',
      slug: 'spawn_sub_agents',
      description: 'Split work into 2-3 parallel sub-tasks executed by agents simultaneously.',
      definition: {
        name: 'spawn_sub_agents',
        description: 'Split work into 2-3 parallel sub-tasks executed by agents simultaneously. Each sub-task gets its own task card on the board and runs in parallel. You will receive all results when they complete, then continue your work with the combined output. Sub-agents can be the same agent type as you or different agents from your team.',
        input_schema: {
          type: 'object',
          properties: {
            sub_tasks: {
              type: 'array',
              description: 'Array of 2-3 sub-tasks to execute in parallel',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Sub-task title' },
                  brief: { type: 'string', description: 'Detailed instructions for the sub-agent' },
                  assigned_agent_id: { type: 'string', description: 'Agent ID from your team roster' },
                },
                required: ['title', 'brief', 'assigned_agent_id'],
              },
            },
          },
          required: ['sub_tasks'],
        },
      },
      instructions: `You can spawn 2-3 sub-agents to work on tasks in parallel. Use this when a task can be split into independent pieces that benefit from simultaneous execution. Results from all sub-agents will be returned to you for synthesis.

## Sub-Agent Spawning Methodology

### When to Spawn
- The task involves researching multiple independent topics (e.g. "research competitors X, Y, Z")
- Parallel execution would save significant time
- Each sub-task is self-contained and doesn't depend on others' output

### When NOT to Spawn
- The sub-tasks depend on each other (A must finish before B can start) — use sequential reassignment instead
- There are fewer than 2 distinct parallel tracks — just do the work yourself
- The task is simple enough to handle without splitting

### Writing Good Sub-Task Briefs
Each sub-agent receives ONLY its brief as context. Make each brief self-contained:
- Include all necessary background information
- Specify the expected output format
- Set clear scope boundaries so sub-agents don't overlap

### After Results Return
1. Review all sub-agent results
2. Synthesise findings into a cohesive output
3. Note any gaps or contradictions between sub-agent outputs
4. Attach the synthesised result as a deliverable on the parent task`,
    },
  ];
}
