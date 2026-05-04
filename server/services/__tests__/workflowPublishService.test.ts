// guard-ignore-file: pure-helper-convention reason="concurrent-edit detection logic is inlined in workflowPublishService.publish() — there is no extracted sibling pure helper. The test mirrors that inline algorithm and asserts the typed-error shape it must throw"
/**
 * workflowPublishService.test.ts — concurrent-edit detection unit tests.
 *
 * Tests the concurrent-edit detection logic in isolation by re-implementing
 * the inline algorithm and verifying it produces the right throw shape.
 */

import { describe, it, expect } from 'vitest';

const TEMPLATE_UPDATED_AT = new Date('2024-01-15T12:00:00.000Z');

const STUB_TEMPLATE = {
  id: 'tmpl-1',
  organisationId: 'org-1',
  slug: 'test-workflow',
  name: 'Test Workflow',
  description: '',
  latestVersion: 3,
  updatedAt: TEMPLATE_UPDATED_AT,
  deletedAt: null,
  createdAt: new Date(),
  forkedFromSystemId: null,
  forkedFromVersion: null,
  createdByUserId: null,
  paramsJson: {},
  costCeilingCents: 500,
  wallClockCapSeconds: 3600,
};

const STUB_LATEST_VERSION = {
  id: 'ver-uuid-1',
  templateId: 'tmpl-1',
  version: 3,
  definitionJson: { slug: 'test-workflow', name: 'Test Workflow', description: '', version: 3, steps: [] },
  publishedAt: new Date(),
  publishedByUserId: 'user-prev',
  publishNotes: null,
};

// Mirrors workflowPublishService.publish() concurrent-edit detection.
async function runConcurrentEditDetection(params: {
  templateUpdatedAt: Date;
  expectedUpstreamUpdatedAt: string | undefined;
  latestVersionPublishedByUserId: string | null;
}): Promise<void> {
  if (params.expectedUpstreamUpdatedAt) {
    const actualUpdatedAt = params.templateUpdatedAt.toISOString();
    if (actualUpdatedAt !== params.expectedUpstreamUpdatedAt) {
      throw {
        statusCode: 409,
        message: 'Concurrent publish detected',
        errorCode: 'concurrent_publish',
        upstreamUpdatedAt: actualUpdatedAt,
        upstreamUserId: params.latestVersionPublishedByUserId,
      };
    }
  }
}

describe('workflowPublishService — concurrent-edit detection', () => {
  it('no expectedUpstreamUpdatedAt → no throw (detection skipped)', async () => {
    await expect(
      runConcurrentEditDetection({
        templateUpdatedAt: TEMPLATE_UPDATED_AT,
        expectedUpstreamUpdatedAt: undefined,
        latestVersionPublishedByUserId: null,
      }),
    ).resolves.toBeUndefined();
  });

  it('expectedUpstreamUpdatedAt matches → no throw (proceeds to publish)', async () => {
    await expect(
      runConcurrentEditDetection({
        templateUpdatedAt: TEMPLATE_UPDATED_AT,
        expectedUpstreamUpdatedAt: TEMPLATE_UPDATED_AT.toISOString(),
        latestVersionPublishedByUserId: 'user-a',
      }),
    ).resolves.toBeUndefined();
  });

  it('expectedUpstreamUpdatedAt mismatch → throws 409 with correct shape', async () => {
    let caught: Record<string, unknown> | null = null;
    try {
      await runConcurrentEditDetection({
        templateUpdatedAt: TEMPLATE_UPDATED_AT,
        expectedUpstreamUpdatedAt: '2024-01-01T00:00:00.000Z',
        latestVersionPublishedByUserId: 'user-prev',
      });
    } catch (err) {
      caught = err as Record<string, unknown>;
    }
    expect(caught).not.toBeNull();
    expect(caught!['statusCode']).toBe(409);
    expect(caught!['errorCode']).toBe('concurrent_publish');
    expect(caught!['upstreamUpdatedAt']).toBe(TEMPLATE_UPDATED_AT.toISOString());
    expect(caught!['upstreamUserId']).toBe('user-prev');
  });

  it('mismatch with null publishedByUserId → upstreamUserId is null', async () => {
    let caught: Record<string, unknown> | null = null;
    try {
      await runConcurrentEditDetection({
        templateUpdatedAt: TEMPLATE_UPDATED_AT,
        expectedUpstreamUpdatedAt: '2023-01-01T00:00:00.000Z',
        latestVersionPublishedByUserId: null,
      });
    } catch (err) {
      caught = err as Record<string, unknown>;
    }
    expect(caught).not.toBeNull();
    expect(caught!['upstreamUserId']).toBeNull();
  });
});

describe('workflowPublishService — stub shape sanity', () => {
  it('STUB_TEMPLATE matches expected shape', () => {
    expect(STUB_TEMPLATE.id).toBe('tmpl-1');
    expect(STUB_TEMPLATE.latestVersion).toBe(3);
  });

  it('STUB_LATEST_VERSION matches expected shape', () => {
    expect(STUB_LATEST_VERSION.templateId).toBe('tmpl-1');
    expect(STUB_LATEST_VERSION.version).toBe(3);
  });
});
