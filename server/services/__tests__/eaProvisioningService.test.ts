/**
 * eaProvisioningService.test.ts — Shape-pinning tests for EA provisioning.
 *
 * Pure tests only — no DB / no env imports.
 *
 * Runnable via:
 *   npx vitest run server/services/__tests__/eaProvisioningService.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  buildVoiceProfileInsertValues,
  type EAProvisionContext,
} from '../eaProvisioningService.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ctx: EAProvisionContext = {
  userId: 'user-uuid-123',
  organisationId: 'org-uuid-456',
};

// ---------------------------------------------------------------------------
// Voice profile provisioning shape (spec §13.4 step 6 / REQ-C4)
// ---------------------------------------------------------------------------

describe('voice profile provisioning shape', () => {
  it('sets organisationId and ownerUserId from context', () => {
    const values = buildVoiceProfileInsertValues(ctx);
    expect(values.organisationId).toBe('org-uuid-456');
    expect(values.ownerUserId).toBe('user-uuid-123');
  });

  it('sets sources to gmail_sent_sampler', () => {
    const values = buildVoiceProfileInsertValues(ctx);
    expect(values.sources).toEqual(['gmail_sent_sampler']);
  });

  it('sets sourceConfig with correct shape', () => {
    const values = buildVoiceProfileInsertValues(ctx);
    expect(values.sourceConfig).toEqual({
      gmail_sent_sampler: { lastN: 50, sinceDays: 90 },
    });
  });

  it('sets state to pending', () => {
    const values = buildVoiceProfileInsertValues(ctx);
    expect(values.state).toBe('pending');
  });

  it('sets refreshPolicy to periodic (not manual)', () => {
    const values = buildVoiceProfileInsertValues(ctx);
    expect(values.refreshPolicy).toBe('periodic');
    expect(values.refreshPolicy).not.toBe('manual');
  });

  it('sets refreshConfig with 30-day schedule', () => {
    const values = buildVoiceProfileInsertValues(ctx);
    expect(values.refreshConfig).toEqual({ days: 30 });
  });

  it('sets createdAt and updatedAt to Date instances', () => {
    const values = buildVoiceProfileInsertValues(ctx);
    expect(values.createdAt).toBeInstanceOf(Date);
    expect(values.updatedAt).toBeInstanceOf(Date);
  });

  it('does not set optOutAt (implicitly NULL)', () => {
    const values = buildVoiceProfileInsertValues(ctx);
    expect('optOutAt' in values).toBe(false);
  });

  it('full shape matches spec §13.4 step 6', () => {
    const values = buildVoiceProfileInsertValues(ctx);
    expect(values).toMatchObject({
      organisationId: ctx.organisationId,
      ownerUserId: ctx.userId,
      sources: ['gmail_sent_sampler'],
      sourceConfig: { gmail_sent_sampler: { lastN: 50, sinceDays: 90 } },
      state: 'pending',
      refreshPolicy: 'periodic',
      refreshConfig: { days: 30 },
    });
  });
});
