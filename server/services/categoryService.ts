import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { processCategories } from '../db/schema/index.js';

export class CategoryService {
  async listCategories(organisationId: string) {
    const rows = await db
      .select()
      .from(processCategories)
      .where(and(eq(processCategories.organisationId, organisationId), isNull(processCategories.deletedAt)));

    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      colour: c.colour,
      createdAt: c.createdAt,
    }));
  }

  async createCategory(
    organisationId: string,
    data: { name: string; description?: string; colour?: string }
  ) {
    const [category] = await db
      .insert(processCategories)
      .values({
        organisationId,
        name: data.name,
        description: data.description,
        colour: data.colour,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return {
      id: category.id,
      name: category.name,
      colour: category.colour,
    };
  }

  async updateCategory(
    id: string,
    organisationId: string,
    data: { name?: string; description?: string; colour?: string }
  ) {
    const [category] = await db
      .select()
      .from(processCategories)
      .where(and(eq(processCategories.id, id), eq(processCategories.organisationId, organisationId), isNull(processCategories.deletedAt)));

    if (!category) {
      throw { statusCode: 404, message: 'Category not found' };
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) update.name = data.name;
    if (data.description !== undefined) update.description = data.description;
    if (data.colour !== undefined) update.colour = data.colour;

    const [updated] = await db
      .update(processCategories)
      .set(update as Parameters<typeof db.update>[0] extends unknown ? never : never)
      .where(and(eq(processCategories.id, id), eq(processCategories.organisationId, organisationId)))
      .returning();

    return {
      id: updated.id,
      name: updated.name,
      colour: updated.colour,
    };
  }

  async deleteCategory(id: string, organisationId: string) {
    const [category] = await db
      .select()
      .from(processCategories)
      .where(and(eq(processCategories.id, id), eq(processCategories.organisationId, organisationId), isNull(processCategories.deletedAt)));

    if (!category) {
      throw { statusCode: 404, message: 'Category not found' };
    }

    const now = new Date();
    await db.update(processCategories).set({ deletedAt: now, updatedAt: now }).where(and(eq(processCategories.id, id), eq(processCategories.organisationId, organisationId)));

    return { message: 'Category deleted successfully' };
  }
}

export const categoryService = new CategoryService();
