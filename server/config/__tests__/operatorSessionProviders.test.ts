import { describe, it, expect } from 'vitest';
import {
  OPERATOR_SESSION_PROVIDERS,
  OPERATOR_SESSION_DISCLOSURE_VERSION,
  type ProviderCapabilityEntry,
} from '../operatorSessionProviders.js';

const VALID_CONNECTION_MECHANISMS: ProviderCapabilityEntry['connectionMechanism'][] = [
  'oauth_pkce',
  'device_flow',
  'api_key',
  'none_verified',
];

const VALID_PLAN_DETECTION_MECHANISMS: ProviderCapabilityEntry['planDetectionMechanism'][] = [
  'introspection_api',
  'probe',
  'self_declaration',
  'none',
];

const VALID_REVOCATION_SIGNAL_SUPPORT: ProviderCapabilityEntry['revocationSignalSupport'][] = [
  'push_event',
  'poll',
  'none',
];

describe('OPERATOR_SESSION_PROVIDERS registry', () => {
  it('has at least one provider entry', () => {
    expect(Object.keys(OPERATOR_SESSION_PROVIDERS).length).toBeGreaterThan(0);
  });

  for (const [key, entry] of Object.entries(OPERATOR_SESSION_PROVIDERS)) {
    describe(`provider: ${key}`, () => {
      it('has all 8 required fields', () => {
        expect(entry).toHaveProperty('displayName');
        expect(entry).toHaveProperty('connectionMechanism');
        expect(entry).toHaveProperty('planDetectionMechanism');
        expect(entry).toHaveProperty('refreshSupport');
        expect(entry).toHaveProperty('revocationSignalSupport');
        expect(entry).toHaveProperty('runtimeUseEnabled');
        expect(entry).toHaveProperty('sanctionedTiers');
        expect(entry).toHaveProperty('optInTiers');
      });

      it('displayName is a non-empty string', () => {
        expect(typeof entry.displayName).toBe('string');
        expect(entry.displayName.length).toBeGreaterThan(0);
      });

      it('connectionMechanism is a valid enum value', () => {
        expect(VALID_CONNECTION_MECHANISMS).toContain(entry.connectionMechanism);
      });

      it('planDetectionMechanism is a valid enum value', () => {
        expect(VALID_PLAN_DETECTION_MECHANISMS).toContain(entry.planDetectionMechanism);
      });

      it('refreshSupport is a boolean', () => {
        expect(typeof entry.refreshSupport).toBe('boolean');
      });

      it('revocationSignalSupport is a valid enum value', () => {
        expect(VALID_REVOCATION_SIGNAL_SUPPORT).toContain(entry.revocationSignalSupport);
      });

      it('runtimeUseEnabled is a boolean', () => {
        expect(typeof entry.runtimeUseEnabled).toBe('boolean');
      });

      it('sanctionedTiers is an array', () => {
        expect(Array.isArray(entry.sanctionedTiers)).toBe(true);
      });

      it('optInTiers is an array', () => {
        expect(Array.isArray(entry.optInTiers)).toBe(true);
      });

      it('sanctionedTiers and optInTiers are disjoint', () => {
        const overlap = entry.sanctionedTiers.filter((t) =>
          (entry.optInTiers as string[]).includes(t)
        );
        expect(
          overlap,
          `sanctionedTiers and optInTiers must not overlap; found: ${overlap.join(', ')}`
        ).toEqual([]);
      });
    });
  }
});

describe('OPERATOR_SESSION_DISCLOSURE_VERSION', () => {
  it('is a positive integer >= 1', () => {
    expect(typeof OPERATOR_SESSION_DISCLOSURE_VERSION).toBe('number');
    expect(Number.isInteger(OPERATOR_SESSION_DISCLOSURE_VERSION)).toBe(true);
    expect(OPERATOR_SESSION_DISCLOSURE_VERSION).toBeGreaterThanOrEqual(1);
  });
});
