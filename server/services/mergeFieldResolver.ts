/**
 * Merge-field resolver — I/O wrapper around `mergeFieldResolverPure`.
 *
 * Loads the five V1 namespace inputs from canonical tables (contact, subaccount,
 * signals, org, agency) and delegates to the pure resolver. Used by:
 *   - `POST /api/clientpulse/merge-fields/preview` — editor live preview.
 *   - The intervention primitives (email, sms) at execution time.
 *
 * Contact data is optional — editors don't know the contact until submit, so
 * the preview endpoint falls back to "contact unresolved" for contact.* paths
 * at preview time. Execution-time calls MUST pass contactId to resolve those.
 */

import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { subaccounts } from '../db/schema/subaccounts.js';
import { organisations } from '../db/schema/organisations.js';
import {
  clientPulseHealthSnapshots,
  clientPulseChurnAssessments,
} from '../db/schema/clientPulseCanonicalTables.js';
import {
  resolveMergeFields,
  resolveMergeFieldsOnObject,
  type MergeFieldInputs,
} from './mergeFieldResolverPure.js';

export interface LoadInputsOpts {
  organisationId: string;
  subaccountId: string;
  contact?: Record<string, unknown>;
}

export async function loadMergeFieldInputs(
  opts: LoadInputsOpts,
): Promise<MergeFieldInputs> {
  const [org] = await db
    .select({ id: organisations.id, name: organisations.name })
    .from(organisations)
    .where(eq(organisations.id, opts.organisationId))
    .limit(1);

  const [sub] = await db
    .select({ id: subaccounts.id, name: subaccounts.name, slug: subaccounts.slug })
    .from(subaccounts)
    .where(and(eq(subaccounts.id, opts.subaccountId), eq(subaccounts.organisationId, opts.organisationId)))
    .limit(1);

  // signals.* — latest health snapshot + churn assessment for the subaccount.
  const [snapshot] = await db
    .select()
    .from(clientPulseHealthSnapshots)
    .where(
      and(
        eq(clientPulseHealthSnapshots.organisationId, opts.organisationId),
        eq(clientPulseHealthSnapshots.subaccountId, opts.subaccountId),
      ),
    )
    .orderBy(desc(clientPulseHealthSnapshots.observedAt))
    .limit(1);

  const [assessment] = await db
    .select()
    .from(clientPulseChurnAssessments)
    .where(
      and(
        eq(clientPulseChurnAssessments.organisationId, opts.organisationId),
        eq(clientPulseChurnAssessments.subaccountId, opts.subaccountId),
      ),
    )
    .orderBy(desc(clientPulseChurnAssessments.observedAt))
    .limit(1);

  const signals: Record<string, unknown> = {};
  if (snapshot) {
    signals.healthScore = snapshot.score;
    signals.trend = snapshot.trend;
    signals.observedAt = snapshot.observedAt?.toISOString?.() ?? null;
  }
  if (assessment) {
    signals.band = assessment.band;
    signals.churnRiskScore = assessment.riskScore;
  }

  // V1: agency.* === org.* (no separate agency entity in the schema yet).
  const orgBlock = org
    ? {
        id: org.id,
        name: org.name,
        tradingName: org.name,
      }
    : undefined;

  return {
    contact: opts.contact,
    subaccount: sub
      ? { id: sub.id, name: sub.name, slug: sub.slug }
      : undefined,
    signals: Object.keys(signals).length > 0 ? signals : undefined,
    org: orgBlock,
    agency: orgBlock,
  };
}

export interface PreviewRequest {
  organisationId: string;
  subaccountId: string;
  template: { subject?: string; body?: string };
  contact?: Record<string, unknown>;
}

export interface PreviewResponse {
  subject?: string;
  body?: string;
  unresolved: string[];
}

export async function previewMergeFields(
  req: PreviewRequest,
): Promise<PreviewResponse> {
  const inputs = await loadMergeFieldInputs({
    organisationId: req.organisationId,
    subaccountId: req.subaccountId,
    contact: req.contact,
  });
  const { output, unresolved } = resolveMergeFieldsOnObject(
    { subject: req.template.subject, body: req.template.body },
    inputs,
  );
  return { subject: output.subject, body: output.body, unresolved };
}

/** Re-export for callers that want the pure resolver directly. */
export { resolveMergeFields, resolveMergeFieldsOnObject };
export type { MergeFieldInputs } from './mergeFieldResolverPure.js';
