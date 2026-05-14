import { describe, it, expect } from 'vitest';
import { definitionToString, tryParseJson, parseNameMismatchDetail } from '../format';

describe('definitionToString', () => {
  it('returns empty string for null', () => {
    expect(definitionToString(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(definitionToString(undefined)).toBe('');
  });

  it('returns pretty-printed JSON for an object', () => {
    const obj = { a: 1, b: 'hello' };
    expect(definitionToString(obj)).toBe(JSON.stringify(obj, null, 2));
  });

  it('returns pretty-printed JSON for a nested object', () => {
    const obj = { nested: { x: true }, arr: [1, 2] };
    expect(definitionToString(obj)).toBe(JSON.stringify(obj, null, 2));
  });
});

describe('tryParseJson', () => {
  it('returns ok=true value={} for empty string (JSON.parse("") throws, so ok=false)', () => {
    const result = tryParseJson('');
    expect(result.ok).toBe(false);
  });

  it('returns ok=true with value for valid JSON object', () => {
    const result = tryParseJson('{"a":1}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ a: 1 });
    }
  });

  it('returns ok=false for malformed JSON', () => {
    const result = tryParseJson('{bad json}');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(typeof result.error).toBe('string');
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it('returns ok=false for JSON array (non-object)', () => {
    const result = tryParseJson('[1,2,3]');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('definition must be a JSON object');
    }
  });

  it('returns ok=false for JSON null', () => {
    const result = tryParseJson('null');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('definition must be a JSON object');
    }
  });

  it('returns ok=false for JSON string (non-object)', () => {
    const result = tryParseJson('"hello"');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('definition must be a JSON object');
    }
  });

  it('returns ok=true with nested object', () => {
    const result = tryParseJson('{"nested":{"x":true}}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ nested: { x: true } });
    }
  });
});

describe('parseNameMismatchDetail', () => {
  it('returns empty object for undefined', () => {
    expect(parseNameMismatchDetail(undefined)).toEqual({});
  });

  it('returns empty object for malformed JSON', () => {
    expect(parseNameMismatchDetail('{not valid json')).toEqual({});
  });

  it('parses valid detail with topLevel and schemaName', () => {
    const detail = JSON.stringify({ topLevel: 'X', schemaName: 'Y' });
    const result = parseNameMismatchDetail(detail);
    expect(result.topLevel).toBe('X');
    expect(result.schemaName).toBe('Y');
  });

  it('parses valid detail with distinctNames and candidates', () => {
    const detail = JSON.stringify({ distinctNames: ['a', 'b'], candidates: ['c'] });
    const result = parseNameMismatchDetail(detail);
    expect(result.distinctNames).toEqual(['a', 'b']);
    expect(result.candidates).toEqual(['c']);
  });

  it('returns empty object for empty string (falsy)', () => {
    expect(parseNameMismatchDetail('')).toEqual({});
  });
});
