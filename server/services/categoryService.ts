import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { taskCategories } from '../db/schema/index.js';

export class CategoryService {
  async listCategories(organisationId: string) {
    const rows = await db
      .select()
      .from(taskCategories)
      .where(and(eq(taskCategories.organisationId, organisationId), isNull(taskCategories.deletedAt)));

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
      .insert(taskCategories)
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
      .from(taskCategories)
      .where(and(eq(taskCategories.id, id), eq(taskCategories.organisationId, organisationId), isNull(taskCategories.deletedAt)));

    if (!category) {
      throw { statusCode: 404, message: 'Category not found' };
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) update.name = data.name;
    if (data.description !== undefined) update.description = data.description;
    if (data.colour !== undefined) update.colour = data.colour;

    const [updated] = await db
      .update(taskCategories)
      .set(update as Parameters<typeof db.update>[0] extends unknown ? never : never)
      .where(eq(taskCategories.id, id))
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
      .from(taskCategories)
      .where(and(eq(taskCategories.id, id), eq(taskCategories.organisationId, organisationId), isNull(taskCategories.deletedAt)));

    if (!category) {
      throw { statusCode: 404, message: 'Category not found' };
    }

    const now = new Date();
    await db.update(taskCategories).set({ deletedAt: now, updatedAt: now }).where(eq(taskCategories.id, id));

    return { message: 'Category deleted successfully' };
  }
}

export const categoryService = new CategoryService();
