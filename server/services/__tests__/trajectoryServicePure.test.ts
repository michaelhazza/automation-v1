import { describe, it, expect } from 'vitest';
import { compare, matchArgs, formatDiff } from '../trajectoryServicePure.js';

describe('compare — exact mode', () => {
  it('matches identical sequences', () => {
    const actual = [
      { tool: 'read_inbox', args: {} },
      { tool: 'create_task', args: { title: 'Bug' } },
    ];
    const reference = {
      matchMode: 'exact' as const,
      expected: [
        { tool: 'read_inbox' },
        { tool: 'create_task' },
      ],
    };
    const diff = compare(actual, reference);
    expect(diff.pass).toBe(true);
  });

  it('fails on different sequence length', () => {
    const actual = [{ tool: 'read_inbox', args: {} }];
    const reference = {
      matchMode: 'exact' as const,
      expected: [
        { tool: 'read_inbox' },
        { tool: 'create_task' },
      ],
    };
    const diff = compare(actual, reference);
    expect(diff.pass).toBe(false);
  });

  it('fails on wrong tool at a position', () => {
    const actual = [
      { tool: 'send_email', args: {} },
      { tool: 'create_task', args: {} },
    ];
    const reference = {
      matchMode: 'exact' as const,
      expected: [
        { tool: 'read_inbox' },
        { tool: 'create_task' },
      ],
    };
    const diff = compare(actual, reference);
    expect(diff.pass).toBe(false);
  });
});

describe('compare — in-order mode', () => {
  it('matches subsequence in order', () => {
    const actual = [
      { tool: 'web_search', args: {} },
      { tool: 'read_inbox', args: {} },
      { tool: 'send_email', args: {} },
      { tool: 'create_task', args: {} },
    ];
    const reference = {
      matchMode: 'in-order' as const,
      expected: [
        { tool: 'read_inbox' },
        { tool: 'create_task' },
      ],
    };
    const diff = compare(actual, reference);
    expect(diff.pass).toBe(true);
  });

  it('fails when order is reversed', () => {
    const actual = [
      { tool: 'create_task', args: {} },
      { tool: 'read_inbox', args: {} },
    ];
    const reference = {
      matchMode: 'in-order' as const,
      expected: [
        { tool: 'read_inbox' },
        { tool: 'create_task' },
      ],
    };
    const diff = compare(actual, reference);
    expect(diff.pass).toBe(false);
  });
});

describe('compare — any-order mode', () => {
  it('matches set containment regardless of order', () => {
    const actual = [
      { tool: 'create_task', args: {} },
      { tool: 'send_email', args: {} },
      { tool: 'read_inbox', args: {} },
    ];
    const reference = {
      matchMode: 'any-order' as const,
      expected: [
        { tool: 'read_inbox' },
        { tool: 'send_email' },
      ],
    };
    const diff = compare(actual, reference);
    expect(diff.pass).toBe(true);
  });

  it('fails when expected tool is missing', () => {
    const actual = [
      { tool: 'create_task', args: {} },
    ];
    const reference = {
      matchMode: 'any-order' as const,
      expected: [
        { tool: 'read_inbox' },
        { tool: 'send_email' },
      ],
    };
    const diff = compare(actual, reference);
    expect(diff.pass).toBe(false);
  });
});

describe('compare — single-tool mode', () => {
  it('matches if tool exists anywhere', () => {
    const actual = [
      { tool: 'web_search', args: {} },
      { tool: 'read_inbox', args: {} },
    ];
    const reference = {
      matchMode: 'single-tool' as const,
      expected: [{ tool: 'read_inbox' }],
    };
    const diff = compare(actual, reference);
    expect(diff.pass).toBe(true);
  });

  it('fails if tool not found', () => {
    const actual = [
      { tool: 'web_search', args: {} },
    ];
    const reference = {
      matchMode: 'single-tool' as const,
      expected: [{ tool: 'read_inbox' }],
    };
    const diff = compare(actual, reference);
    expect(diff.pass).toBe(false);
  });
});

describe('matchArgs', () => {
  it('matches with partial equality', () => {
    const actual = { to: 'test@example.com', subject: 'Hello', body: 'Hi there' };
    const matchers = { to: 'test@example.com' };
    expect(matchArgs(actual, matchers)).toBe(true);
  });

  it('fails on value mismatch', () => {
    const actual = { to: 'wrong@example.com' };
    const matchers = { to: 'test@example.com' };
    expect(matchArgs(actual, matchers)).toBe(false);
  });

  it('passes with no matchers', () => {
    expect(matchArgs({ anything: true }, undefined)).toBe(true);
    expect(matchArgs({ anything: true }, {})).toBe(true);
  });
});

describe('formatDiff', () => {
  it('formats a passing diff', () => {
    const diff = { pass: true, entries: [] };
    const output = formatDiff(diff);
    expect(output).toContain('PASS');
  });

  it('formats a failing diff with entries', () => {
    const diff = {
      pass: false,
      entries: [
        { status: 'missing' as const, expected: 'read_inbox', actual: null },
      ],
    };
    const output = formatDiff(diff);
    expect(output).toContain('FAIL');
    expect(output).toContain('read_inbox');
  });
});
