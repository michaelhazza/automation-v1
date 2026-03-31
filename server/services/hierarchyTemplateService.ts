import { eq, and, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  hierarchyTemplates,
  hierarchyTemplateSlots,
  systemAgents,
  agents,
  subaccountAgents,
} from '../db/schema/index.js';
import { buildTree, getMaxDepth } from './hierarchyService.js';

// ---------------------------------------------------------------------------
// Hierarchy Template Service
// ---------------------------------------------------------------------------

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export const hierarchyTemplateService = {
  // ── CRUD ──────────────────────────────────────────────────────────────────

  async list(organisationId: string) {
    const templates = await db
      .select()
      .from(hierarchyTemplates)
      .where(and(
        eq(hierarchyTemplates.organisationId, organisationId),
        isNull(hierarchyTemplates.deletedAt)
      ))
      .orderBy(hierarchyTemplates.name);

    // Get slot counts
    const result = [];
    for (const t of templates) {
      const slots = await db
        .select({ id: hierarchyTemplateSlots.id })
        .from(hierarchyTemplateSlots)
        .where(eq(hierarchyTemplateSlots.templateId, t.id));
      result.push({ ...t, slotCount: slots.length });
    }
    return result;
  },

  async get(id: string, organisationId: string) {
    const [template] = await db
      .select()
      .from(hierarchyTemplates)
      .where(and(
        eq(hierarchyTemplates.id, id),
        eq(hierarchyTemplates.organisationId, organisationId),
        isNull(hierarchyTemplates.deletedAt)
      ));
    if (!template) throw { statusCode: 404, message: 'Template not found' };

    const slots = await db
      .select()
      .from(hierarchyTemplateSlots)
      .where(eq(hierarchyTemplateSlots.templateId, id));

    const tree = buildTree(
      slots.map(s => ({ ...s, sortOrder: s.sortOrder })),
      (s) => s.parentSlotId
    );

    return { ...template, slots, tree };
  },

  async create(organisationId: string, data: {
    name: string;
    description?: string;
    sourceType?: string;
  }) {
    const [template] = await db
      .insert(hierarchyTemplates)
      .values({
        organisationId,
        name: data.name,
        description: data.description ?? null,
        sourceType: (data.sourceType as 'manual' | 'paperclip_import' | 'from_system') ?? 'manual',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return template;
  },

  async update(id: string, organisationId: string, data: {
    name?: string;
    description?: string;
    isDefaultForSubaccount?: boolean;
  }) {
    const [existing] = await db
      .select()
      .from(hierarchyTemplates)
      .where(and(
        eq(hierarchyTemplates.id, id),
        eq(hierarchyTemplates.organisationId, organisationId),
        isNull(hierarchyTemplates.deletedAt)
      ));
    if (!existing) throw { statusCode: 404, message: 'Template not found' };

    const update: Record<string, unknown> = {
      updatedAt: new Date(),
      version: existing.version + 1,
    };
    if (data.name !== undefined) update.name = data.name;
    if (data.description !== undefined) update.description = data.description;

    if (data.isDefaultForSubaccount === true) {
      // Unset any existing default in the same org
      await db.update(hierarchyTemplates)
        .set({ isDefaultForSubaccount: false, updatedAt: new Date() })
        .where(and(
          eq(hierarchyTemplates.organisationId, organisationId),
          eq(hierarchyTemplates.isDefaultForSubaccount, true),
          isNull(hierarchyTemplates.deletedAt)
        ));
      update.isDefaultForSubaccount = true;
    } else if (data.isDefaultForSubaccount === false) {
      update.isDefaultForSubaccount = false;
    }

    const [updated] = await db.update(hierarchyTemplates)
      .set(update)
      .where(eq(hierarchyTemplates.id, id))
      .returning();
    return updated;
  },

  async delete(id: string, organisationId: string) {
    const [existing] = await db
      .select()
      .from(hierarchyTemplates)
      .where(and(
        eq(hierarchyTemplates.id, id),
        eq(hierarchyTemplates.organisationId, organisationId),
        isNull(hierarchyTemplates.deletedAt)
      ));
    if (!existing) throw { statusCode: 404, message: 'Template not found' };

    await db.update(hierarchyTemplates)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(hierarchyTemplates.id, id));

    return { message: 'Template deleted' };
  },

  // ── Paperclip Import ──────────────────────────────────────────────────────

  async importPaperclip(organisationId: string, data: {
    name: string;
    manifest: Record<string, unknown>;
  }) {
    const manifest = data.manifest;
    if (!manifest || typeof manifest !== 'object') {
      throw { statusCode: 400, message: 'Invalid manifest: must be a JSON object' };
    }

    const company = manifest.company as Record<string, unknown> | undefined;
    const paperclipAgents = (company?.agents ?? manifest.agents ?? []) as Array<Record<string, unknown>>;

    if (!Array.isArray(paperclipAgents) || paperclipAgents.length === 0) {
      throw { statusCode: 400, message: 'Manifest contains no agents. Expected agents array in manifest.company.agents or manifest.agents.' };
    }

    // Log warning for very large imports
    if (paperclipAgents.length > 200) {
      console.warn(`[IMPORT] Large Paperclip import: ${paperclipAgents.length} agents for org ${organisationId}`);
    }

    // Load existing system agents and org agents for matching
    const sysAgents = await db.select().from(systemAgents).where(isNull(systemAgents.deletedAt));
    const orgAgents = await db.select().from(agents)
      .where(and(eq(agents.organisationId, organisationId), isNull(agents.deletedAt)));

    // Create template
    const [template] = await db
      .insert(hierarchyTemplates)
      .values({
        organisationId,
        name: data.name,
        sourceType: 'paperclip_import',
        paperclipManifest: manifest,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // Track used slugs for collision detection
    const usedSlugs = new Set(orgAgents.map(a => a.slug));
    const templateSlugs = new Set<string>();

    const slugsRenamed: Array<{ final: string; original: string }> = [];
    const updateConflicts: Array<{ agentName: string; field: string; reason: string }> = [];

    let matchedSystemAgent = 0;
    let matchedOrgAgent = 0;
    let blueprintCount = 0;
    let blueprintsRequiringPrompt = 0;

    // First pass: create all slots
    const slotsByOriginalSlug = new Map<string, string>(); // paperclip slug → slot id
    const slotsCreated: Array<{ id: string; slug: string; reportsToSlug?: string }> = [];

    for (let i = 0; i < paperclipAgents.length; i++) {
      const pa = paperclipAgents[i];
      const originalSlug = slugify(String(pa.slug || pa.name || `agent-${i}`));
      const name = String(pa.name || pa.slug || `Agent ${i}`);
      const role = pa.role as string | undefined;
      const title = pa.title as string | undefined;
      const description = pa.description as string | undefined;
      const capabilities = pa.capabilities as string | undefined;
      const masterPrompt = (pa.systemPrompt || pa.masterPrompt) as string | undefined;
      const modelProvider = pa.modelProvider as string | undefined;
      const modelId = (pa.modelId || pa.model) as string | undefined;
      const icon = (pa.icon || pa.avatar) as string | undefined;
      const reportsToSlug = (pa.reportsTo || pa.reportsToSlug) as string | undefined;

      // Normalise slug and handle collisions
      let finalSlug = originalSlug;
      let suffix = 2;
      while (usedSlugs.has(finalSlug) || templateSlugs.has(finalSlug)) {
        finalSlug = `${originalSlug}-${suffix}`;
        suffix++;
      }
      templateSlugs.add(finalSlug);

      if (finalSlug !== originalSlug) {
        slugsRenamed.push({ final: finalSlug, original: originalSlug });
      }

      // Match against system agents (slug then name)
      let systemAgentId: string | null = null;
      let agentId: string | null = null;

      const sysMatch = sysAgents.find(sa => sa.slug === originalSlug)
        ?? sysAgents.find(sa => sa.name.toLowerCase() === name.toLowerCase());

      if (sysMatch) {
        systemAgentId = sysMatch.id;
        matchedSystemAgent++;

        // Check update conflicts
        if (masterPrompt) {
          updateConflicts.push({ agentName: name, field: 'masterPrompt', reason: 'locked by system agent' });
        }
      } else {
        // Match against org agents
        const orgMatch = orgAgents.find(oa => oa.slug === originalSlug)
          ?? orgAgents.find(oa => oa.name.toLowerCase() === name.toLowerCase());

        if (orgMatch) {
          agentId = orgMatch.id;
          matchedOrgAgent++;

          if (orgMatch.isSystemManaged && masterPrompt) {
            updateConflicts.push({ agentName: name, field: 'masterPrompt', reason: 'locked by system agent' });
          }
          if (orgMatch.isSystemManaged && (modelProvider || modelId) && !orgMatch.allowModelOverride) {
            updateConflicts.push({ agentName: name, field: 'modelProvider/modelId', reason: 'model override not allowed' });
          }
        } else {
          blueprintCount++;
          if (!masterPrompt) blueprintsRequiringPrompt++;
        }
      }

      const [slot] = await db
        .insert(hierarchyTemplateSlots)
        .values({
          templateId: template.id,
          systemAgentId,
          agentId,
          blueprintSlug: finalSlug,
          paperclipSlug: originalSlug !== finalSlug ? originalSlug : null,
          blueprintName: (!systemAgentId && !agentId) ? name : null,
          blueprintDescription: (!systemAgentId && !agentId) ? (description ?? null) : null,
          blueprintIcon: (!systemAgentId && !agentId) ? (icon ?? null) : null,
          blueprintRole: role ?? null,
          blueprintTitle: title ?? null,
          blueprintCapabilities: (!systemAgentId && !agentId) ? (capabilities ?? null) : null,
          blueprintMasterPrompt: (!systemAgentId && !agentId) ? (masterPrompt ?? null) : null,
          blueprintModelProvider: (!systemAgentId && !agentId) ? (modelProvider ?? null) : null,
          blueprintModelId: (!systemAgentId && !agentId) ? (modelId ?? null) : null,
          sortOrder: i,
          createdAt: new Date(),
        })
        .returning();

      slotsByOriginalSlug.set(originalSlug, slot.id);
      slotsCreated.push({
        id: slot.id,
        slug: originalSlug,
        reportsToSlug: reportsToSlug ? slugify(String(reportsToSlug)) : undefined,
      });
    }

    // Second pass: resolve hierarchy (reportsTo → parentSlotId)
    const unresolvedParents: string[] = [];

    for (const slot of slotsCreated) {
      if (!slot.reportsToSlug) continue;
      const parentSlotId = slotsByOriginalSlug.get(slot.reportsToSlug);
      if (parentSlotId) {
        await db.update(hierarchyTemplateSlots)
          .set({ parentSlotId })
          .where(eq(hierarchyTemplateSlots.id, slot.id));
      } else {
        unresolvedParents.push(slot.reportsToSlug);
      }
    }

    // Check depth
    const allSlots = await db.select().from(hierarchyTemplateSlots)
      .where(eq(hierarchyTemplateSlots.templateId, template.id));
    const tree = buildTree(
      allSlots.map(s => ({ ...s, sortOrder: s.sortOrder })),
      (s) => s.parentSlotId
    );
    const maxDepth = getMaxDepth(tree);

    return {
      template: { id: template.id, name: template.name, version: template.version },
      summary: {
        total: paperclipAgents.length,
        matchedSystemAgent,
        matchedOrgAgent,
        blueprint: blueprintCount,
        blueprintsRequiringPrompt,
        slugsRenamed,
        updateConflicts,
        unresolvedParents,
        depthWarning: maxDepth > 7 ? maxDepth : null,
      },
    };
  },

  // ── Apply Template to Subaccount ──────────────────────────────────────────

  /**
   * Core apply logic extracted so preview and real apply share identical code.
   * Receives the Drizzle transaction (or db) to operate on.
   */
  async _applyCore(
    tx: any,
    templateId: string,
    organisationId: string,
    subaccountId: string,
    mode: 'merge' | 'replace',
    template: { version: number; slots: any[] }
  ) {
    // ── Concurrency: advisory lock per subaccount to prevent concurrent applies
    // Hash subaccountId to a bigint for pg_advisory_xact_lock
    let lockHash = 0;
    for (let i = 0; i < subaccountId.length; i++) {
      lockHash = ((lockHash << 5) - lockHash + subaccountId.charCodeAt(i)) | 0;
    }
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockHash})`);

    // Replace mode: clear hierarchy ONLY (not links, not agents)
    let agentsRemovedFromHierarchy = 0;
    if (mode === 'replace') {
      const existing = await tx
        .select({ id: subaccountAgents.id, parentSubaccountAgentId: subaccountAgents.parentSubaccountAgentId })
        .from(subaccountAgents)
        .where(and(
          eq(subaccountAgents.subaccountId, subaccountId),
          eq(subaccountAgents.organisationId, organisationId)
        ));
      const withParent = existing.filter(r => r.parentSubaccountAgentId !== null);
      if (withParent.length > 0) {
        await tx.update(subaccountAgents)
          .set({ parentSubaccountAgentId: null, updatedAt: new Date() })
          .where(and(
            eq(subaccountAgents.subaccountId, subaccountId),
            eq(subaccountAgents.organisationId, organisationId)
          ));
        agentsRemovedFromHierarchy = withParent.length;
      }
    }

    let agentsLinked = 0;
    let agentsCreated = 0;
    let agentsReused = 0;
    let agentsDraft = 0;
    let hierarchyUpdated = 0;

    // Map slot id → subaccount agent id for hierarchy resolution
    const slotToSubaccountAgentId = new Map<string, string>();

    // Process each slot
    for (const slot of template.slots) {
      let orgAgentId: string | null = null;

      if (slot.systemAgentId) {
        // System agent ref: check if org agent exists, create if not
        const [existingOrgAgent] = await tx
          .select({ id: agents.id })
          .from(agents)
          .where(and(
            eq(agents.organisationId, organisationId),
            eq(agents.systemAgentId, slot.systemAgentId),
            isNull(agents.deletedAt)
          ));

        if (existingOrgAgent) {
          orgAgentId = existingOrgAgent.id;
          agentsReused++;
        } else {
          // Provision system agent to org
          const [sysAgent] = await tx.select().from(systemAgents)
            .where(eq(systemAgents.id, slot.systemAgentId));
          if (sysAgent) {
            const slug = sysAgent.slug + '-' + Date.now().toString(36);
            const [newAgent] = await tx.insert(agents).values({
              organisationId,
              systemAgentId: sysAgent.id,
              isSystemManaged: true,
              name: sysAgent.name,
              slug,
              description: sysAgent.description,
              icon: sysAgent.icon,
              masterPrompt: '',
              additionalPrompt: '',
              modelProvider: sysAgent.modelProvider,
              modelId: sysAgent.modelId,
              temperature: sysAgent.temperature,
              maxTokens: sysAgent.maxTokens,
              agentRole: slot.blueprintRole,
              agentTitle: slot.blueprintTitle,
              status: 'draft',
              createdAt: new Date(),
              updatedAt: new Date(),
            }).returning();
            orgAgentId = newAgent.id;
            agentsCreated++;
            agentsDraft++;
          }
        }
      } else if (slot.agentId) {
        // Org agent ref: use directly
        orgAgentId = slot.agentId;
        agentsReused++;
      } else if (slot.blueprintSlug) {
        // Blueprint: match existing org agent by blueprintSlug (the sole matching key)
        const [existingBySlug] = await tx
          .select({ id: agents.id })
          .from(agents)
          .where(and(
            eq(agents.organisationId, organisationId),
            eq(agents.slug, slot.blueprintSlug),
            isNull(agents.deletedAt)
          ));

        if (existingBySlug) {
          orgAgentId = existingBySlug.id;
          agentsReused++;
        } else {
          const hasMasterPrompt = !!slot.blueprintMasterPrompt;
          const [newAgent] = await tx.insert(agents).values({
            organisationId,
            name: slot.blueprintName || slot.blueprintSlug,
            slug: slot.blueprintSlug,
            description: slot.blueprintDescription,
            icon: slot.blueprintIcon,
            masterPrompt: slot.blueprintMasterPrompt ?? '',
            additionalPrompt: '',
            modelProvider: slot.blueprintModelProvider ?? 'anthropic',
            modelId: slot.blueprintModelId ?? 'claude-sonnet-4-6',
            agentRole: slot.blueprintRole,
            agentTitle: slot.blueprintTitle,
            status: hasMasterPrompt ? 'active' : 'draft',
            createdAt: new Date(),
            updatedAt: new Date(),
          }).returning();
          orgAgentId = newAgent.id;
          agentsCreated++;
          if (!hasMasterPrompt) agentsDraft++;
        }
      }

      if (!orgAgentId) continue;

      // Link to subaccount (or get existing link)
      let subAgentLink: { id: string } | undefined;
      const [existingLink] = await tx
        .select({ id: subaccountAgents.id })
        .from(subaccountAgents)
        .where(and(
          eq(subaccountAgents.subaccountId, subaccountId),
          eq(subaccountAgents.agentId, orgAgentId)
        ));

      if (existingLink) {
        subAgentLink = existingLink;
      } else {
        // Get default skills from the org agent
        const [orgAgent] = await tx.select({ defaultSkillSlugs: agents.defaultSkillSlugs })
          .from(agents).where(eq(agents.id, orgAgentId));

        const [newLink] = await tx.insert(subaccountAgents).values({
          organisationId,
          subaccountId,
          agentId: orgAgentId,
          isActive: true,
          agentRole: slot.blueprintRole,
          agentTitle: slot.blueprintTitle,
          appliedTemplateId: templateId,
          appliedTemplateVersion: template.version,
          skillSlugs: orgAgent?.defaultSkillSlugs ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }).returning();
        subAgentLink = newLink;
        agentsLinked++;
      }

      // Store mapping for hierarchy resolution
      slotToSubaccountAgentId.set(slot.id, subAgentLink.id);
    }

    // Resolve hierarchy on subaccount agents
    // Validate depth of template tree before applying (reject if >10 levels)
    const templateTree = buildTree(
      template.slots.map(s => ({ ...s, sortOrder: s.sortOrder })),
      (s) => s.parentSlotId
    );
    const maxDepth = getMaxDepth(templateTree);
    if (maxDepth > 10) {
      throw { statusCode: 400, message: `Template hierarchy depth (${maxDepth}) exceeds maximum of 10 levels` };
    }

    for (const slot of template.slots) {
      if (!slot.parentSlotId) continue;
      const subAgentId = slotToSubaccountAgentId.get(slot.id);
      const parentSubAgentId = slotToSubaccountAgentId.get(slot.parentSlotId);
      if (subAgentId && parentSubAgentId && subAgentId !== parentSubAgentId) {
        await tx.update(subaccountAgents)
          .set({
            parentSubaccountAgentId: parentSubAgentId,
            agentRole: slot.blueprintRole,
            agentTitle: slot.blueprintTitle,
            appliedTemplateId: templateId,
            appliedTemplateVersion: template.version,
            updatedAt: new Date(),
          })
          .where(eq(subaccountAgents.id, subAgentId));
        hierarchyUpdated++;
      }
    }

    return {
      appliedTemplateVersion: template.version,
      summary: {
        agentsLinked,
        agentsCreated,
        agentsReused,
        agentsDraft,
        hierarchyUpdated,
        agentsRemovedFromHierarchy,
      },
    };
  },

  async apply(
    templateId: string,
    organisationId: string,
    data: {
      subaccountId: string;
      mode?: 'merge' | 'replace';
      preview?: boolean;
    }
  ) {
    const template = await this.get(templateId, organisationId);
    if (template.slots.length === 0) {
      throw { statusCode: 400, message: 'Cannot apply a template with zero slots' };
    }

    const { subaccountId, mode = 'merge', preview = false } = data;

    // Both preview and real apply run inside a transaction on the same code path.
    // Preview rolls back; real apply commits.
    const result = await db.transaction(async (tx) => {
      const summary = await this._applyCore(tx, templateId, organisationId, subaccountId, mode, template);

      if (preview) {
        // Throw to trigger rollback while preserving the computed result
        throw { __preview: true, result: summary };
      }

      return summary;
    }).catch((err: unknown) => {
      // Catch preview rollback — return the result without committing
      if (err && typeof err === 'object' && '__preview' in (err as Record<string, unknown>)) {
        return (err as { result: { appliedTemplateVersion: number; summary: Record<string, number> } }).result;
      }
      throw err;
    });

    return result;
  },

  // ── Direct Subaccount Import ──────────────────────────────────────────────

  async importToSubaccount(organisationId: string, data: {
    subaccountId: string;
    name: string;
    manifest: Record<string, unknown>;
    saveAsTemplate?: boolean;
  }) {
    // Import as a template first
    const importResult = await this.importPaperclip(organisationId, {
      name: data.name,
      manifest: data.manifest,
    });

    // Apply the template to the subaccount immediately
    const applyResult = await this.apply(importResult.template.id, organisationId, {
      subaccountId: data.subaccountId,
      mode: 'merge',
    });

    // If not saving as template, delete it
    if (!data.saveAsTemplate) {
      await db.update(hierarchyTemplates)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(hierarchyTemplates.id, importResult.template.id));
    }

    return {
      ...importResult,
      apply: applyResult,
      templateSaved: !!data.saveAsTemplate,
    };
  },
};
