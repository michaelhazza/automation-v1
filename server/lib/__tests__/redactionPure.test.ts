import { expect, test } from 'vitest';
import {
  DEFAULT_REDACTION_PATTERNS,
  redactValue,
} from '../redaction.js';

test('redactValue: bearer token replaced', () => {
  const { value, redactions } = redactValue(
    'Authorization: Bearer abcdefghij1234567890xxxyz',
  );
  expect(typeof value).toBe('string');
  expect((value as string).includes('[REDACTED:bearer]')).toBeTruthy();
  expect(redactions.some((r) => r.pattern === 'bearer_token')).toBeTruthy();
});

test('redactValue: near-miss bearer (too short) is not flagged', () => {
  const { value, redactions } = redactValue('Bearer abc');
  expect(value).toBe('Bearer abc');
  expect(redactions.length).toBe(0);
});

test('redactValue: openai key patterns', () => {
  const { value, redactions } = redactValue(
    'OPENAI_KEY=sk-abcdefghij1234567890xxxyz',
  );
  expect((value as string).includes('[REDACTED:openai_key]')).toBeTruthy();
  expect(redactions.some((r) => r.pattern === 'openai_key')).toBeTruthy();
});

test('redactValue: github PAT', () => {
  const token = 'ghp_' + 'a'.repeat(36);
  const { value, redactions } = redactValue(`token=${token}`);
  expect((value as string).includes('[REDACTED:github_token]')).toBeTruthy();
  expect(redactions.length).toBe(1);
});

test('redactValue: walks nested arrays + objects', () => {
  const { value, redactions } = redactValue({
    outer: {
      inner: ['plain text', 'Bearer abcdefghij1234567890xxxyz'],
    },
  });
  const serialised = JSON.stringify(value);
  expect(serialised.includes('[REDACTED:bearer]')).toBeTruthy();
  const r = redactions.find((x) => x.pattern === 'bearer_token');
  expect(r).toBeTruthy();
  expect(r!.path.startsWith('outer.inner.')).toBeTruthy();
});

test('redactValue: cycle-safe', () => {
  const obj: Record<string, unknown> = { name: 'x' };
  obj.self = obj;
  const { value } = redactValue(obj);
  // Walker replaces the cycle with the literal '[cycle]' sentinel.
  expect(value).toBeTruthy();
});

test('redactValue: hits from several patterns are all recorded', () => {
  const input =
    'keys: Bearer abcdefghij1234567890xxxyz and ghp_' + 'x'.repeat(36);
  const { redactions } = redactValue(input);
  const names = new Set(redactions.map((r) => r.pattern));
  expect(names.has('bearer_token')).toBeTruthy();
  expect(names.has('github_pat')).toBeTruthy();
});

test('DEFAULT_REDACTION_PATTERNS: includes bearer + openai + github', () => {
  const names = DEFAULT_REDACTION_PATTERNS.map((p) => p.name);
  expect(names.includes('bearer_token')).toBeTruthy();
  expect(names.includes('openai_key')).toBeTruthy();
  expect(names.includes('github_pat')).toBeTruthy();
});

test('redactValue: returns the replacement text exactly', () => {
  const { redactions } = redactValue('Bearer abcdefghij1234567890xxxyz');
  const hit = redactions.find((r) => r.pattern === 'bearer_token');
  expect(hit).toBeTruthy();
  expect(hit!.replacedWith).toBe('[REDACTED:bearer]');
  expect(hit!.count).toBe(1);
});
