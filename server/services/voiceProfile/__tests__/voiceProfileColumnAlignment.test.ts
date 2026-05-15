import { describe, it, expect } from 'vitest';
import { voiceProfiles } from '../../../db/schema/voiceProfiles.js';
import { VoiceProfileSchema } from '../../../../shared/types/voiceProfile.js';

// Compile-time proof that the Drizzle schema exports spec-aligned field names.
// The type assertions below fail at typecheck if any field is missing.
type DrizzleRow = typeof voiceProfiles.$inferSelect;
type _AssertSampleSize = DrizzleRow['sampleSize'];
type _AssertLastDerivedAt = DrizzleRow['lastDerivedAt'];
type _AssertOptOutAt = DrizzleRow['optOutAt'];
type _AssertSourceConfig = DrizzleRow['sourceConfig'];
type _AssertRefreshConfig = DrizzleRow['refreshConfig'];

describe('voiceProfiles Drizzle schema — spec-aligned field names', () => {
  it('exports sampleSize (not sampleCount)', () => {
    expect('sampleSize' in voiceProfiles).toBe(true);
  });

  it('does NOT export sampleCount', () => {
    expect('sampleCount' in voiceProfiles).toBe(false);
  });

  it('exports lastDerivedAt (not lastRefreshedAt)', () => {
    expect('lastDerivedAt' in voiceProfiles).toBe(true);
  });

  it('does NOT export lastRefreshedAt', () => {
    expect('lastRefreshedAt' in voiceProfiles).toBe(false);
  });

  it('exports optOutAt (not optedOutAt)', () => {
    expect('optOutAt' in voiceProfiles).toBe(true);
  });

  it('does NOT export optedOutAt', () => {
    expect('optedOutAt' in voiceProfiles).toBe(false);
  });

  it('exports sourceConfig', () => {
    expect('sourceConfig' in voiceProfiles).toBe(true);
  });

  it('exports refreshConfig', () => {
    expect('refreshConfig' in voiceProfiles).toBe(true);
  });
});

describe('VoiceProfileSchema Zod — spec-aligned field names', () => {
  const validRow = {
    id: '00000000-0000-0000-0000-000000000001',
    organisationId: '00000000-0000-0000-0000-000000000002',
    ownerUserId: '00000000-0000-0000-0000-000000000003',
    subaccountId: null,
    orgScope: false,
    sources: ['gmail_sent_sampler'],
    sourceConfig: { gmail_sent_sampler: { lastN: 50, sinceDays: 90 } },
    sampleSize: 42,
    profileJson: null,
    state: 'ready',
    refreshPolicy: 'periodic',
    refreshConfig: { days: 30 },
    lastDerivedAt: '2026-05-01T00:00:00.000Z',
    optOutAt: null,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
  };

  it('parses a row with spec-aligned field names', () => {
    const result = VoiceProfileSchema.safeParse(validRow);
    expect(result.success).toBe(true);
  });

  it('rejects a row using old field name sampleCount', () => {
    const oldRow = {
      ...validRow,
      sampleCount: 42,
      sampleSize: undefined,
    };
    const result = VoiceProfileSchema.safeParse(oldRow);
    expect(result.success).toBe(false);
  });

  it('rejects a row using old field name lastRefreshedAt', () => {
    const oldRow = {
      ...validRow,
      lastRefreshedAt: '2026-05-01T00:00:00.000Z',
      lastDerivedAt: undefined,
    };
    const result = VoiceProfileSchema.safeParse(oldRow);
    expect(result.success).toBe(false);
  });

  it('rejects a row using old field name optedOutAt', () => {
    const oldRow = {
      ...validRow,
      optedOutAt: null,
      optOutAt: undefined,
    };
    const result = VoiceProfileSchema.safeParse(oldRow);
    expect(result.success).toBe(false);
  });
});
