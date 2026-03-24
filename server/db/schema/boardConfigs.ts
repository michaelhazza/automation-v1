import { pgTable, uuid, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { boardTemplates } from './boardTemplates';
import type { BoardColumn } from './boardTemplates';

export const boardConfigs = pgTable(
  'board_configs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .references(() => subaccounts.id),
    columns: jsonb('columns').notNull().$type<BoardColumn[]>(),
    sourceTemplateId: uuid('source_template_id')
      .references(() => boardTemplates.id),
    sourceConfigId: uuid('source_config_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('board_configs_org_idx').on(table.organisationId),
    orgSubaccountUniqueIdx: uniqueIndex('board_configs_org_subaccount_unique_idx')
      .on(table.organisationId, table.subaccountId)
      .where(sql`${table.subaccountId} IS NOT NULL`),
    orgDefaultUniqueIdx: uniqueIndex('board_configs_org_default_unique_idx')
      .on(table.organisationId)
      .where(sql`${table.subaccountId} IS NULL`),
  })
);

export type BoardConfig = typeof boardConfigs.$inferSelect;
export type NewBoardConfig = typeof boardConfigs.$inferInsert;
