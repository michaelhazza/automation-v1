import { db } from '../db';
import { permissions, permissionSets, permissionSetItems } from '../db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { ALL_PERMISSIONS, DEFAULT_PERMISSION_SET_TEMPLATES } from '../lib/permissions';

/**
 * Idempotently seed the permissions table with all known atomic permission keys.
 * Safe to run multiple times — existing rows are left unchanged.
 */
export async function seedPermissions(): Promise<void> {
  for (const perm of ALL_PERMISSIONS) {
    const existing = await db
      .select()
      .from(permissions)
      .where(eq(permissions.key, perm.key))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(permissions).values(perm);
    }
  }
}

/**
 * Seed default permission sets for a given organisation.
 * Creates the six default templates (Org Admin, Org Manager, Org Viewer,
 * Subaccount Admin, Subaccount Manager, Subaccount User) if they don't exist.
 *
 * Returns the created/existing permission sets mapped by name.
 */
export async function seedDefaultPermissionSetsForOrg(
  organisationId: string
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};

  for (const template of DEFAULT_PERMISSION_SET_TEMPLATES) {
    // Check if this default set already exists for the org
    const existing = await db
      .select()
      .from(permissionSets)
      .where(
        and(
          eq(permissionSets.organisationId, organisationId),
          eq(permissionSets.name, template.name),
          isNull(permissionSets.deletedAt)
        )
      )
      .limit(1);

    let setId: string;

    if (existing.length > 0) {
      setId = existing[0].id;
    } else {
      const [created] = await db
        .insert(permissionSets)
        .values({
          organisationId,
          name: template.name,
          description: template.description,
          isDefault: true,
        })
        .returning({ id: permissionSets.id });

      setId = created.id;

      // Insert permission items
      for (const key of template.permissionKeys) {
        await db.insert(permissionSetItems).values({
          permissionSetId: setId,
          permissionKey: key,
        });
      }
    }

    result[template.name] = setId;
  }

  return result;
}
