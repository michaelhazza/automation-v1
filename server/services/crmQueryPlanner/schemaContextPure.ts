// Schema context — pure compression + filtering (spec §11.11)
// Compresses entity schemas to fit within a token budget for Stage 3.
// v1 uses static-ranked top-N fields per entity (hardcoded list);
// frequency-weighted ranking is deferred (spec §22.4).

import type { NormalisedIntent, PrimaryEntity } from '../../../shared/types/crmQueryPlanner.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SchemaField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'array';
  numeric?: boolean;         // true → eligible for sum/avg aggregation
  liveOnly?: boolean;        // true → not in canonical; requires live executor
  description?: string;
}

export interface EntitySchema {
  entity: PrimaryEntity;
  fields: SchemaField[];
}

export interface SchemaContext {
  entities: EntitySchema[];
  version: number;          // incremented on schema change; used as cache key
}

// ── Static top-N ranked fields per entity (v1) ───────────────────────────────
// Order = priority (most-commonly-used first). Filtered to fit token budget.

const TOP_FIELDS: Record<PrimaryEntity, SchemaField[]> = {
  contacts: [
    { name: 'id',             type: 'string' },
    { name: 'firstName',      type: 'string' },
    { name: 'lastName',       type: 'string' },
    { name: 'email',          type: 'string' },
    { name: 'phone',          type: 'string' },
    { name: 'tags',           type: 'array' },
    { name: 'lastActivityAt', type: 'date' },
    { name: 'createdAt',      type: 'date' },
    { name: 'assignedUserId', type: 'string' },
    { name: 'source',         type: 'string' },
    { name: 'city',           type: 'string', liveOnly: true },
    { name: 'country',        type: 'string', liveOnly: true },
    { name: 'customFields',   type: 'array',  liveOnly: true },
  ],
  opportunities: [
    { name: 'id',             type: 'string' },
    { name: 'name',           type: 'string' },
    { name: 'stage',          type: 'string' },
    { name: 'status',         type: 'string' },
    { name: 'amount',         type: 'number', numeric: true },
    { name: 'updatedAt',      type: 'date' },
    { name: 'createdAt',      type: 'date' },
    { name: 'closedAt',       type: 'date' },
    { name: 'assignedUserId', type: 'string' },
    { name: 'contactId',      type: 'string' },
    { name: 'pipelineId',     type: 'string', liveOnly: true },
    { name: 'monetaryValue',  type: 'number', numeric: true },
  ],
  appointments: [
    { name: 'id',             type: 'string' },
    { name: 'title',          type: 'string' },
    { name: 'startTime',      type: 'date' },
    { name: 'endTime',        type: 'date' },
    { name: 'status',         type: 'string' },
    { name: 'contactId',      type: 'string' },
    { name: 'assignedUserId', type: 'string' },
    { name: 'calendarId',     type: 'string', liveOnly: true },
    { name: 'appointmentType',type: 'string', liveOnly: true },
  ],
  conversations: [
    { name: 'id',             type: 'string' },
    { name: 'type',           type: 'string' },
    { name: 'status',         type: 'string' },
    { name: 'lastMessageAt',  type: 'date' },
    { name: 'contactId',      type: 'string' },
    { name: 'assignedUserId', type: 'string' },
    { name: 'unreadCount',    type: 'number', numeric: true, liveOnly: true },
  ],
  revenue: [
    { name: 'period',         type: 'string' },
    { name: 'amount',         type: 'number', numeric: true },
    { name: 'invoiceCount',   type: 'number', numeric: true },
    { name: 'currency',       type: 'string' },
  ],
  tasks: [
    { name: 'id',             type: 'string' },
    { name: 'title',          type: 'string' },
    { name: 'status',         type: 'string' },
    { name: 'dueDate',        type: 'date' },
    { name: 'assignedUserId', type: 'string' },
    { name: 'contactId',      type: 'string' },
    { name: 'completedAt',    type: 'date' },
  ],
};

const ALL_ENTITIES: PrimaryEntity[] = ['contacts', 'opportunities', 'appointments', 'conversations', 'revenue', 'tasks'];

// ── Token estimation (rough: 4 chars ≈ 1 token) ──────────────────────────────

function roughTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

// ── Filter entities relevant to the intent ────────────────────────────────────

const ENTITY_SYNONYMS: Record<string, PrimaryEntity> = {
  contact: 'contacts',
  lead: 'contacts',
  leads: 'contacts',
  customer: 'contacts',
  customers: 'contacts',
  deal: 'opportunities',
  deals: 'opportunities',
  pipeline: 'opportunities',
  appointment: 'appointments',
  meeting: 'appointments',
  meetings: 'appointments',
  conversation: 'conversations',
  message: 'conversations',
  messages: 'conversations',
  task: 'tasks',
  tasks: 'tasks',
  revenue: 'revenue',
  sale: 'revenue',
  sales: 'revenue',
};

export function detectRelevantEntities(intent: NormalisedIntent): PrimaryEntity[] {
  const mentioned = new Set<PrimaryEntity>();
  for (const token of intent.tokens) {
    if (ALL_ENTITIES.includes(token as PrimaryEntity)) mentioned.add(token as PrimaryEntity);
    const mapped = ENTITY_SYNONYMS[token];
    if (mapped) mentioned.add(mapped);
  }
  return mentioned.size > 0 ? Array.from(mentioned) : ALL_ENTITIES;
}

// ── Schema rendering ──────────────────────────────────────────────────────────

function renderEntitySchema(entity: PrimaryEntity, fields: SchemaField[]): string {
  const fieldList = fields
    .map(f => {
      const parts = [f.name, f.type];
      if (f.numeric) parts.push('numeric');
      if (f.liveOnly) parts.push('live-only');
      return parts.join(':');
    })
    .join(', ');
  return `${entity}: ${fieldList}`;
}

// ── Main export: buildSchemaContextText ──────────────────────────────────────

export function buildSchemaContextText(
  intent: NormalisedIntent,
  tokenBudget: number,
): string {
  const relevantEntities = detectRelevantEntities(intent);
  const lines: string[] = [];
  let tokens = 0;

  for (const entity of relevantEntities) {
    const allFields = TOP_FIELDS[entity] ?? [];
    // Progressively narrow the field list until it fits, starting from all
    let includedFields = allFields;
    let line = renderEntitySchema(entity, includedFields);
    while (roughTokenCount(line) > tokenBudget / relevantEntities.length && includedFields.length > 3) {
      includedFields = includedFields.slice(0, Math.ceil(includedFields.length * 0.75));
      line = renderEntitySchema(entity, includedFields);
    }
    if (tokens + roughTokenCount(line) > tokenBudget) break;
    lines.push(line);
    tokens += roughTokenCount(line);
  }

  return lines.join('\n');
}

// ── Helper used by schemaContextService + tests ───────────────────────────────

export function getTopFieldsForEntity(entity: PrimaryEntity): SchemaField[] {
  return TOP_FIELDS[entity] ?? [];
}

export { TOP_FIELDS, ALL_ENTITIES };
