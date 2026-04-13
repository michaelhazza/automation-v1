/**
 * selectorStore — persistence wrapper for the scraping_selectors table.
 *
 * Provides save (upsert), load, hit/miss tracking, and selector update
 * operations for the adaptive selector engine.
 *
 * Scoping rules:
 *   - organisationId: always required
 *   - subaccountId: null = org-level scraping, set = subaccount-isolated
 *   - urlPattern: glob pattern for URL matching (e.g. "competitor-a.com/pricing*")
 *   - selectorGroup: named group for batch operations (e.g. "competitor-pricing-2026")
 *     Pass null for ungrouped one-off saves.
 *
 * The unique index enforces (orgId, subaccountId, urlPattern, selectorGroup, selectorName).
 * NULLS NOT DISTINCT means two null subaccount_id values collide correctly.
 */

import { eq, and, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { scrapingSelectors } from '../../db/schema/scrapingSelectors.js';
import type { ElementFingerprint } from '../../db/schema/scrapingSelectors.js';

export type { ElementFingerprint };

// ---------------------------------------------------------------------------
// Build the WHERE conditions for the unique key
// ---------------------------------------------------------------------------

function buildUniqueKeyConditions(params: {
  orgId: string;
  subaccountId: string | null;
  urlPattern: string;
  selectorGroup: string | null;
  selectorName: string;
}) {
  const { orgId, subaccountId, urlPattern, selectorGroup, selectorName } = params;
  return and(
    eq(scrapingSelectors.organisationId, orgId),
    subaccountId !== null
      ? eq(scrapingSelectors.subaccountId, subaccountId)
      : isNull(scrapingSelectors.subaccountId),
    eq(scrapingSelectors.urlPattern, urlPattern),
    selectorGroup !== null
      ? eq(scrapingSelectors.selectorGroup, selectorGroup)
      : isNull(scrapingSelectors.selectorGroup),
    eq(scrapingSelectors.selectorName, selectorName),
  );
}

// ---------------------------------------------------------------------------
// Save (upsert) a selector fingerprint
// ---------------------------------------------------------------------------

export async function saveSelector(params: {
  orgId: string;
  subaccountId: string | null;
  urlPattern: string;
  selectorGroup: string | null;
  selectorName: string;
  cssSelector: string;
  fingerprint: ElementFingerprint;
}): Promise<string> {
  const { orgId, subaccountId, urlPattern, selectorGroup, selectorName, cssSelector, fingerprint } = params;

  // Non-atomic upsert pattern (SELECT → INSERT → fallback SELECT).
  // We can't use Drizzle's onConflictDoUpdate with a named index containing NULLs,
  // so we fall back to a manual three-step approach.
  //
  // Under concurrent writes:
  //   - Only one INSERT will succeed (unique constraint enforces it).
  //   - Other concurrent writers hit onConflictDoNothing and re-SELECT.
  //   - Competing fingerprint updates may be lost (last-writer not guaranteed).
  //
  // This is acceptable because selector evolution is eventually consistent and
  // not correctness-critical — concurrent callers scraped the same page at roughly
  // the same time, so the winning fingerprint is equivalent. If selector churn
  // increases under heavy concurrency, revisit with atomic raw SQL UPSERT.
  // A true fix requires INSERT ... ON CONFLICT ... DO UPDATE, blocked here by
  // Drizzle's inability to target NULLS NOT DISTINCT expression indexes.
  const existing = await db
    .select({ id: scrapingSelectors.id })
    .from(scrapingSelectors)
    .where(buildUniqueKeyConditions(params))
    .limit(1);

  if (existing.length > 0) {
    const id = existing[0].id;
    await db
      .update(scrapingSelectors)
      .set({ cssSelector, elementFingerprint: fingerprint, updatedAt: new Date() })
      .where(eq(scrapingSelectors.id, id));
    return id;
  }

  const [row] = await db
    .insert(scrapingSelectors)
    .values({
      organisationId: orgId,
      subaccountId: subaccountId ?? null,
      urlPattern,
      selectorGroup: selectorGroup ?? null,
      selectorName,
      cssSelector,
      elementFingerprint: fingerprint,
      hitCount: 0,
      missCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: scrapingSelectors.id });

  // Race condition: another process inserted concurrently — re-fetch
  if (!row) {
    const [refetched] = await db
      .select({ id: scrapingSelectors.id })
      .from(scrapingSelectors)
      .where(buildUniqueKeyConditions(params))
      .limit(1);
    if (!refetched) throw new Error(`selectorStore.saveSelector: insert and re-fetch both failed`);
    return refetched.id;
  }

  return row.id;
}

// ---------------------------------------------------------------------------
// Load selectors for a URL pattern + group
// ---------------------------------------------------------------------------

export async function loadSelectors(params: {
  orgId: string;
  subaccountId: string | null;
  urlPattern: string;
  selectorGroup: string | null;
}): Promise<Array<typeof scrapingSelectors.$inferSelect>> {
  const { orgId, subaccountId, urlPattern, selectorGroup } = params;

  const conditions = [
    eq(scrapingSelectors.organisationId, orgId),
    eq(scrapingSelectors.urlPattern, urlPattern),
  ];

  if (subaccountId !== null) {
    conditions.push(eq(scrapingSelectors.subaccountId, subaccountId));
  } else {
    conditions.push(isNull(scrapingSelectors.subaccountId));
  }

  if (selectorGroup !== null) {
    conditions.push(eq(scrapingSelectors.selectorGroup, selectorGroup));
  } else {
    conditions.push(isNull(scrapingSelectors.selectorGroup));
  }

  return db
    .select()
    .from(scrapingSelectors)
    .where(and(...conditions));
}

// ---------------------------------------------------------------------------
// Hit / miss tracking
// ---------------------------------------------------------------------------

export async function incrementHit(selectorId: string): Promise<void> {
  await db
    .update(scrapingSelectors)
    .set({
      hitCount: sql`${scrapingSelectors.hitCount} + 1`,
      lastMatchedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(scrapingSelectors.id, selectorId));
}

export async function incrementMiss(selectorId: string): Promise<void> {
  await db
    .update(scrapingSelectors)
    .set({
      missCount: sql`${scrapingSelectors.missCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(scrapingSelectors.id, selectorId));
}

// ---------------------------------------------------------------------------
// Update selector after adaptive re-match
// ---------------------------------------------------------------------------

export async function updateSelector(
  selectorId: string,
  newCssSelector: string,
  newFingerprint: ElementFingerprint,
): Promise<void> {
  await db
    .update(scrapingSelectors)
    .set({
      cssSelector: newCssSelector,
      elementFingerprint: newFingerprint,
      updatedAt: new Date(),
    })
    .where(eq(scrapingSelectors.id, selectorId));
}
