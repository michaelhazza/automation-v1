import { eq, and, isNull, sql } from 'drizzle-orm';
import { createHash } from 'crypto';
import { db } from '../db/index.js';
import {
  systemHierarchyTemplates,
  systemHierarchyTemplateSlots,
  systemAgents,
  agents,
  subaccountAgents,
  hierarchyTemplates,
  orgAgentConfigs,
  organisations,
} from '../db/schema/index.js';
import { metricRegistryService } from './metricRegistryService.js';
import { orgMemoryService } from './orgMemoryService.js';
import { buildTree, getMaxDepth } from './hierarchyService.js';

const PARSER_VERSION = '1.0.0';

function computeManifestHash(manifest: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
}

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

    // Compute manifest hash for idempotency
    const manifestHash = computeManifestHash(manifest);

    // Check for duplicate import
    const [existingByHash] = await db
      .select({ id: systemHierarchyTemplates.id, name: systemHierarchyTemplates.name })
      .from(systemHierarchyTemplates)
      .where(and(
        eq(systemHierarchyTemplates.manifestHash, manifestHash),
        isNull(systemHierarchyTemplates.deletedAt)
      ));

    if (existingByHash) {
      throw {
        statusCode: 409,
        message: `This manifest has already been imported as "${existingByHash.name}" (${existingByHash.id}). Delete the existing template first or modify the manifest before re-importing.`,
      };
    }

    // Load existing system agents for matching
    const sysAgents = await db.select().from(systemAgents).where(isNull(systemAgents.deletedAt));

    // Create template (DB unique constraint on manifest_hash catches race conditions)
    let template;
    try {
      [template] = await db
        .insert(systemHierarchyTemplates)
        .values({
          name: data.name,
          slug: slugify(data.name),
          sourceType: 'paperclip_import',
          paperclipManifest: manifest,
          manifestHash,
          parserVersion: PARSER_VERSION,
          agentCount: paperclipAgents.length,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();
    } catch (err: unknown) {
      const pgErr = err as { code?: string };
      if (pgErr.code === '23505') {
        throw { statusCode: 409, message: 'This manifest has already been imported (concurrent duplicate detected).' };
      }
      throw err;
    }

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
            .from(agents)
            // guard-ignore-next-line: org-scoped-writes reason="read-only SELECT to fetch defaultSkillSlugs; orgAgentId obtained from org-scoped agent provisioning within this same transaction"
            .where(eq(agents.id, orgAgentId));

          const [newLink] = await tx.insert(subaccountAgents).values({
            organisationId,
            subaccountId,
            agentId: orgAgentId,
            isActive: true,
            agentRole: slot.blueprintRole,
            agentTitle: slot.blueprintTitle,
            skillSlugs: orgAgent?.defaultSkillSlugs ?? null,
            appliedTemplateId: template.id,
            appliedTemplateVersion: template.version,
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
            .from(agents)
            // guard-ignore-next-line: org-scoped-writes reason="read-only SELECT to fetch defaultSkillSlugs; orgAgentId obtained from org-scoped agent provisioning within this same transaction"
            .where(eq(agents.id, orgAgentId));

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

  // ── Template Activation: Load to Organisation ─────────────────────────

  async loadToOrg(
    systemTemplateId: string,
    organisationId: string,
    operatorInputs?: Record<string, unknown>
  ): Promise<{
    success: boolean;
    agentsProvisioned: number;
    orgAgentConfigsCreated: number;
    memorySeedsInserted: number;
    warnings: string[];
    errors: string[];
  }> {
    const warnings: string[] = [];
    const errors: string[] = [];

    // 1. Load template + slots (must be published and not deleted)
    const [template] = await db
      .select()
      .from(systemHierarchyTemplates)
      .where(and(
        eq(systemHierarchyTemplates.id, systemTemplateId),
        eq(systemHierarchyTemplates.isPublished, true),
        isNull(systemHierarchyTemplates.deletedAt),
      ));

    if (!template) {
      return { success: false, agentsProvisioned: 0, orgAgentConfigsCreated: 0, memorySeedsInserted: 0, warnings, errors: ['Template not found or not published'] };
    }

    const slots = await db
      .select()
      .from(systemHierarchyTemplateSlots)
      .where(eq(systemHierarchyTemplateSlots.templateId, systemTemplateId));

    // 2. Validate metric slugs if connector type is specified
    const connectorType = (template as unknown as Record<string, unknown>).requiredConnectorType as string | undefined;
    const operationalDefaults = (template as unknown as Record<string, unknown>).operationalDefaults as Record<string, unknown> | undefined;
    const metricAvailabilityMode = ((operationalDefaults as Record<string, unknown> | undefined)?.metricAvailabilityMode as string) ?? 'lenient';

    if (connectorType && operationalDefaults) {
      const metricSlugs = extractMetricSlugsFromConfig(operationalDefaults);
      if (metricSlugs.length > 0) {
        const validation = await metricRegistryService.validateMetricSlugs(connectorType, metricSlugs);
        if (validation.deprecated.length > 0) {
          warnings.push(`Deprecated metrics referenced: ${validation.deprecated.join(', ')}`);
        }
        if (validation.missing.length > 0) {
          if (metricAvailabilityMode === 'strict') {
            return {
              success: false,
              agentsProvisioned: 0,
              orgAgentConfigsCreated: 0,
              memorySeedsInserted: 0,
              warnings,
              errors: [`Missing metrics in strict mode: ${validation.missing.join(', ')}`],
            };
          }
          warnings.push(`Missing metrics (lenient mode): ${validation.missing.join(', ')}`);
        }
      }
    }

    // 3. Create org hierarchy template record
    // Upsert org template — refresh config if template was already loaded
    const existingTemplates = await db
      .select()
      .from(hierarchyTemplates)
      .where(and(
        eq(hierarchyTemplates.organisationId, organisationId),
        eq(hierarchyTemplates.systemTemplateId, template.id),
      ))
      .limit(1);

    let orgTemplateId: string;
    if (existingTemplates.length > 0) {
      // Update existing with fresh config
      await db
        .update(hierarchyTemplates)
        .set({
          operationalConfigSeed: operationalDefaults ?? null,
          name: template.name,
          description: template.description,
          updatedAt: new Date(),
        } as Record<string, unknown>)
        .where(eq(hierarchyTemplates.id, existingTemplates[0].id));
      orgTemplateId = existingTemplates[0].id;
    } else {
      const [newOrgTemplate] = await db
        .insert(hierarchyTemplates)
        .values({
          organisationId,
          name: template.name,
          description: template.description,
          systemTemplateId: template.id,
          operationalConfigSeed: operationalDefaults ?? null,
          status: 'published' as const,
        } as typeof hierarchyTemplates.$inferInsert)
        .returning();
      orgTemplateId = newOrgTemplate.id;
    }

    // Spec §4.8 — set the explicit FK so orgConfigService.getOperationalConfig
    // resolves systemDefaults against the adopted template for newly adopted
    // orgs. Migration 0180 backfills existing rows; this write handles new
    // adoptions going through loadToOrg.
    await db
      .update(organisations)
      .set({ appliedSystemTemplateId: template.id, updatedAt: new Date() })
      .where(eq(organisations.id, organisationId));

    let agentsProvisioned = 0;
    let orgAgentConfigsCreated = 0;

    // 4. Provision agents from slots
    for (const slot of slots) {
      if (!slot.systemAgentId) continue;

      const [sysAgent] = await db
        .select()
        .from(systemAgents)
        .where(eq(systemAgents.id, slot.systemAgentId));
      if (!sysAgent) continue;

      const executionScope = (slot as unknown as Record<string, unknown>).executionScope as string ?? 'subaccount';

      // Create or reuse agent
      const [existingAgent] = await db
        .select()
        .from(agents)
        .where(and(
          eq(agents.organisationId, organisationId),
          eq(agents.systemAgentId, sysAgent.id),
          isNull(agents.deletedAt),
        ))
        .limit(1);

      let agentId: string;
      if (existingAgent) {
        agentId = existingAgent.id;
      } else {
        const [newAgent] = await db
          .insert(agents)
          .values({
            organisationId,
            systemAgentId: sysAgent.id,
            name: sysAgent.name,
            masterPrompt: sysAgent.masterPrompt,
            isSystemManaged: true,
            agentRole: sysAgent.agentRole,
            agentTitle: sysAgent.agentTitle,
          } as typeof agents.$inferInsert)
          .returning();
        agentId = newAgent.id;
        agentsProvisioned++;
      }

      // For org-scoped agents, link to the org subaccount instead of orgAgentConfigs
      // Post-migration 0106: all agents are subaccount-scoped
      if (executionScope === 'org') {
        const { getOrgSubaccount } = await import('./orgSubaccountService.js');
        const orgSa = await getOrgSubaccount(organisationId);
        if (orgSa) {
          const skillEnablementMap = (slot as unknown as Record<string, unknown>).skillEnablementMap as Record<string, boolean> | undefined;
          const enabledSlugs = skillEnablementMap
            ? Object.entries(skillEnablementMap).filter(([_, v]) => v).map(([k]) => k)
            : null;

          await db
            .insert(subaccountAgents)
            .values({
              organisationId,
              subaccountId: orgSa.id,
              agentId,
              isActive: true,
              skillSlugs: enabledSlugs,
              heartbeatEnabled: sysAgent.heartbeatEnabled ?? false,
              heartbeatIntervalHours: sysAgent.heartbeatIntervalHours ?? 4,
            } as typeof subaccountAgents.$inferInsert)
            .onConflictDoNothing();
          orgAgentConfigsCreated++;
        }
      }
    }

    // 5. Seed org memory
    let memorySeedsInserted = 0;
    const memorySeedsJson = (template as unknown as Record<string, unknown>).memorySeedsJson as Array<{ content: string; entryType: string }> | undefined;
    if (memorySeedsJson?.length) {
      for (const seed of memorySeedsJson) {
        try {
          await orgMemoryService.createEntry(organisationId, {
            content: seed.content,
            entryType: seed.entryType,
          });
          memorySeedsInserted++;
        } catch (err) {
          warnings.push(`Failed to seed memory entry: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    return {
      success: errors.length === 0,
      agentsProvisioned,
      orgAgentConfigsCreated,
      memorySeedsInserted,
      warnings,
      errors,
    };
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────

function extractMetricSlugsFromConfig(config: Record<string, unknown>): string[] {
  const slugs = new Set<string>();

  const factors = config.healthScoreFactors as Array<{ metricSlug: string }> | undefined;
  if (factors) factors.forEach(f => slugs.add(f.metricSlug));

  const anomaly = config.anomalyConfig as { metricOverrides?: Record<string, unknown> } | undefined;
  if (anomaly?.metricOverrides) Object.keys(anomaly.metricOverrides).forEach(k => slugs.add(k));

  const signals = config.churnRiskSignals as Array<{ metricSlug?: string }> | undefined;
  if (signals) signals.forEach(s => { if (s.metricSlug) slugs.add(s.metricSlug); });

  return [...slugs];
}
