import { eq, and, isNull, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  permissionGroups,
  permissionGroupMembers,
  permissionGroupCategories,
  users,
  taskCategories,
} from '../db/schema/index.js';

export class PermissionGroupService {
  async listPermissionGroups(organisationId: string) {
    const rows = await db
      .select()
      .from(permissionGroups)
      .where(and(eq(permissionGroups.organisationId, organisationId), isNull(permissionGroups.deletedAt)));

    if (rows.length === 0) return [];

    const groupIds = rows.map((pg) => pg.id);

    const [allMembers, allCategories] = await Promise.all([
      db
        .select()
        .from(permissionGroupMembers)
        .where(inArray(permissionGroupMembers.permissionGroupId, groupIds)),
      db
        .select()
        .from(permissionGroupCategories)
        .where(inArray(permissionGroupCategories.permissionGroupId, groupIds)),
    ]);

    return rows.map((pg) => ({
      id: pg.id,
      name: pg.name,
      description: pg.description,
      memberCount: allMembers.filter((m) => m.permissionGroupId === pg.id).length,
      categoryCount: allCategories.filter((c) => c.permissionGroupId === pg.id).length,
      createdAt: pg.createdAt,
    }));
  }

  async createPermissionGroup(organisationId: string, data: { name: string; description?: string }) {
    const [pg] = await db
      .insert(permissionGroups)
      .values({
        organisationId,
        name: data.name,
        description: data.description,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return { id: pg.id, name: pg.name };
  }

  async getPermissionGroup(id: string, organisationId: string) {
    const [pg] = await db
      .select()
      .from(permissionGroups)
      .where(and(eq(permissionGroups.id, id), eq(permissionGroups.organisationId, organisationId), isNull(permissionGroups.deletedAt)));

    if (!pg) {
      throw { statusCode: 404, message: 'Permission group not found' };
    }

    const members = await db
      .select({
        id: permissionGroupMembers.id,
        userId: permissionGroupMembers.userId,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        role: users.role,
      })
      .from(permissionGroupMembers)
      .innerJoin(users, eq(users.id, permissionGroupMembers.userId))
      .where(eq(permissionGroupMembers.permissionGroupId, id));

    const categories = await db
      .select({
        id: permissionGroupCategories.id,
        categoryId: permissionGroupCategories.categoryId,
        name: taskCategories.name,
        colour: taskCategories.colour,
      })
      .from(permissionGroupCategories)
      .innerJoin(taskCategories, eq(taskCategories.id, permissionGroupCategories.categoryId))
      .where(eq(permissionGroupCategories.permissionGroupId, id));

    return {
      id: pg.id,
      name: pg.name,
      description: pg.description,
      members,
      categories,
    };
  }

  async updatePermissionGroup(id: string, organisationId: string, data: { name?: string; description?: string }) {
    const [pg] = await db
      .select()
      .from(permissionGroups)
      .where(and(eq(permissionGroups.id, id), eq(permissionGroups.organisationId, organisationId), isNull(permissionGroups.deletedAt)));

    if (!pg) {
      throw { statusCode: 404, message: 'Permission group not found' };
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) update.name = data.name;
    if (data.description !== undefined) update.description = data.description;

    const [updated] = await db
      .update(permissionGroups)
      .set(update as Parameters<typeof db.update>[0] extends unknown ? never : never)
      .where(eq(permissionGroups.id, id))
      .returning();

    return { id: updated.id, name: updated.name };
  }

  async deletePermissionGroup(id: string, organisationId: string) {
    const [pg] = await db
      .select()
      .from(permissionGroups)
      .where(and(eq(permissionGroups.id, id), eq(permissionGroups.organisationId, organisationId), isNull(permissionGroups.deletedAt)));

    if (!pg) {
      throw { statusCode: 404, message: 'Permission group not found' };
    }

    const now = new Date();
    await db.update(permissionGroups).set({ deletedAt: now, updatedAt: now }).where(eq(permissionGroups.id, id));

    // Hard delete memberships and category access
    await db.delete(permissionGroupMembers).where(eq(permissionGroupMembers.permissionGroupId, id));
    await db.delete(permissionGroupCategories).where(eq(permissionGroupCategories.permissionGroupId, id));

    return { message: 'Permission group deleted successfully' };
  }

  async addMember(groupId: string, organisationId: string, userId: string) {
    const [pg] = await db
      .select()
      .from(permissionGroups)
      .where(and(eq(permissionGroups.id, groupId), eq(permissionGroups.organisationId, organisationId), isNull(permissionGroups.deletedAt)));

    if (!pg) {
      throw { statusCode: 404, message: 'Permission group or user not found' };
    }

    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), eq(users.organisationId, organisationId), isNull(users.deletedAt)));

