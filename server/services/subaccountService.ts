import { eq, and, isNull, desc } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import {
  subaccounts,
  subaccountCategories,
  subaccountAutomationLinks,
  subaccountUserAssignments,
  automations,
  users,
  permissionSets,
} from '../db/schema/index.js';

// ---------------------------------------------------------------------------
// Subaccount Service — CRUD and sub-resource operations for subaccounts
// ---------------------------------------------------------------------------

// ─── Subaccounts ─────────────────────────────────────────────────────────────

export async function listSubaccounts(organisationId: string) {
  return getOrgScopedDb('subaccountService.listSubaccounts')
    .select()
    .from(subaccounts)
    .where(and(eq(subaccounts.organisationId, organisationId), isNull(subaccounts.deletedAt)))
    .orderBy(desc(subaccounts.createdAt));
}

export async function createSubaccount(
  organisationId: string,
  data: {
    name: string;
    slug: string;
    status: 'active' | 'suspended' | 'inactive';
    settings?: Record<string, unknown> | null;
  },
) {
  const [sa] = await getOrgScopedDb('subaccountService.createSubaccount')
    .insert(subaccounts)
    .values({
      organisationId,
      name: data.name,
      slug: data.slug,
      status: data.status,
      settings: data.settings ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  return sa;
}

export async function updateSubaccount(
  subaccountId: string,
  organisationId: string,
  update: Record<string, unknown>,
) {
  const [updated] = await getOrgScopedDb('subaccountService.updateSubaccount')
    .update(subaccounts)
    .set(update as Record<string, unknown>)
    .where(and(eq(subaccounts.id, subaccountId), eq(subaccounts.organisationId, organisationId)))
    .returning();
  return updated;
}

export async function softDeleteSubaccount(subaccountId: string, organisationId: string) {
  const now = new Date();
  await getOrgScopedDb('subaccountService.softDeleteSubaccount').update(subaccounts).set({ deletedAt: now, updatedAt: now }).where(and(eq(subaccounts.id, subaccountId), eq(subaccounts.organisationId, organisationId)));
}

export async function updateSubaccountSettings(
  subaccountId: string,
  organisationId: string,
  settings: Record<string, unknown>,
) {
  await getOrgScopedDb('subaccountService.updateSubaccountSettings').update(subaccounts).set({ settings, updatedAt: new Date() }).where(and(eq(subaccounts.id, subaccountId), eq(subaccounts.organisationId, organisationId)));
}

// ─── Subaccount Categories ────────────────────────────────────────────────────

export async function listSubaccountCategories(subaccountId: string) {
  return getOrgScopedDb('subaccountService.listSubaccountCategories')
    .select()
    .from(subaccountCategories)
    .where(and(eq(subaccountCategories.subaccountId, subaccountId), isNull(subaccountCategories.deletedAt)));
}

export async function createSubaccountCategory(
  subaccountId: string,
  data: { name: string; description?: string | null; colour?: string | null },
) {
  const [cat] = await getOrgScopedDb('subaccountService.createSubaccountCategory')
    .insert(subaccountCategories)
    .values({
      subaccountId,
      name: data.name,
      description: data.description ?? null,
      colour: data.colour ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  return cat;
}

export async function getSubaccountCategory(categoryId: string, subaccountId: string) {
  const [cat] = await getOrgScopedDb('subaccountService.getSubaccountCategory')
    .select()
    .from(subaccountCategories)
    .where(
      and(
        eq(subaccountCategories.id, categoryId),
        eq(subaccountCategories.subaccountId, subaccountId),
        isNull(subaccountCategories.deletedAt),
      ),
    );
  return cat ?? null;
}

export async function updateSubaccountCategory(
  categoryId: string,
  update: Record<string, unknown>,
) {
  const [updated] = await getOrgScopedDb('subaccountService.updateSubaccountCategory')
    .update(subaccountCategories)
    .set(update as Record<string, unknown>)
    .where(eq(subaccountCategories.id, categoryId))
    .returning();
  return updated;
}

export async function softDeleteSubaccountCategory(categoryId: string) {
  const now = new Date();
  await getOrgScopedDb('subaccountService.softDeleteSubaccountCategory')
    .update(subaccountCategories)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(subaccountCategories.id, categoryId));
}

// ─── Subaccount Automation Links ──────────────────────────────────────────────

export async function listSubaccountAutomationLinks(subaccountId: string) {
  const links = await getOrgScopedDb('subaccountService.listSubaccountAutomationLinks')
    .select({
      linkId: subaccountAutomationLinks.id,
      processId: subaccountAutomationLinks.processId,
      subaccountCategoryId: subaccountAutomationLinks.subaccountCategoryId,
      isActive: subaccountAutomationLinks.isActive,
      linkCreatedAt: subaccountAutomationLinks.createdAt,
      processName: automations.name,
      processStatus: automations.status,
      processDescription: automations.description,
      processWebhookPath: automations.webhookPath,
    })
    .from(subaccountAutomationLinks)
    .innerJoin(automations, eq(automations.id, subaccountAutomationLinks.processId))
    .where(eq(subaccountAutomationLinks.subaccountId, subaccountId));

  return links;
}

export async function listSubaccountNativeAutomations(subaccountId: string) {
  return getOrgScopedDb('subaccountService.listSubaccountNativeAutomations')
    .select()
    .from(automations)
    .where(and(eq(automations.subaccountId, subaccountId), isNull(automations.deletedAt)));
}

export async function findOrgAutomation(processId: string, organisationId: string) {
  const [process] = await getOrgScopedDb('subaccountService.findOrgAutomation')
    .select()
    .from(automations)
    .where(and(eq(automations.id, processId), eq(automations.organisationId, organisationId), isNull(automations.deletedAt)));
  return process ?? null;
}

export async function createSubaccountAutomationLink(data: {
  subaccountId: string;
  processId: string;
  subaccountCategoryId?: string | null;
}) {
  const [link] = await getOrgScopedDb('subaccountService.createSubaccountAutomationLink')
    .insert(subaccountAutomationLinks)
    .values({
      subaccountId: data.subaccountId,
      processId: data.processId,
      subaccountCategoryId: data.subaccountCategoryId ?? null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  return link;
}

export async function getSubaccountAutomationLink(linkId: string, subaccountId: string) {
  const [link] = await getOrgScopedDb('subaccountService.getSubaccountAutomationLink')
    .select()
    .from(subaccountAutomationLinks)
    .where(
      and(
        eq(subaccountAutomationLinks.id, linkId),
        eq(subaccountAutomationLinks.subaccountId, subaccountId),
      ),
    );
  return link ?? null;
}

export async function updateSubaccountAutomationLink(
  linkId: string,
  update: Record<string, unknown>,
) {
  const [updated] = await getOrgScopedDb('subaccountService.updateSubaccountAutomationLink')
    .update(subaccountAutomationLinks)
    .set(update as Record<string, unknown>)
    .where(eq(subaccountAutomationLinks.id, linkId))
    .returning();
  return updated;
}

export async function deleteSubaccountAutomationLink(linkId: string) {
  await getOrgScopedDb('subaccountService.deleteSubaccountAutomationLink').delete(subaccountAutomationLinks).where(eq(subaccountAutomationLinks.id, linkId));
}

// ─── Subaccount Members ───────────────────────────────────────────────────────

export async function listSubaccountMembers(subaccountId: string) {
  return getOrgScopedDb('subaccountService.listSubaccountMembers')
    .select({
      assignmentId: subaccountUserAssignments.id,
      userId: subaccountUserAssignments.userId,
      permissionSetId: subaccountUserAssignments.permissionSetId,
      assignedAt: subaccountUserAssignments.createdAt,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      status: users.status,
      permissionSetName: permissionSets.name,
    })
    .from(subaccountUserAssignments)
    .innerJoin(users, eq(users.id, subaccountUserAssignments.userId))
    .innerJoin(permissionSets, eq(permissionSets.id, subaccountUserAssignments.permissionSetId))
    .where(eq(subaccountUserAssignments.subaccountId, subaccountId));
}

export async function findOrgUser(userId: string, organisationId: string) {
  const [user] = await getOrgScopedDb('subaccountService.findOrgUser')
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.organisationId, organisationId), isNull(users.deletedAt)));
  return user ?? null;
}

export async function findOrgPermissionSet(permissionSetId: string, organisationId: string) {
  const [ps] = await getOrgScopedDb('subaccountService.findOrgPermissionSet')
    .select({ id: permissionSets.id })
    .from(permissionSets)
    .where(and(eq(permissionSets.id, permissionSetId), eq(permissionSets.organisationId, organisationId), isNull(permissionSets.deletedAt)));
  return ps ?? null;
}

export async function createSubaccountMemberAssignment(data: {
  subaccountId: string;
  userId: string;
  permissionSetId: string;
}) {
  const [assignment] = await getOrgScopedDb('subaccountService.createSubaccountMemberAssignment')
    .insert(subaccountUserAssignments)
    .values({
      subaccountId: data.subaccountId,
      userId: data.userId,
      permissionSetId: data.permissionSetId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  return assignment;
}

export async function getSubaccountMemberAssignment(subaccountId: string, userId: string) {
  const [assignment] = await getOrgScopedDb('subaccountService.getSubaccountMemberAssignment')
    .select()
    .from(subaccountUserAssignments)
    .where(
      and(
        eq(subaccountUserAssignments.subaccountId, subaccountId),
        eq(subaccountUserAssignments.userId, userId),
      ),
    );
  return assignment ?? null;
}

export async function updateSubaccountMemberAssignment(
  assignmentId: string,
  permissionSetId: string,
) {
  const [updated] = await getOrgScopedDb('subaccountService.updateSubaccountMemberAssignment')
    .update(subaccountUserAssignments)
    .set({ permissionSetId, updatedAt: new Date() })
    .where(eq(subaccountUserAssignments.id, assignmentId))
    .returning();
  return updated;
}

export async function deleteSubaccountMemberAssignment(assignmentId: string) {
  await getOrgScopedDb('subaccountService.deleteSubaccountMemberAssignment').delete(subaccountUserAssignments).where(eq(subaccountUserAssignments.id, assignmentId));
}
