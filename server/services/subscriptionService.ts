import { eq, and, isNull, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { subscriptions, orgSubscriptions } from '../db/schema/index.js';
import type { Subscription, NewSubscription, OrgSubscription, NewOrgSubscription } from '../db/schema/index.js';

// Combined type returned by getOrgSubscription with joined subscription details
export interface OrgSubscriptionWithDetails extends OrgSubscription {
  subscription: {
    slug: string;
    displayName: string;
    description: string | null;
    moduleIds: string[];
    subaccountLimit: number | null;
    priceMonthlyCents: number | null;
    priceYearlyCents: number | null;
    trialDays: number;
    status: string;
  };
}

class SubscriptionService {
  // ---------------------------------------------------------------------------
  // Catalogue CRUD (system admin)
  // ---------------------------------------------------------------------------

  async listSubscriptions(): Promise<Subscription[]> {
    return db.select().from(subscriptions).where(isNull(subscriptions.deletedAt));
  }

  async getSubscription(id: string): Promise<Subscription> {
    const [row] = await db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.id, id), isNull(subscriptions.deletedAt)));

    if (!row) {
      throw { statusCode: 404, message: 'Subscription not found' };
    }
    return row;
  }

  async getSubscriptionBySlug(slug: string): Promise<Subscription> {
    const [row] = await db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.slug, slug), isNull(subscriptions.deletedAt)));

    if (!row) {
      throw { statusCode: 404, message: 'Subscription not found' };
    }
    return row;
  }

  async createSubscription(
    data: Omit<NewSubscription, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>,
  ): Promise<Subscription> {
    const now = new Date();
    const [row] = await db
      .insert(subscriptions)
      .values({ ...data, createdAt: now, updatedAt: now })
      .returning();
    return row;
  }

  async updateSubscription(
    id: string,
    data: Partial<Omit<NewSubscription, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>>,
  ): Promise<Subscription> {
    const [existing] = await db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.id, id), isNull(subscriptions.deletedAt)));

    if (!existing) {
      throw { statusCode: 404, message: 'Subscription not found' };
    }

    const [updated] = await db
      .update(subscriptions)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(subscriptions.id, id), isNull(subscriptions.deletedAt)))
      .returning();

    return updated;
  }

  // ---------------------------------------------------------------------------
  // Per-org assignment
  // ---------------------------------------------------------------------------

  /**
   * Get the active/trialing/past_due subscription for an org, joined with
   * subscription catalogue details.  Returns null if the org has no active sub.
   */
  async getOrgSubscription(orgId: string): Promise<OrgSubscriptionWithDetails | null> {
    const rows = await db
      .select({
        orgSub: orgSubscriptions,
        sub: {
          slug: subscriptions.slug,
          displayName: subscriptions.displayName,
          description: subscriptions.description,
          moduleIds: subscriptions.moduleIds,
          subaccountLimit: subscriptions.subaccountLimit,
          priceMonthlyCents: subscriptions.priceMonthlyCents,
          priceYearlyCents: subscriptions.priceYearlyCents,
          trialDays: subscriptions.trialDays,
          status: subscriptions.status,
        },
      })
      .from(orgSubscriptions)
      .innerJoin(subscriptions, eq(orgSubscriptions.subscriptionId, subscriptions.id))
      .where(
        and(
          eq(orgSubscriptions.organisationId, orgId),
          inArray(orgSubscriptions.status, ['trialing', 'active', 'past_due']),
        ),
      );

    if (rows.length === 0) return null;

    const { orgSub, sub } = rows[0];
    return { ...orgSub, subscription: sub };
  }

  /**
   * Assign a subscription to an org.  If the org already has an active
   * subscription, cancel it first (set status = 'cancelled').  If the
   * subscription has trial_days > 0, the new org_subscription starts in
   * 'trialing' status; otherwise it starts as 'active'.
   */
  async assignSubscription(
    orgId: string,
    subscriptionId: string,
    opts?: { isComped?: boolean },
  ): Promise<OrgSubscription> {
    // Load the subscription to check trial_days
    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.id, subscriptionId), isNull(subscriptions.deletedAt)));

    if (!sub) {
      throw { statusCode: 404, message: 'Subscription not found' };
    }

    const now = new Date();

    // Deactivate any existing active subscription for this org
    await db
      .update(orgSubscriptions)
      .set({ status: 'cancelled', updatedAt: now })
      .where(
        and(
          eq(orgSubscriptions.organisationId, orgId),
          inArray(orgSubscriptions.status, ['trialing', 'active', 'past_due']),
        ),
      );

    // Determine initial status and trial end
    const hasTrialDays = sub.trialDays > 0;
    const status = hasTrialDays ? 'trialing' : 'active';
    const trialEndsAt = hasTrialDays
      ? new Date(now.getTime() + sub.trialDays * 24 * 60 * 60 * 1000)
      : null;

    const [row] = await db
      .insert(orgSubscriptions)
      .values({
        organisationId: orgId,
        subscriptionId,
        status: status as 'trialing' | 'active',
        trialEndsAt,
        isComped: opts?.isComped ?? false,
        currentPeriodStart: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return row;
  }

  /**
   * Cancel the active subscription for an org (set status = 'cancelled').
   */
  async cancelOrgSubscription(orgId: string): Promise<void> {
    const result = await db
      .update(orgSubscriptions)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(
        and(
          eq(orgSubscriptions.organisationId, orgId),
          inArray(orgSubscriptions.status, ['trialing', 'active', 'past_due']),
        ),
      );

    // drizzle pg-js returns the updated rows; if none matched, the org had no active sub
    // This is a no-op in that case, which is safe.
  }

  // ---------------------------------------------------------------------------
  // Trial helpers
  // ---------------------------------------------------------------------------

  /**
   * Find all org subscriptions that are still in 'trialing' status but whose
   * trial has expired.
   */
  async getExpiredTrials(): Promise<OrgSubscription[]> {
    return db
      .select()
      .from(orgSubscriptions)
      .where(
        and(
          eq(orgSubscriptions.status, 'trialing'),
          sql`${orgSubscriptions.trialEndsAt} < NOW()`,
        ),
      );
  }

  /**
   * Expire a single trial by setting its status to 'cancelled'.
   */
  async expireTrial(orgSubId: string): Promise<void> {
    await db
      .update(orgSubscriptions)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(orgSubscriptions.id, orgSubId));
  }
}

export const subscriptionService = new SubscriptionService();
