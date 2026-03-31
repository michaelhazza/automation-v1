import { pgTable, uuid, text, boolean, jsonb, timestamp } from 'drizzle-orm/pg-core';

export interface BoardColumn {
  key: string;
  label: string;
  colour: string;
  description: string;
  locked: boolean;
}

export const boardTemplates = pgTable(
  'board_templates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    columns: jsonb('columns').notNull().$type<BoardColumn[]>(),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  }
);

export type BoardTemplate = typeof boardTemplates.$inferSelect;
export type NewBoardTemplate = typeof boardTemplates.$inferInsert;
