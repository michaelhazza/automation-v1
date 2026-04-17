import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { organisations } from '../db/schema/index.js';
import {
  PULSE_MAJOR_THRESHOLD_DEFAULTS,
  CURRENCY_DEFAULT,
  type PulseMajorThresholds,
} from '../config/pulseThresholds.js';

export type ResolvedPulseThresholds = PulseMajorThresholds & {
  currencyCode: string;
};

export async function getMajorThresholds(
  orgId: string,
): Promise<ResolvedPulseThresholds> {
  const [org] = await db
    .select({
      threshold: organisations.pulseMajorThreshold,
      currency: organisations.defaultCurrencyCode,
    })
    .from(organisations)
    .where(eq(organisations.id, orgId))
    .limit(1);

  if (!org) {
    throw { statusCode: 404, message: 'Organisation not found', errorCode: 'ORG_NOT_FOUND' };
  }

  const threshold = org.threshold ?? PULSE_MAJOR_THRESHOLD_DEFAULTS;

  return {
    perActionMinor: threshold.perActionMinor,
    perRunMinor: threshold.perRunMinor,
    currencyCode: org.currency ?? CURRENCY_DEFAULT,
  };
}

export async function getOrgCurrency(orgId: string): Promise<string> {
  const { currencyCode } = await getMajorThresholds(orgId);
  return currencyCode;
}
