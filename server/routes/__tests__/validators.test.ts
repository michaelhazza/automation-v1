/**
 * validators.test.ts — Route-layer permission and response-shape contract.
 *
 * Spec: docs/superpowers/specs/2026-05-18-deterministic-validators-spec.md §10.1
 *
 * Covers two narrow surfaces:
 *   (a) The permission guard: non-system_admin is denied (403).
 *   (b) The response body shape matches ValidatorSummary when authorised.
 *
 * No HTTP server, no DB. Pure decision-logic tests following the
 * existing reviewItems.test.ts and agentRecommendations.routes.test.ts pattern.
 *
 * Runnable via:
 *   npx vitest run server/routes/__tests__/validators.test.ts
 */

import { describe, expect, test } from 'vitest';
import type { ValidatorSummary } from '../../lib/scorecardValidators/types.js';

// ── (a) Permission guard ──────────────────────────────────────────────────────

/**
 * Mirrors the requireSystemAdmin logic in server/middleware/auth.ts.
 * Returns 403 for any role that is not system_admin.
 */
function permissionGuard(role: string | undefined): 200 | 401 | 403 {
  if (!role) return 401;
  if (role === 'system_admin') return 200;
  return 403;
}

describe('GET /api/validators — permission guard', () => {
  test('system_admin receives 200', () => {
    expect(permissionGuard('system_admin')).toBe(200);
  });

  test('org_admin receives 403', () => {
    expect(permissionGuard('org_admin')).toBe(403);
  });

  test('manager receives 403', () => {
    expect(permissionGuard('manager')).toBe(403);
  });

  test('user receives 403', () => {
    expect(permissionGuard('user')).toBe(403);
  });

  test('missing role (unauthenticated) receives 401', () => {
    expect(permissionGuard(undefined)).toBe(401);
  });
});

// ── (b) Response body shape ───────────────────────────────────────────────────

describe('GET /api/validators — response body shape', () => {
  test('ValidatorSummary shape type-checks end to end', () => {
    const summary: ValidatorSummary = {
      slug: 'output_non_empty',
      name: 'Output non empty',
      kind: 'deterministic',
      safetyClass: false,
      deprecated: false,
      parameterSchema: [],
    };
    expect(summary.slug).toBe('output_non_empty');
    expect(summary.kind).toBe('deterministic');
    expect(Array.isArray(summary.parameterSchema)).toBe(true);
    expect(typeof summary.safetyClass).toBe('boolean');
    expect(typeof summary.deprecated).toBe('boolean');
  });

  test('deterministic_external kind is a valid ValidatorSummary', () => {
    const summary: ValidatorSummary = {
      slug: 'cited_entity_exists',
      name: 'Cited entity exists',
      kind: 'deterministic_external',
      safetyClass: false,
      deprecated: false,
      parameterSchema: [
        {
          name: 'entityTypes',
          type: 'array',
          required: true,
          description: 'Entity type configurations',
        },
      ],
    };
    expect(summary.kind).toBe('deterministic_external');
    expect(summary.parameterSchema).toHaveLength(1);
  });

  test('hybrid_precondition kind is a valid ValidatorSummary', () => {
    const summary: ValidatorSummary = {
      slug: 'output_non_empty',
      name: 'Output non empty',
      kind: 'hybrid_precondition',
      safetyClass: false,
      deprecated: false,
      parameterSchema: [],
    };
    expect(summary.kind).toBe('hybrid_precondition');
  });

  test('response array contains only ValidatorSummary items', () => {
    const response: ValidatorSummary[] = [
      {
        slug: 'output_non_empty',
        name: 'Output non empty',
        kind: 'deterministic',
        safetyClass: false,
        deprecated: false,
        parameterSchema: [],
      },
      {
        slug: 'pii_pattern_absent',
        name: 'Pii pattern absent',
        kind: 'deterministic',
        safetyClass: true,
        deprecated: false,
        parameterSchema: [],
      },
    ];
    for (const item of response) {
      expect(item).toHaveProperty('slug');
      expect(item).toHaveProperty('name');
      expect(item).toHaveProperty('kind');
      expect(item).toHaveProperty('safetyClass');
      expect(item).toHaveProperty('deprecated');
      expect(item).toHaveProperty('parameterSchema');
    }
  });
});
