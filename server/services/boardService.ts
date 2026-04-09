import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { boardTemplates, boardConfigs, subaccounts } from '../db/schema/index.js';
import type { BoardColumn } from '../db/schema/boardTemplates.js';

const DEFAULT_BOARD_TEMPLATE_NAME = 'Standard Board';

const DEFAULT_COLUMNS: BoardColumn[] = [
  { key: 'inbox',       label: 'Inbox',       colour: '#6366f1', description: 'New items awaiting triage',         locked: true },
  { key: 'todo',        label: 'To Do',       colour: '#8b5cf6', description: 'Ready to be worked on',            locked: false },
  { key: 'assigned',    label: 'Assigned',     colour: '#f59e0b', description: 'Assigned to an agent',             locked: false },
  { key: 'in_progress', label: 'In Progress',  colour: '#3b82f6', description: 'Currently being worked on',       locked: false },
  { key: 'review',      label: 'Review',       colour: '#ec4899', description: 'Ready for review',                locked: false },
  { key: 'acceptance',  label: 'Acceptance',    colour: '#14b8a6', description: 'Awaiting acceptance by the owner', locked: false },
  { key: 'done',        label: 'Done',         colour: '#22c55e', description: 'Completed',                       locked: true },
];

function validateLockedColumns(columns: BoardColumn[]): void {
  const lockedKeys = DEFAULT_COLUMNS.filter(c => c.locked).map(c => c.key);
  for (const key of lockedKeys) {
    if (!columns.some(c => c.key === key)) {
      throw { statusCode: 400, message: `Locked column "${key}" cannot be removed` };
    }
  }
}

function validateColumnKeys(columns: BoardColumn[]): void {
  const keys = columns.map(c => c.key);
  const unique = new Set(keys);
  if (unique.size !== keys.length) {
    throw { statusCode: 400, message: 'Column keys must be unique' };
  }
  for (const key of keys) {
    if (!/^[a-z][a-z0-9_]*$/.test(key)) {
      throw { statusCode: 400, message: `Invalid column key "${key}". Keys must be lowercase alphanumeric with underscores.` };
    }
  }
}

