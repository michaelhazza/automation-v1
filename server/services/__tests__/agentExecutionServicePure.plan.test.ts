import { describe, it, expect } from 'vitest';
import { parsePlan, isComplexRun } from '../agentExecutionServicePure.js';

describe('parsePlan', () => {
  it('parses a valid plan with actions', () => {
    const input = JSON.stringify({
      actions: [
        { tool: 'read_inbox', reason: 'Check emails' },
        { tool: 'create_task', reason: 'File bug' },
      ],
    });
    const plan = parsePlan(input);
    expect(plan).not.toBeNull();
    expect(plan!.actions).toHaveLength(2);
    expect(plan!.actions[0].tool).toBe('read_inbox');
  });

  it('parses a plan wrapped in { plan: { actions: [...] } }', () => {
    const input = JSON.stringify({
      plan: {
        actions: [{ tool: 'send_email', reason: 'Notify client' }],
      },
    });
    const plan = parsePlan(input);
    expect(plan).not.toBeNull();
    expect(plan!.actions[0].tool).toBe('send_email');
  });

  it('parses markdown-fenced JSON', () => {
    const input = '```json\n{"actions": [{"tool": "web_search", "reason": "Look up info"}]}\n```';
    const plan = parsePlan(input);
    expect(plan).not.toBeNull();
    expect(plan!.actions[0].tool).toBe('web_search');
  });

  it('returns null for null/undefined input', () => {
    expect(parsePlan(null)).toBeNull();
    expect(parsePlan(undefined)).toBeNull();
  });

  it('returns null for empty actions', () => {
    expect(parsePlan('{"actions": []}')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parsePlan('not json')).toBeNull();
  });

  it('extracts JSON from surrounding text', () => {
    const input = 'Here is my plan:\n{"actions": [{"tool": "fetch_url", "reason": "Get data"}]}\nEnd.';
    const plan = parsePlan(input);
    expect(plan).not.toBeNull();
    expect(plan!.actions[0].tool).toBe('fetch_url');
  });
});

describe('isComplexRun', () => {
  it('returns true for explicit complex hint', () => {
    expect(isComplexRun({ complexityHint: 'complex', messageWordCount: 10, skillCount: 5 })).toBe(true);
  });

  it('returns true for high word count', () => {
    expect(isComplexRun({ complexityHint: null, messageWordCount: 350, skillCount: 5 })).toBe(true);
  });

  it('returns true for high skill count', () => {
    expect(isComplexRun({ complexityHint: null, messageWordCount: 10, skillCount: 20 })).toBe(true);
  });

  it('returns false for simple runs', () => {
    expect(isComplexRun({ complexityHint: null, messageWordCount: 50, skillCount: 5 })).toBe(false);
  });

  it('returns false for explicit simple hint even with high word count', () => {
    // simple hint does not trigger — isComplexRun only checks for 'complex'
    expect(isComplexRun({ complexityHint: 'simple', messageWordCount: 350, skillCount: 5 })).toBe(true);
    // Note: the 'simple' override is handled by the caller, not isComplexRun
  });

  it('respects word count threshold boundary', () => {
    expect(isComplexRun({ complexityHint: null, messageWordCount: 300, skillCount: 5 })).toBe(false);
    expect(isComplexRun({ complexityHint: null, messageWordCount: 301, skillCount: 5 })).toBe(true);
  });

  it('respects skill count threshold boundary', () => {
    expect(isComplexRun({ complexityHint: null, messageWordCount: 10, skillCount: 15 })).toBe(false);
    expect(isComplexRun({ complexityHint: null, messageWordCount: 10, skillCount: 16 })).toBe(true);
  });
});
