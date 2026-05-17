import { eq, and, desc, isNull, sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../../lib/orgScopedDb.js';
import { workspaceEntities } from '../../db/schema/index.js';
import { routeCall } from '../llmRouter.js';
import {
  EXTRACTION_MAX_TOKENS,
  MAX_PROMPT_ENTITIES,
  MAX_ENTITIES_PER_EXTRACTION,
  MIN_ENTITY_CONFIDENCE,
  MAX_ENTITY_ATTRIBUTES,
} from '../../config/limits.js';
import { assertScope } from '../../lib/scopeAssertion.js';

// ---------------------------------------------------------------------------
// Entity Extraction
// ---------------------------------------------------------------------------

export async function extractEntities(
  runId: string,
  organisationId: string,
  subaccountId: string,
  runSummary: string
): Promise<void> {
  if (!runSummary || runSummary.trim().length < 20) return;

  try {
    const response = await routeCall({
      messages: [{ role: 'user', content: `Agent run summary:\n\n${runSummary}` }],
      system: `You are a named entity extractor. Extract key named entities from the agent run summary.
Only include entities you are highly confident are real and explicitly mentioned.
Do not infer or guess. Confidence: 1.0 = explicitly named, 0.7 = clearly referenced.
Each entity has:
  - "name": the entity name (as written)
  - "entityType": one of "person", "company", "product", "project", "location", "other"
  - "attributes": object of key facts (max 5 keys)
  - "confidence": 0.0-1.0

Respond ONLY with valid JSON: { "entities": [...] }
If none found: { "entities": [] }`,
      temperature: 0.1,
      maxTokens: EXTRACTION_MAX_TOKENS,
      context: {
        organisationId,
        subaccountId,
        runId,
        sourceType: 'agent_run',
        taskType: 'memory_compile',
        executionPhase: 'execution',
        routingMode: 'ceiling',
      },
    });

    let rawEntities: Array<{
      name: string;
      entityType: string;
      attributes?: Record<string, unknown>;
      confidence?: number;
    }> = [];

    try {
      const parsed = JSON.parse(response.content);
      rawEntities = Array.isArray(parsed.entities) ? parsed.entities : [];
    } catch {
      const match = response.content.match(/\{[\s\S]*"entities"[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        rawEntities = Array.isArray(parsed.entities) ? parsed.entities : [];
      }
    }

    const VALID_ENTITY_TYPES = ['person', 'company', 'product', 'project', 'location', 'other'] as const;
    let stored = 0;
    let skipped = 0;
    const entityScopedDb = getOrgScopedDb('entities.extractEntities');

    for (const entity of rawEntities.slice(0, MAX_ENTITIES_PER_EXTRACTION)) {
      if (!entity.name || !VALID_ENTITY_TYPES.includes(entity.entityType as typeof VALID_ENTITY_TYPES[number])) {
        skipped++;
        continue;
      }

      if ((entity.confidence ?? 0) < MIN_ENTITY_CONFIDENCE) {
        skipped++;
        continue;
      }

      const normalizedName = entity.name.trim().toLowerCase().replace(/\s+/g, ' ');
      const newAttributes = entity.attributes ?? {};

      // Upsert with Phase 2A temporal validity — detect attribute conflicts
      // and supersede old entity instead of blindly merging
      const existing = await entityScopedDb
        .select()
        .from(workspaceEntities)
        .where(
          and(
            eq(workspaceEntities.subaccountId, subaccountId),
            eq(workspaceEntities.name, normalizedName),
            eq(workspaceEntities.entityType, entity.entityType as typeof VALID_ENTITY_TYPES[number]),
            isNull(workspaceEntities.deletedAt),
            isNull(workspaceEntities.validTo),  // only match currently-valid entities
          )
        )
        .limit(1);

      if (existing.length > 0) {
        const prev = existing[0];
        const prevAttrs = (prev.attributes as Record<string, unknown>) ?? {};

        // Phase 2A: Detect attribute conflicts (same key, different value)
        const hasConflict = Object.keys(newAttributes).some(
          key => key in prevAttrs && JSON.stringify(prevAttrs[key]) !== JSON.stringify(newAttributes[key])
        );

        if (hasConflict) {
          // Supersede: close old entity, create new version
          await entityScopedDb
            .update(workspaceEntities)
            .set({ validTo: new Date(), updatedAt: new Date() })
            .where(eq(workspaceEntities.id, prev.id));

          const capped = Object.fromEntries(Object.entries(newAttributes).slice(0, MAX_ENTITY_ATTRIBUTES));
          await entityScopedDb
            .insert(workspaceEntities)
            .values({
              organisationId,
              subaccountId,
              name: normalizedName,
              displayName: entity.name.trim(),
              entityType: entity.entityType as typeof VALID_ENTITY_TYPES[number],
              attributes: capped,
              confidence: entity.confidence ?? null,
              mentionCount: prev.mentionCount + 1,
              firstSeenAt: prev.firstSeenAt ?? new Date(),
              lastSeenAt: new Date(),
              validFrom: new Date(),
              supersededBy: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .onConflictDoNothing();

          // Point old entity to new (best-effort — new id not easily available
          // without a RETURNING clause, so we skip the FK link for now)
        } else {
          // No conflict — standard upsert
          const merged = { ...prevAttrs, ...newAttributes };
          const capped = Object.fromEntries(Object.entries(merged).slice(0, MAX_ENTITY_ATTRIBUTES));

          await entityScopedDb
            .update(workspaceEntities)
            .set({
              mentionCount: prev.mentionCount + 1,
              attributes: capped,
              confidence: entity.confidence ?? prev.confidence,
              lastSeenAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(workspaceEntities.id, prev.id));
        }
      } else {
        const capped = Object.fromEntries(Object.entries(newAttributes).slice(0, MAX_ENTITY_ATTRIBUTES));

        await entityScopedDb
          .insert(workspaceEntities)
          .values({
            organisationId,
            subaccountId,
            name: normalizedName,
            displayName: entity.name.trim(),
            entityType: entity.entityType as typeof VALID_ENTITY_TYPES[number],
            attributes: capped,
            confidence: entity.confidence ?? null,
            mentionCount: 1,
            firstSeenAt: new Date(),
            lastSeenAt: new Date(),
            validFrom: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .onConflictDoNothing();
      }

      stored++;
    }

    console.info(`[WorkspaceMemory] Extracted ${stored} entities (${skipped} below confidence) for subaccount ${subaccountId}`);
  } catch (err) {
    console.error('[WorkspaceMemory] Failed to extract entities:', err instanceof Error ? err.message : err);
  }
}

// ---------------------------------------------------------------------------
// Entity Prompt Builder
// ---------------------------------------------------------------------------

export async function getEntitiesForPrompt(
  subaccountId: string,
  organisationId?: string,
  asOf?: Date,  // Phase 2A: optional point-in-time query
): Promise<string | null> {
  const conditions = [
    eq(workspaceEntities.subaccountId, subaccountId),
    isNull(workspaceEntities.deletedAt),
  ];
  if (organisationId) {
    conditions.push(eq(workspaceEntities.organisationId, organisationId));
  }
  // Phase 2A: Temporal validity filter
  if (asOf) {
    conditions.push(sql`${workspaceEntities.validFrom} <= ${asOf}`);
    conditions.push(sql`(${workspaceEntities.validTo} IS NULL OR ${workspaceEntities.validTo} > ${asOf})`);
  } else {
    // Default: only currently-valid entities
    conditions.push(isNull(workspaceEntities.validTo));
  }

  const rawEntities = await getOrgScopedDb('entities.getEntitiesForPrompt')
    .select()
    .from(workspaceEntities)
    .where(and(...conditions))
    .orderBy(desc(workspaceEntities.mentionCount))
    .limit(MAX_PROMPT_ENTITIES);

  // Scope assertion — only when caller passed orgId. Legacy callers
  // still rely on subaccountId filtering alone until they migrate.
  const entities = organisationId
    ? assertScope(
        rawEntities,
        { organisationId, subaccountId },
        'workspaceMemoryService.getEntitiesForPrompt',
      )
    : rawEntities;

  if (entities.length === 0) return null;

  const lines = entities.map(e => {
    const attrs = e.attributes ? Object.entries(e.attributes as Record<string, unknown>)
      .slice(0, 3)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ') : '';
    return `- ${e.displayName} (${e.entityType})${attrs ? ': ' + attrs : ''}`;
  });

  return [
    '<workspace-entities>',
    ...lines,
    '</workspace-entities>',
  ].join('\n');
}
