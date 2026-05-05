import { isNull } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

/**
 * Canonical soft-delete filter. MUST appear in join ON clauses, not WHERE,
 * for leftJoin semantics. See DEVELOPMENT_GUIDELINES § 3.
 */
export function isActive<T extends { deletedAt: unknown }>(table: T): SQL<unknown> {
  return isNull((table as unknown as { deletedAt: unknown }).deletedAt as never);
}

export class EntityNotActiveError extends Error {
  readonly statusCode = 410;
  constructor(public entityType: string, public entityId: string) {
    super(`${entityType} ${entityId} is soft-deleted`);
    this.name = 'EntityNotActiveError';
  }
}

/**
 * Runtime assertion that an entity is not soft-deleted.
 * Use at write-path boundaries. Throws EntityNotActiveError (statusCode 410).
 * Use sites: task creation, workflow run start, subaccount agent routing assignment.
 */
export function assertActive<T extends { id: string; deletedAt: unknown }>(
  entity: T | null | undefined,
  entityType: string,
): asserts entity is T & { deletedAt: null } {
  if (!entity) {
    throw new EntityNotActiveError(entityType, '<missing>');
  }
  if (entity.deletedAt != null) {
    throw new EntityNotActiveError(entityType, entity.id);
  }
}
