import { eq, and, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { subaccountTags, subaccounts } from '../db/schema/index.js';

export const subaccountTagService = {
  async setTag(organisationId: string, subaccountId: string, key: string, value: string) {
    const [tag] = await db
      .insert(subaccountTags)
      .values({ organisationId, subaccountId, key, value })
      .onConflictDoUpdate({
        target: [subaccountTags.subaccountId, subaccountTags.key],
        set: { value },
      })
      .returning();
    return tag;
  },

  async removeTag(organisationId: string, subaccountId: string, key: string) {
    await db
      .delete(subaccountTags)
      .where(and(
        eq(subaccountTags.organisationId, organisationId),
        eq(subaccountTags.subaccountId, subaccountId),
        eq(subaccountTags.key, key)
      ));
  },

  async getTags(organisationId: string, subaccountId: string) {
    return db
      .select()
      .from(subaccountTags)
      .where(and(eq(subaccountTags.organisationId, organisationId), eq(subaccountTags.subaccountId, subaccountId)));
  },

  /**
   * Get subaccount IDs matching ALL tag filters (AND logic).
   * filters: [{key: 'vertical', value: 'dental'}, {key: 'region', value: 'northeast'}]
   */
  async getSubaccountsByTags(organisationId: string, filters: Array<{ key: string; value: string }>): Promise<string[]> {
    if (filters.length === 0) {
      // No filters — return all active subaccounts
      const rows = await db
        .select({ id: subaccounts.id })
        .from(subaccounts)
        .where(eq(subaccounts.organisationId, organisationId));
      return rows.map(r => r.id);
    }

    // For AND logic: find subaccounts that have ALL specified tags
    // Use HAVING COUNT = number of filters to enforce intersection
    const result = await db.execute(sql`
      SELECT subaccount_id
      FROM subaccount_tags
      WHERE organisation_id = ${organisationId}
        AND (${sql.join(
          filters.map(f => sql`(key = ${f.key} AND value = ${f.value})`),
          sql` OR `
        )})
      GROUP BY subaccount_id
      HAVING COUNT(DISTINCT key) = ${filters.length}
    `);

    return (result.rows as Array<{ subaccount_id: string }>).map(r => r.subaccount_id);
  },

  async bulkSetTag(organisationId: string, subaccountIds: string[], key: string, value: string) {
    const values = subaccountIds.map(subaccountId => ({
      organisationId,
      subaccountId,
      key,
      value,
    }));

    if (values.length === 0) return;

    await db
      .insert(subaccountTags)
      .values(values)
      .onConflictDoUpdate({
        target: [subaccountTags.subaccountId, subaccountTags.key],
        set: { value },
      });
  },

  async listTagKeys(organisationId: string): Promise<string[]> {
    const result = await db.execute(sql`
      SELECT DISTINCT key FROM subaccount_tags
      WHERE organisation_id = ${organisationId}
      ORDER BY key
    `);
    return (result.rows as Array<{ key: string }>).map(r => r.key);
  },
};
