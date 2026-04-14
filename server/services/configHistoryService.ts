import { eq, and, desc, max, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { configHistory, agents } from '../db/schema/index.js';

/** Canonical set of entity types tracked by config history. */
export const CONFIG_HISTORY_ENTITY_TYPES = new Set([
  'agent', 'subaccount_agent', 'scheduled_task', 'agent_data_source',
  'skill', 'policy_rule', 'permission_set', 'subaccount',
  'workspace_limits', 'org_budget', 'mcp_server_config',
  'agent_trigger', 'connector_config', 'integration_connection',
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RecordHistoryParams {
  entityType: string;
  entityId: string;
  organisationId: string;
  snapshot: Record<string, unknown>;
  changedBy: string | null;
  changeSource: 'ui' | 'api' | 'config_agent' | 'system_sync' | 'restore';
  sessionId?: string | null;
  changeSummary?: string | null;
}

// Fields that should never be stored in snapshots (sensitive data)
const SENSITIVE_FIELDS = new Set([
  'accessToken', 'refreshToken', 'clientIdEnc', 'clientSecretEnc',
  'encryptionKeyEnc', 'webhookSecret', 'password', 'apiKey',
]);

// ---------------------------------------------------------------------------
// Change summary generation — deterministic, not LLM-generated
// ---------------------------------------------------------------------------

function generateChangeSummary(
  entityType: string,
  oldSnapshot: Record<string, unknown> | null,
  newSnapshot: Record<string, unknown>,
): string {
  if (!oldSnapshot) return 'Entity created';

  const changes: string[] = [];
  const allKeys = new Set([...Object.keys(oldSnapshot), ...Object.keys(newSnapshot)]);

  for (const key of allKeys) {
    if (SENSITIVE_FIELDS.has(key)) continue;
    const oldVal = oldSnapshot[key];
    const newVal = newSnapshot[key];

    if (JSON.stringify(oldVal) === JSON.stringify(newVal)) continue;

    // Long text fields — show [changed] not full text
    if (typeof newVal === 'string' && newVal.length > 200) {
      changes.push(`${key}: [changed]`);
    } else if (Array.isArray(newVal) || Array.isArray(oldVal)) {
      // Array diff — show additions and removals
      const oldArr = Array.isArray(oldVal) ? oldVal : [];
      const newArr = Array.isArray(newVal) ? newVal : [];
      const added = newArr.filter((v: unknown) => !oldArr.includes(v));
      const removed = oldArr.filter((v: unknown) => !newArr.includes(v));
      const parts: string[] = [];
      if (added.length) parts.push(`+${added.join(', +')}`);
      if (removed.length) parts.push(`-${removed.join(', -')}`);
      if (parts.length) changes.push(`${key}: [${parts.join('; ')}]`);
    } else {
      changes.push(`${key}: ${formatValue(oldVal)} → ${formatValue(newVal)}`);
    }
  }

  return changes.length ? changes.join('; ') : 'No visible changes';
}

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'string' && val.length > 80) return `"${val.substring(0, 77)}..."`;
  if (typeof val === 'string') return `"${val}"`;
  return String(val);
}

// ---------------------------------------------------------------------------
// Strip sensitive fields from snapshots
// ---------------------------------------------------------------------------

function stripSensitiveFields(snapshot: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(snapshot)) {
    if (!SENSITIVE_FIELDS.has(key)) {
      clean[key] = value;
    }
  }
  return clean;
}

/**
 * Redact masterPrompt from agent snapshots when the agent is system-managed.
 * System agent masterPrompts are platform IP and should not be exposed to org admins.
 */