    if (!user) {
      throw { statusCode: 404, message: 'Permission group or user not found' };
    }

    const existing = await db
      .select()
      .from(permissionGroupMembers)
      .where(and(eq(permissionGroupMembers.permissionGroupId, groupId), eq(permissionGroupMembers.userId, userId)));

    if (existing.length > 0) {
      throw { statusCode: 409, message: 'User is already a member of this group' };
    }

    const [member] = await db
      .insert(permissionGroupMembers)
      .values({ permissionGroupId: groupId, userId, createdAt: new Date() })
      .returning();

    return { permissionGroupId: member.permissionGroupId, userId: member.userId };
  }

  async removeMember(groupId: string, organisationId: string, userId: string) {
    const [pg] = await db
      .select()
      .from(permissionGroups)
      .where(and(eq(permissionGroups.id, groupId), eq(permissionGroups.organisationId, organisationId), isNull(permissionGroups.deletedAt)));

    if (!pg) {
      throw { statusCode: 404, message: 'Membership record not found' };
    }

    const [member] = await db
      .select()
      .from(permissionGroupMembers)
      .where(and(eq(permissionGroupMembers.permissionGroupId, groupId), eq(permissionGroupMembers.userId, userId)));

    if (!member) {
      throw { statusCode: 404, message: 'Membership record not found' };
    }

    await db
      .delete(permissionGroupMembers)
      .where(and(eq(permissionGroupMembers.permissionGroupId, groupId), eq(permissionGroupMembers.userId, userId)));

    return { message: 'Member removed successfully' };
  }

  async addCategory(groupId: string, organisationId: string, categoryId: string) {
    const [pg] = await db
      .select()
      .from(permissionGroups)
      .where(and(eq(permissionGroups.id, groupId), eq(permissionGroups.organisationId, organisationId), isNull(permissionGroups.deletedAt)));

    if (!pg) {
      throw { statusCode: 404, message: 'Permission group or category not found' };
    }

    const [category] = await db
      .select()
      .from(taskCategories)
      .where(and(eq(taskCategories.id, categoryId), eq(taskCategories.organisationId, organisationId), isNull(taskCategories.deletedAt)));

    if (!category) {
      throw { statusCode: 404, message: 'Permission group or category not found' };
    }

    const existing = await db
      .select()
      .from(permissionGroupCategories)
      .where(and(eq(permissionGroupCategories.permissionGroupId, groupId), eq(permissionGroupCategories.categoryId, categoryId)));

    if (existing.length > 0) {
      throw { statusCode: 409, message: 'Category is already added to this group' };
    }

    const [pgc] = await db
      .insert(permissionGroupCategories)
      .values({ permissionGroupId: groupId, categoryId, createdAt: new Date() })
      .returning();

    return { permissionGroupId: pgc.permissionGroupId, categoryId: pgc.categoryId };
  }

  async removeCategory(groupId: string, organisationId: string, categoryId: string) {
    const [pg] = await db
      .select()
      .from(permissionGroups)
      .where(and(eq(permissionGroups.id, groupId), eq(permissionGroups.organisationId, organisationId), isNull(permissionGroups.deletedAt)));

    if (!pg) {
      throw { statusCode: 404, message: 'Category access record not found' };
    }

    const [pgc] = await db
      .select()
      .from(permissionGroupCategories)
      .where(and(eq(permissionGroupCategories.permissionGroupId, groupId), eq(permissionGroupCategories.categoryId, categoryId)));

    if (!pgc) {
      throw { statusCode: 404, message: 'Category access record not found' };
    }

    await db
      .delete(permissionGroupCategories)
      .where(and(eq(permissionGroupCategories.permissionGroupId, groupId), eq(permissionGroupCategories.categoryId, categoryId)));

    return { message: 'Category access removed successfully' };
  }
}

export const permissionGroupService = new PermissionGroupService();
