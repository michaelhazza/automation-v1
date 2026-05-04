import { describe, test, expect } from 'vitest';
import { validateTaskEvent, validateEventOrigin } from '../taskEventValidator.js';

describe('validateTaskEvent', () => {
  test('valid task.created event passes', () => {
    const result = validateTaskEvent({
      kind: 'task.created',
      payload: { requesterId: 'user-1', initialPrompt: 'do something' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.kind).toBe('task.created');
    }
  });

  test('valid step.completed event passes', () => {
    const result = validateTaskEvent({
      kind: 'step.completed',
      payload: { stepId: 'step-1', outputs: null, fileRefs: [] },
    });
    expect(result.ok).toBe(true);
  });

  test('valid run.paused.by_user event passes', () => {
    const result = validateTaskEvent({
      kind: 'run.paused.by_user',
      payload: { actorId: 'user-2' },
    });
    expect(result.ok).toBe(true);
  });

  test('unknown kind is rejected', () => {
    const result = validateTaskEvent({
      kind: 'unknown.event.type',
      payload: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/unknown event kind/);
    }
  });

  test('missing kind is rejected', () => {
    const result = validateTaskEvent({ payload: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('payload.kind must be a string');
    }
  });

  test('non-object payload is rejected', () => {
    const result = validateTaskEvent('not an object');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('payload must be an object');
    }
  });

  test('null payload is rejected', () => {
    const result = validateTaskEvent(null);
    expect(result.ok).toBe(false);
  });

  test('missing inner payload object is rejected', () => {
    const result = validateTaskEvent({ kind: 'task.created' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('payload.payload must be an object');
    }
  });

  test('null inner payload is rejected', () => {
    const result = validateTaskEvent({ kind: 'task.created', payload: null });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('payload.payload must be an object');
    }
  });
});

describe('validateEventOrigin', () => {
  test('engine is valid', () => {
    expect(validateEventOrigin('engine')).toBe(true);
  });

  test('gate is valid', () => {
    expect(validateEventOrigin('gate')).toBe(true);
  });

  test('user is valid', () => {
    expect(validateEventOrigin('user')).toBe(true);
  });

  test('orchestrator is valid', () => {
    expect(validateEventOrigin('orchestrator')).toBe(true);
  });

  test('unknown string is rejected', () => {
    expect(validateEventOrigin('system')).toBe(false);
  });

  test('number is rejected', () => {
    expect(validateEventOrigin(42)).toBe(false);
  });

  test('null is rejected', () => {
    expect(validateEventOrigin(null)).toBe(false);
  });

  test('undefined is rejected', () => {
    expect(validateEventOrigin(undefined)).toBe(false);
  });
});