async function redactSystemAgentSnapshot(
  entityType: string,
  entityId: string,
  organisationId: string,
  snapshot: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (entityType !== 'agent') return snapshot;
  try {
    const [agent] = await db
      .select({ isSystemManaged: agents.isSystemManaged })
      .from(agents)
      .where(and(eq(agents.id, entityId), eq(agents.organisationId, organisationId)));
    if (agent?.isSystemManaged) {
      const { masterPrompt: _, ...rest } = snapshot;
      return rest;
    }
  } catch {
    // Agent may have been deleted — return snapshot unmodified
  }
  return snapshot;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const configHistoryService = {
  /**
   * Record a config history entry for an entity.
   * Call this BEFORE applying mutations (pre-mutation snapshot) for updates/deletes,
   * or AFTER insert for creates (initial state snapshot).
   */
  async recordHistory(params: RecordHistoryParams): Promise<void> {
    const snapshot = stripSensitiveFields(params.snapshot);
    const MAX_RETRIES = 3;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      // Read current max version (scoped by org for correctness)
      const [maxRow] = await db
        .select({ maxVersion: max(configHistory.version) })
        .from(configHistory)
        .where(
          and(
            eq(configHistory.entityType, params.entityType),
            eq(configHistory.entityId, params.entityId),
            eq(configHistory.organisationId, params.organisationId),
          )
        );

      const nextVersion = (maxRow?.maxVersion ?? 0) + 1;

      // Compute change summary if not provided
      let changeSummary = params.changeSummary;
      if (!changeSummary && nextVersion > 1) {
        const [prev] = await db
          .select({ snapshot: configHistory.snapshot })
          .from(configHistory)
          .where(
            and(
              eq(configHistory.entityType, params.entityType),
              eq(configHistory.entityId, params.entityId),
              eq(configHistory.organisationId, params.organisationId),
              eq(configHistory.version, nextVersion - 1),
            )
          );
        changeSummary = generateChangeSummary(
          params.entityType,
          prev?.snapshot as Record<string, unknown> | null,
          snapshot,
        );
      } else if (!changeSummary) {
        changeSummary = 'Entity created';
      }

      try {
        await db.insert(configHistory).values({
          organisationId: params.organisationId,
          entityType: params.entityType,
          entityId: params.entityId,
          version: nextVersion,
          snapshot,
          changedBy: params.changedBy,
          changeSource: params.changeSource,
          sessionId: params.sessionId ?? null,
          changeSummary,
        });
        return; // Success — exit retry loop
      } catch (err) {
        const isUniqueViolation = (err as { code?: string }).code === '23505';
        if (!isUniqueViolation || attempt === MAX_RETRIES - 1) throw err;
        // Unique constraint violation on (entity_type, entity_id, version) — retry with new version
      }
    }
  },

  /**
   * List version history for an entity, ordered by version descending.
   */
  async listHistory(
    entityType: string,
    entityId: string,
    organisationId: string,
    options: { limit?: number; offset?: number } = {},
  ) {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    const rows = await db
      .select({
        id: configHistory.id,
        version: configHistory.version,
        changedAt: configHistory.changedAt,
        changedBy: configHistory.changedBy,
        changeSource: configHistory.changeSource,
        changeSummary: configHistory.changeSummary,
        sessionId: configHistory.sessionId,
      })
      .from(configHistory)
      .where(
        and(
          eq(configHistory.entityType, entityType),
          eq(configHistory.entityId, entityId),
          eq(configHistory.organisationId, organisationId),
        )
      )
      .orderBy(desc(configHistory.version))
      .limit(limit)
      .offset(offset);

    return rows;
  },

  /**
   * Get the full snapshot for a specific version.
   */
  async getVersion(
    entityType: string,
    entityId: string,
    version: number,
    organisationId: string,
  ) {
    const [row] = await db
      .select()
      .from(configHistory)
      .where(
        and(
          eq(configHistory.entityType, entityType),
          eq(configHistory.entityId, entityId),
          eq(configHistory.version, version),
          eq(configHistory.organisationId, organisationId),
        )
      );

    if (!row) return null;
    // Redact system-managed agent masterPrompt from API-facing responses
    const snapshot = await redactSystemAgentSnapshot(entityType, entityId, organisationId, row.snapshot as Record<string, unknown>);
    return { ...row, snapshot };
  },

  /**
   * List all history records for a given config agent session.
   */
  async listSessionHistory(
    sessionId: string,
    organisationId: string,
  ) {
    const rows = await db
      .select()
      .from(configHistory)
      .where(
        and(
          eq(configHistory.sessionId, sessionId),
          eq(configHistory.organisationId, organisationId),
        )
      )
      .orderBy(desc(configHistory.changedAt));

    // Redact system-managed agent masterPrompts
    const redacted = await Promise.all(
      rows.map(async (row: typeof rows[number]) => {
        const snapshot = await redactSystemAgentSnapshot(row.entityType, row.entityId, organisationId, row.snapshot as Record<string, unknown>);
        return { ...row, snapshot };
      })
    );
    return redacted;
  },

  /**
   * Get the latest version number for an entity (0 if no history exists).
   */
  async getLatestVersion(entityType: string, entityId: string, organisationId: string): Promise<number> {
    const [row] = await db
      .select({ maxVersion: max(configHistory.version) })
      .from(configHistory)
      .where(
        and(
          eq(configHistory.entityType, entityType),
          eq(configHistory.entityId, entityId),
          eq(configHistory.organisationId, organisationId),
        )
      );

    return row?.maxVersion ?? 0;
  },
};
