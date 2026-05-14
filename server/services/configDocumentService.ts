/**
 * configDocumentService — thin data-access helpers for the config-document
 * generation and upload routes.
 *
 * Spec: docs/memory-and-briefings-spec.md §9 (S21)
 */

import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { organisations } from '../db/schema/index.js';

/**
 * Returns the display name of the organisation, or null if not found.
 */
export async function getOrganisationName(organisationId: string): Promise<string | null> {
  const [org] = await db
    .select({ name: organisations.name })
    .from(organisations)
    .where(eq(organisations.id, organisationId))
    .limit(1);
  return org?.name ?? null;
}
