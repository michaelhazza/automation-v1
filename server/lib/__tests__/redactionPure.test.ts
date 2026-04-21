import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  DEFAULT_REDACTION_PATTERNS,
  redactValue,
} from '../redaction.js';

test('redactValue: bearer token replaced', () => {
  const { value, redactions } = redactValue(
    'Authorization: Bearer abcdefghij1234567890xxxyz',
  );
  assert.equal(typeof value, 'string');
  assert.ok((value as string).includes('[REDACTED:bearer]'));
  assert.ok(redactions.some((r) => r.pattern === 'bearer_token'));
});

test('redactValue: near-miss bearer (too short) is not flagged', () => {
  const { value, redactions } = redactValue('Bearer abc');
  assert.equal(value, 'Bearer abc');
  assert.equal(redactions.length, 0);
});

test('redactValue: openai key patterns', () => {
  const { value, redactions } = redactValue(
    'OPENAI_KEY=sk-abcdefghij1234567890xxxyz',
  );
  assert.ok((value as string).includes('[REDACTED:openai_key]'));
  assert.ok(redactions.some((r) => r.pattern === 'openai_key'));
});

test('redactValue: github PAT', () => {
  const token = 'ghp_' + 'a'.repeat(36);
  const { value, redactions } = redactValue(`token=${token}`);
  assert.ok((value as string).includes('[REDACTED:github_token]'));
  assert.equal(redactions.length, 1);
});

test('redactValue: walks nested arrays + objects', () => {
  const { value, redactions } = redactValue({
    outer: {
      inner: ['plain text', 'Bearer abcdefghij1234567890xxxyz'],
    },
  });
  const serialised = JSON.stringify(value);
  assert.ok(serialised.includes('[REDACTED:bearer]'));
  const r = redactions.find((x) => x.pattern === 'bearer_token');
  assert.ok(r);
  assert.ok(r!.path.startsWith('outer.inner.'));
});

test('redactValue: cycle-safe', () => {
  const obj: Record<string, unknown> = { name: 'x' };
  obj.self = obj;
  const { value } = redactValue(obj);
  // Walker replaces the cycle with the literal '[cycle]' sentinel.
  assert.ok(value);
});

test('redactValue: hits from several patterns are all recorded', () => {
  const input =
    'keys: Bearer abcdefghij1234567890xxxyz and ghp_' + 'x'.repeat(36);
  const { redactions } = redactValue(input);
  const names = new Set(redactions.map((r) => r.pattern));
  assert.ok(names.has('bearer_token'));
  assert.ok(names.has('github_pat'));
});

test('DEFAULT_REDACTION_PATTERNS: includes bearer + openai + github', () => {
  const names = DEFAULT_REDACTION_PATTERNS.map((p) => p.name);
  assert.ok(names.includes('bearer_token'));
  assert.ok(names.includes('openai_key'));
  assert.ok(names.includes('github_pat'));
});

test('redactValue: returns the replacement text exactly', () => {
  const { redactions } = redactValue('Bearer abcdefghij1234567890xxxyz');
  const hit = redactions.find((r) => r.pattern === 'bearer_token');
  assert.ok(hit);
  assert.equal(hit!.replacedWith, '[REDACTED:bearer]');
  assert.equal(hit!.count, 1);
});
