import { eq, and, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  systemHierarchyTemplates,
  systemHierarchyTemplateSlots,
  systemAgents,
  agents,
  subaccountAgents,
} from '../db/schema/index.js';
import { buildTree, getMaxDepth } from './hierarchyService.js';

// ---------------------------------------------------------------------------
// System Template Service — platform-level company template library
// ---------------------------------------------------------------------------

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export const systemTemplateService = {
  // ── CRUD (system admin) ─────────────────────────────────────────────────

  async list() {
    const templates = await db
      .select()
      .from(systemHierarchyTemplates)
      .where(isNull(systemHierarchyTemplates.deletedAt))
      .orderBy(systemHierarchyTemplates.name);

    return templates;
  },

  async get(id: string) {
    const [template] = await db
      .select()
      .from(systemHierarchyTemplates)
      .where(and(
        eq(systemHierarchyTemplates.id, id),
        isNull(systemHierarchyTemplates.deletedAt)
      ));
    if (!template) throw { statusCode: 404, message: 'Template not found' };

    const slots = await db
      .select()
      .from(systemHierarchyTemplateSlots)
      .where(eq(systemHierarchyTemplateSlots.templateId, id));

    const tree = buildTree(
      slots.map(s => ({ ...s, sortOrder: s.sortOrder })),
      (s) => s.parentSlotId
    );

    return { ...template, slots, tree };
  },

  async update(id: string, data: { name?: string; description?: string; isPublished?: boolean }) {
    const [existing] = await db
      .select()
      .from(systemHierarchyTemplates)
      .where(and(
        eq(systemHierarchyTemplates.id, id),
        isNull(systemHierarchyTemplates.deletedAt)
      ));
    if (!existing) throw { statusCode: 404, message: 'Template not found' };

    const update: Record<string, unknown> = {
      updatedAt: new Date(),
      version: existing.version + 1,
    };
    if (data.name !== undefined) update.name = data.name;
    if (data.description !== undefined) update.description = data.description;
    if (data.isPublished !== undefined) update.isPublished = data.isPublished;

    const [updated] = await db.update(systemHierarchyTemplates)
      .set(update)
      .where(eq(systemHierarchyTemplates.id, id))
      .returning();
    return updated;
  },

  async delete(id: string) {
    const [existing] = await db
      .select()
      .from(systemHierarchyTemplates)
      .where(and(
        eq(systemHierarchyTemplates.id, id),
        isNull(systemHierarchyTemplates.deletedAt)
      ));
    if (!existing) throw { statusCode: 404, message: 'Template not found' };

    await db.update(systemHierarchyTemplates)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(systemHierarchyTemplates.id, id));

    return { message: 'Template deleted' };
  },

  // ── Paperclip Import (system admin) ─────────────────────────────────────

  async importPaperclip(data: { name: string; manifest: Record<string, unknown> }) {
    const manifest = data.manifest;
    if (!manifest || typeof manifest !== 'object') {
      throw { statusCode: 400, message: 'Invalid manifest: must be a JSON object' };
    }

    const company = manifest.company as Record<string, unknown> | undefined;
    const paperclipAgents = (company?.agents ?? manifest.agents ?? []) as Array<Record<string, unknown>>;

    if (!Array.isArray(paperclipAgents) || paperclipAgents.length === 0) {
      throw { statusCode: 400, message: 'Manifest contains no agents. Expected agents array in manifest.company.agents or manifest.agents.' };
    }

    if (paperclipAgents.length > 200) {
      console.warn(`[SYSTEM-IMPORT] Large Paperclip import: ${paperclipAgents.length} agents`);
    }

    // Load existing system agents for matching
    const sysAgents = await db.select().from(systemAgents).where(isNull(systemAgents.deletedAt));

    // Create template
    const [template] = await db
      .insert(systemHierarchyTemplates)
      .values({
        name: data.name,
        sourceType: 'paperclip_import',
        paperclipManifest: manifest,
        agentCount: paperclipAgents.length,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // Track used slugs for collision detection within this template
    const templateSlugs = new Set<string>();
    const slugsRenamed: Array<{ final: string; original: string }> = [];

    let matchedSystemAgent = 0;
    let blueprintCount = 0;
    let blueprintsRequiringPrompt = 0;

    // First pass: create all slots
    const slotsByOriginalSlug = new Map<string, string>();
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

      // Normalise slug and handle collisions within template
      let finalSlug = originalSlug;
      let suffix = 2;
      while (templateSlugs.has(finalSlug)) {
        finalSlug = `${originalSlug}-${suffix}`;
        suffix++;
      }
      templateSlugs.add(finalSlug);

      if (finalSlug !== originalSlug) {
        slugsRenamed.push({ final: finalSlug, original: originalSlug });
      }

      // Match against system agents (slug then name)
      let systemAgentId: string | null = null;

      const sysMatch = sysAgents.find(sa => sa.slug === originalSlug)
        ?? sysAgents.find(sa => sa.name.toLowerCase() === name.toLowerCase());

      if (sysMatch) {
        systemAgentId = sysMatch.id;
        matchedSystemAgent++;
      } else {
        blueprintCount++;
        if (!masterPrompt) blueprintsRequiringPrompt++;
      }

      const [slot] = await db
        .insert(systemHierarchyTemplateSlots)
        .values({
          templateId: template.id,
          systemAgentId,
          blueprintSlug: finalSlug,
          paperclipSlug: originalSlug !== finalSlug ? originalSlug : null,
          blueprintName: name,
          blueprintDescription: description ?? null,
          blueprintIcon: icon ?? null,
          blueprintRole: role ?? null,
          blueprintTitle: title ?? null,
          blueprintCapabilities: capabilities ?? null,
          blueprintMasterPrompt: masterPrompt ?? null,
          blueprintModelProvider: modelProvider ?? null,
          blueprintModelId: modelId ?? null,
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
        await db.update(systemHierarchyTemplateSlots)
          .set({ parentSlotId })
          .where(eq(systemHierarchyTemplateSlots.id, slot.id));
      } else {
        unresolvedParents.push(slot.reportsToSlug);
      }
    }

    // Check depth
    const allSlots = await db.select().from(systemHierarchyTemplateSlots)
      .where(eq(systemHierarchyTemplateSlots.templateId, template.id));
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
        blueprint: blueprintCount,
        blueprintsRequiringPrompt,
        slugsRenamed,
        unresolvedParents,
        depthWarning: maxDepth > 7 ? maxDepth : null,
      },
    };
  },

  // ── Browse (org-facing) ─────────────────────────────────────────────────

  async listPublished() {
    const templates = await db
      .select({
        id: systemHierarchyTemplates.id,
        name: systemHierarchyTemplates.name,
        description: systemHierarchyTemplates.description,
        agentCount: systemHierarchyTemplates.agentCount,
        version: systemHierarchyTemplates.version,
        createdAt: systemHierarchyTemplates.createdAt,
      })
      .from(systemHierarchyTemplates)
      .where(and(
        eq(systemHierarchyTemplates.isPublished, true),
        isNull(systemHierarchyTemplates.deletedAt)
      ))
      .orderBy(systemHierarchyTemplates.name);

    return templates;
  },

  async getPublished(id: string) {
    const [template] = await db
      .select({
        id: systemHierarchyTemplates.id,
        name: systemHierarchyTemplates.name,
        description: systemHierarchyTemplates.description,
        agentCount: systemHierarchyTemplates.agentCount,
        version: systemHierarchyTemplates.version,
        createdAt: systemHierarchyTemplates.createdAt,
      })
      .from(systemHierarchyTemplates)
      .where(and(
        eq(systemHierarchyTemplates.id, id),
        eq(systemHierarchyTemplates.isPublished, true),
        isNull(systemHierarchyTemplates.deletedAt)
      ));
    if (!template) throw { statusCode: 404, message: 'Template not found' };

    const slots = await db
      .select({
        id: systemHierarchyTemplateSlots.id,
        blueprintSlug: systemHierarchyTemplateSlots.blueprintSlug,
        blueprintName: systemHierarchyTemplateSlots.blueprintName,
        blueprintDescription: systemHierarchyTemplateSlots.blueprintDescription,
        blueprintIcon: systemHierarchyTemplateSlots.blueprintIcon,
        blueprintRole: systemHierarchyTemplateSlots.blueprintRole,
        blueprintTitle: systemHierarchyTemplateSlots.blueprintTitle,
        systemAgentId: systemHierarchyTemplateSlots.systemAgentId,
        parentSlotId: systemHierarchyTemplateSlots.parentSlotId,
        sortOrder: systemHierarchyTemplateSlots.sortOrder,
      })
      .from(systemHierarchyTemplateSlots)
      .where(eq(systemHierarchyTemplateSlots.templateId, id));

    const tree = buildTree(
      slots.map(s => ({ ...s })),
      (s) => s.parentSlotId
    );

    return { ...template, slots, tree };
  },

  // ── Load Template into Subaccount ───────────────────────────────────────

  async loadToSubaccount(
    systemTemplateId: string,
    organisationId: string,
    subaccountId: string,
    parentSubaccountAgentId: string | null = null
  ) {
    // Fetch the system template with all slots
    const [template] = await db
      .select()
      .from(systemHierarchyTemplates)
      .where(and(
        eq(systemHierarchyTemplates.id, systemTemplateId),
        eq(systemHierarchyTemplates.isPublished, true),
        isNull(systemHierarchyTemplates.deletedAt)
      ));
    if (!template) throw { statusCode: 404, message: 'Template not found or not published' };

    const slots = await db
      .select()
      .from(systemHierarchyTemplateSlots)
      .where(eq(systemHierarchyTemplateSlots.templateId, systemTemplateId));

    if (slots.length === 0) {
      throw { statusCode: 400, message: 'Cannot load a template with zero agents' };
    }

    const result = await db.transaction(async (tx) => {
      // Advisory lock per subaccount
      let lockHash = 0;
      for (let i = 0; i < subaccountId.length; i++) {
        lockHash = ((lockHash << 5) - lockHash + subaccountId.charCodeAt(i)) | 0;
      }
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockHash})`);

      let agentsLinked = 0;
      let agentsCreated = 0;
      let agentsReused = 0;
      let agentsDraft = 0;
      let hierarchyUpdated = 0;

      // Map slot id → subaccount agent id for hierarchy resolution
      const slotToSubaccountAgentId = new Map<string, string>();

      // Track root slots (no parentSlotId) — these get parentSubaccountAgentId as their parent
      const rootSlotIds = new Set(slots.filter(s => !s.parentSlotId).map(s => s.id));

      for (const slot of slots) {
        let orgAgentId: string | null = null;

        if (slot.systemAgentId) {
          // System agent ref: check if org agent already exists
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
        } else if (slot.blueprintSlug) {
          // Blueprint: match existing org agent by slug
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
              slug: slot.blueprintSlug + '-' + Date.now().toString(36),
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
          const [orgAgent] = await tx.select({ defaultSkillSlugs: agents.defaultSkillSlugs })
            .from(agents).where(eq(agents.id, orgAgentId));

          const [newLink] = await tx.insert(subaccountAgents).values({
            organisationId,
            subaccountId,
            agentId: orgAgentId,
            isActive: true,
            agentRole: slot.blueprintRole,
            agentTitle: slot.blueprintTitle,
            skillSlugs: orgAgent?.defaultSkillSlugs ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
          }).returning();
          subAgentLink = newLink;
          agentsLinked++;
        }

        slotToSubaccountAgentId.set(slot.id, subAgentLink.id);
      }

      // Resolve template-internal hierarchy
      const templateTree = buildTree(
        slots.map(s => ({ ...s, sortOrder: s.sortOrder })),
        (s) => s.parentSlotId
      );
      const maxDepth = getMaxDepth(templateTree);
      if (maxDepth > 10) {
        throw { statusCode: 400, message: `Template hierarchy depth (${maxDepth}) exceeds maximum of 10 levels` };
      }

      for (const slot of slots) {
        const subAgentId = slotToSubaccountAgentId.get(slot.id);
        if (!subAgentId) continue;

        let targetParentId: string | null = null;

        if (slot.parentSlotId) {
          // Has a parent within the template
          targetParentId = slotToSubaccountAgentId.get(slot.parentSlotId) ?? null;
        } else if (parentSubaccountAgentId && rootSlotIds.has(slot.id)) {
          // Root slot + caller specified a parent agent → nest under it
          targetParentId = parentSubaccountAgentId;
        }

        if (targetParentId && targetParentId !== subAgentId) {
          await tx.update(subaccountAgents)
            .set({
              parentSubaccountAgentId: targetParentId,
              agentRole: slot.blueprintRole,
              agentTitle: slot.blueprintTitle,
              updatedAt: new Date(),
            })
            .where(eq(subaccountAgents.id, subAgentId));
          hierarchyUpdated++;
        }
      }

      return {
        templateName: template.name,
        templateVersion: template.version,
        summary: {
          agentsLinked,
          agentsCreated,
          agentsReused,
          agentsDraft,
          hierarchyUpdated,
        },
      };
    });

    return result;
  },

  // ── Load System Agents into Subaccount ──────────────────────────────────

  async loadSystemAgents(
    systemAgentIds: string[],
    organisationId: string,
    subaccountId: string
  ) {
    if (systemAgentIds.length === 0) {
      throw { statusCode: 400, message: 'No system agents selected' };
    }

    const result = await db.transaction(async (tx) => {
      let lockHash = 0;
      for (let i = 0; i < subaccountId.length; i++) {
        lockHash = ((lockHash << 5) - lockHash + subaccountId.charCodeAt(i)) | 0;
      }
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockHash})`);

      let agentsLinked = 0;
      let agentsCreated = 0;
      let agentsReused = 0;

      for (const sysAgentId of systemAgentIds) {
        // Find published system agent
        const [sysAgent] = await tx.select().from(systemAgents)
          .where(and(
            eq(systemAgents.id, sysAgentId),
            eq(systemAgents.isPublished, true),
            isNull(systemAgents.deletedAt)
          ));
        if (!sysAgent) continue;

        // Check if org agent already exists for this system agent
        let orgAgentId: string;
        const [existingOrgAgent] = await tx
          .select({ id: agents.id })
          .from(agents)
          .where(and(
            eq(agents.organisationId, organisationId),
            eq(agents.systemAgentId, sysAgentId),
            isNull(agents.deletedAt)
          ));

        if (existingOrgAgent) {
          orgAgentId = existingOrgAgent.id;
          agentsReused++;
        } else {
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
            agentRole: sysAgent.agentRole,
            agentTitle: sysAgent.agentTitle,
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date(),
          }).returning();
          orgAgentId = newAgent.id;
          agentsCreated++;
        }

        // Link to subaccount if not already linked
        const [existingLink] = await tx
          .select({ id: subaccountAgents.id })
          .from(subaccountAgents)
          .where(and(
            eq(subaccountAgents.subaccountId, subaccountId),
            eq(subaccountAgents.agentId, orgAgentId)
          ));

        if (!existingLink) {
          const [orgAgent] = await tx.select({ defaultSkillSlugs: agents.defaultSkillSlugs })
            .from(agents).where(eq(agents.id, orgAgentId));

          await tx.insert(subaccountAgents).values({
            organisationId,
            subaccountId,
            agentId: orgAgentId,
            isActive: true,
            agentRole: sysAgent.agentRole,
            agentTitle: sysAgent.agentTitle,
            skillSlugs: orgAgent?.defaultSkillSlugs ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          agentsLinked++;
        }
      }

      return { agentsLinked, agentsCreated, agentsReused };
    });

    return result;
  },
};
