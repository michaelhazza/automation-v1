import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { validator } from '../cited_entity_exists.js';
import * as resolverRegistry from '../entityResolverRegistry.js';
import type { ValidatorContext } from '../types.js';

function makeCtx(runOutput: string, parameters: Record<string, unknown> = {}): ValidatorContext {
  return {
    runOutput,
    runMetadata: {
      skillSlug: 'test-skill',
      agentId: 'agent-1',
      subaccountId: 'sub-1',
      runId: 'run-1',
      invokedSkillSlugs: [],
    },
    parameters,
  };
}

describe('cited_entity_exists validator', () => {
  beforeEach(() => {
    // Inject a mock resolver into the shared registry object
    resolverRegistry.ENTITY_RESOLVERS['mockService'] = vi.fn().mockResolvedValue(true);
  });

  afterEach(() => {
    delete resolverRegistry.ENTITY_RESOLVERS['mockService'];
  });

  test('passing case: all entity IDs exist', async () => {
    (resolverRegistry.ENTITY_RESOLVERS['mockService'] as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const result = await validator.evaluate(
      makeCtx('See entity ENT-001 for details.', {
        entityTypes: [
          { matchPattern: 'ENT-\\d+', lookupService: 'mockService', idArgName: 'id' },
        ],
      }),
    );
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
  });

  test('failing case: one entity ID does not exist', async () => {
    (resolverRegistry.ENTITY_RESOLVERS['mockService'] as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const result = await validator.evaluate(
      makeCtx('See entity ENT-999 for details.', {
        entityTypes: [
          { matchPattern: 'ENT-\\d+', lookupService: 'mockService', idArgName: 'id' },
        ],
      }),
    );
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0.0);
    const ev = result.evidence as Record<string, unknown>;
    expect(Array.isArray(ev['missingIds'])).toBe(true);
    expect((ev['missingIds'] as string[]).length).toBeGreaterThan(0);
  });

  test('edge case: batching — resolver called once per unique ID (deduplication)', async () => {
    const mockFn = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    resolverRegistry.ENTITY_RESOLVERS['mockService'] = mockFn;

    // Two entity IDs in output; one false, one true
    const result = await validator.evaluate(
      makeCtx('See ENT-001 and ENT-002 and ENT-001 again.', {
        entityTypes: [
          { matchPattern: 'ENT-\\d+', lookupService: 'mockService', idArgName: 'id' },
        ],
      }),
    );

    // ENT-001 appears twice but should only be looked up once (deduplication)
    expect(mockFn).toHaveBeenCalledTimes(2); // ENT-001 and ENT-002
    expect(result.passed).toBe(false); // ENT-001 returned false
  });

  test('failing case: unknown lookup service', async () => {
    const result = await validator.evaluate(
      makeCtx('See ENT-001.', {
        entityTypes: [
          { matchPattern: 'ENT-\\d+', lookupService: 'nonExistentService', idArgName: 'id' },
        ],
      }),
    );
    expect(result.passed).toBe(false);
    expect(result.reasoning).toMatch(/nonExistentService/);
  });

  test('passing case: no entity types configured is trivially passing', async () => {
    const result = await validator.evaluate(
      makeCtx('any output', { entityTypes: [] }),
    );
    expect(result.passed).toBe(true);
  });

  test('metadata: slug, version, kind', () => {
    expect(validator.slug).toBe('cited_entity_exists');
    expect(validator.version).toBe('1.0.0');
    expect(validator.kind).toBe('deterministic_external');
  });
});
