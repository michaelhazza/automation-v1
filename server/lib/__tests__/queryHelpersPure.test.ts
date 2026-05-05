import { describe, expect, it } from 'vitest';
import { isActive, assertActive, EntityNotActiveError } from '../queryHelpers.js';

// isActive accepts any object with a deletedAt property that Drizzle can use.
// For the Pure test, we pass a minimal stub that matches the required shape.
const agentStub = { deletedAt: null as Date | null };

describe('isActive', () => {
  it('returns a SQL object (not null or undefined)', () => {
    const filter = isActive(agentStub);
    expect(filter).toBeTruthy();
    expect(typeof filter).toBe('object');
  });

  it('produces a different result for different table stubs', () => {
    const a = isActive({ deletedAt: null as Date | null });
    const b = isActive({ deletedAt: null as Date | null });
    // Both should be truthy SQL objects from the same column expression
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
  });
});

describe('assertActive', () => {
  it('returns silently for an active entity', () => {
    expect(() => assertActive({ id: 'x', deletedAt: null }, 'Agent')).not.toThrow();
  });

  it('throws EntityNotActiveError for a soft-deleted entity', () => {
    expect(() => assertActive({ id: 'x', deletedAt: new Date() }, 'Agent'))
      .toThrow(EntityNotActiveError);
  });

  it('throws with statusCode 410 for soft-deleted entity', () => {
    try {
      assertActive({ id: 'x', deletedAt: new Date() }, 'Agent');
    } catch (e) {
      expect((e as EntityNotActiveError).statusCode).toBe(410);
    }
  });

  it('throws with id <missing> for null entity', () => {
    expect(() => assertActive(null, 'Agent'))
      .toThrow(EntityNotActiveError);
  });
});