export const boardService = {
  // ─── Templates (system-level) ───────────────────────────────────────────────

  async listTemplates() {
    return db.select().from(boardTemplates);
  },

  async getTemplate(id: string) {
    const [template] = await db.select().from(boardTemplates).where(eq(boardTemplates.id, id));
    if (!template) throw { statusCode: 404, message: 'Board template not found' };
    return template;
  },

  async createTemplate(data: { name: string; description?: string; columns: BoardColumn[]; isDefault?: boolean }) {
    validateColumnKeys(data.columns);
    validateLockedColumns(data.columns);

    if (data.isDefault) {
      await db.update(boardTemplates).set({ isDefault: false, updatedAt: new Date() }).where(eq(boardTemplates.isDefault, true));
    }

    const [template] = await db
      .insert(boardTemplates)
      .values({
        name: data.name,
        description: data.description ?? null,
        columns: data.columns,
        isDefault: data.isDefault ?? false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return template;
  },

  async updateTemplate(id: string, data: { name?: string; description?: string; columns?: BoardColumn[]; isDefault?: boolean }) {
    const existing = await this.getTemplate(id);

    if (data.columns) {
      validateColumnKeys(data.columns);
      validateLockedColumns(data.columns);
    }

    if (data.isDefault) {
      await db.update(boardTemplates).set({ isDefault: false, updatedAt: new Date() }).where(eq(boardTemplates.isDefault, true));
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) update.name = data.name;
    if (data.description !== undefined) update.description = data.description;
    if (data.columns !== undefined) update.columns = data.columns;
    if (data.isDefault !== undefined) update.isDefault = data.isDefault;

    const [updated] = await db
      .update(boardTemplates)
      .set(update)
      .where(eq(boardTemplates.id, existing.id))
      .returning();

    return updated;
  },

  async deleteTemplate(id: string) {
    const existing = await this.getTemplate(id);
    await db.delete(boardTemplates).where(eq(boardTemplates.id, existing.id));
  },

  // ─── Board Configs (org + subaccount level) ─────────────────────────────────

  async getOrgBoardConfig(organisationId: string) {
    const [config] = await db
      .select()
      .from(boardConfigs)
      .where(and(eq(boardConfigs.organisationId, organisationId), isNull(boardConfigs.subaccountId)));

    return config ?? null;
  },

  async getSubaccountBoardConfig(organisationId: string, subaccountId: string) {
    const [config] = await db
      .select()
      .from(boardConfigs)
      .where(and(eq(boardConfigs.organisationId, organisationId), eq(boardConfigs.subaccountId, subaccountId)));

    return config ?? null;
  },

  async initOrgBoardFromTemplate(organisationId: string, templateId: string) {
    const existing = await this.getOrgBoardConfig(organisationId);
    if (existing) throw { statusCode: 409, message: 'Organisation already has a board configuration' };

    const template = await this.getTemplate(templateId);

    const [config] = await db
      .insert(boardConfigs)
      .values({
        organisationId,
        subaccountId: null,
        columns: template.columns,
        sourceTemplateId: template.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return config;
  },

  async initSubaccountBoard(organisationId: string, subaccountId: string) {
    const existing = await this.getSubaccountBoardConfig(organisationId, subaccountId);
    if (existing) return existing; // Already initialised — idempotent

    const orgConfig = await this.getOrgBoardConfig(organisationId);
    if (!orgConfig) return null; // No org config → nothing to copy

    const [config] = await db
      .insert(boardConfigs)
      .values({
        organisationId,
        subaccountId,
        columns: orgConfig.columns,
        sourceTemplateId: orgConfig.sourceTemplateId,
        sourceConfigId: orgConfig.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return config;
  },

  async updateBoardConfig(configId: string, organisationId: string, columns: BoardColumn[]) {
    const [config] = await db
      .select()
      .from(boardConfigs)
      .where(and(eq(boardConfigs.id, configId), eq(boardConfigs.organisationId, organisationId)));

    if (!config) throw { statusCode: 404, message: 'Board configuration not found' };

    validateColumnKeys(columns);
    validateLockedColumns(columns);

    const [updated] = await db
      .update(boardConfigs)
      .set({ columns, updatedAt: new Date() })
      .where(eq(boardConfigs.id, configId))
      .returning();

    return updated;
  },

  async pushOrgConfigToSubaccounts(organisationId: string, subaccountIds: string[]) {
    const orgConfig = await this.getOrgBoardConfig(organisationId);
    if (!orgConfig) throw { statusCode: 404, message: 'Organisation has no board configuration to push' };

    const results: Array<{ subaccountId: string; action: string }> = [];

    for (const subaccountId of subaccountIds) {
      const existing = await this.getSubaccountBoardConfig(organisationId, subaccountId);
      if (existing) {
        await db
          .update(boardConfigs)
          .set({ columns: orgConfig.columns, sourceConfigId: orgConfig.id, updatedAt: new Date() })
          .where(eq(boardConfigs.id, existing.id));
        results.push({ subaccountId, action: 'updated' });
      } else {
        await db
          .insert(boardConfigs)
          .values({
            organisationId,
            subaccountId,
            columns: orgConfig.columns,
            sourceTemplateId: orgConfig.sourceTemplateId,
            sourceConfigId: orgConfig.id,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        results.push({ subaccountId, action: 'created' });
      }
    }

    return results;
  },

  // ─── Default template seeding ───────────────────────────────────────────────

  async seedDefaultTemplate() {
    const existing = await db.select().from(boardTemplates);
    if (existing.length > 0) return; // Already seeded

    await db.insert(boardTemplates).values({
      name: DEFAULT_BOARD_TEMPLATE_NAME,
      description: 'Standard 7-column board for agency workflows. Inbox and Done columns are locked.',
      columns: DEFAULT_COLUMNS,
      isDefault: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    console.log('[BOARD] Default board template seeded');
  },

  /** Return all active subaccount IDs for an organisation. */
  async listActiveSubaccountIds(organisationId: string): Promise<string[]> {
    const rows = await db
      .select({ id: subaccounts.id })
      .from(subaccounts)
      .where(and(eq(subaccounts.organisationId, organisationId), isNull(subaccounts.deletedAt)));
    return rows.map((r) => r.id);
  },
};
