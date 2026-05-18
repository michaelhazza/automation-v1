/**
 * visionActionParserPure.test.ts
 *
 * Spec: docs/superpowers/specs/2026-05-18-browser-vision-grounding-spec.md §8.1
 *
 * Tests all 9 verbs (happy path), rejection cases, whitespace normalisation,
 * and tryParseVisionAction null-parity contract.
 */

import { describe, expect, it } from 'vitest';
import { parseVisionAction, tryParseVisionAction } from '../visionActionParserPure.js';

// ---------------------------------------------------------------------------
// Happy-path: one test per verb (9 tests)
// ---------------------------------------------------------------------------

describe('click', () => {
  it('parses click(340, 220)', () => {
    expect(parseVisionAction('click(340, 220)')).toEqual({ type: 'click', x: 340, y: 220 });
  });
});

describe('double_click', () => {
  it('parses double_click(100, 200)', () => {
    expect(parseVisionAction('double_click(100, 200)')).toEqual({ type: 'double_click', x: 100, y: 200 });
  });
});

describe('right_click', () => {
  it('parses right_click(50, 75)', () => {
    expect(parseVisionAction('right_click(50, 75)')).toEqual({ type: 'right_click', x: 50, y: 75 });
  });
});

describe('type', () => {
  it('parses type("hello world")', () => {
    expect(parseVisionAction('type("hello world")')).toEqual({ type: 'type', text: 'hello world' });
  });

  it('preserves internal double-space in quoted text (regression: round-trip to Playwright)', () => {
    expect(parseVisionAction('type("hello  world")')).toEqual({ type: 'type', text: 'hello  world' });
  });
});

describe('scroll', () => {
  it('parses scroll(0, 300)', () => {
    expect(parseVisionAction('scroll(0, 300)')).toEqual({ type: 'scroll', dx: 0, dy: 300 });
  });

  it('parses scroll with negative dy', () => {
    expect(parseVisionAction('scroll(0, -100)')).toEqual({ type: 'scroll', dx: 0, dy: -100 });
  });
});

describe('hotkey', () => {
  it('parses hotkey("ctrl+c")', () => {
    expect(parseVisionAction('hotkey("ctrl+c")')).toEqual({ type: 'hotkey', combo: 'ctrl+c' });
  });
});

describe('wait', () => {
  it('parses wait(1500)', () => {
    expect(parseVisionAction('wait(1500)')).toEqual({ type: 'wait', ms: 1500 });
  });
});

describe('screenshot', () => {
  it('parses screenshot()', () => {
    expect(parseVisionAction('screenshot()')).toEqual({ type: 'screenshot' });
  });
});

describe('done', () => {
  it('parses done()', () => {
    expect(parseVisionAction('done()')).toEqual({ type: 'done' });
  });
});

// ---------------------------------------------------------------------------
// Whitespace normalisation
// ---------------------------------------------------------------------------

describe('whitespace normalisation', () => {
  it('leading/trailing whitespace is stripped', () => {
    expect(parseVisionAction('  click(340, 220)  ')).toEqual({ type: 'click', x: 340, y: 220 });
  });

  it('extra whitespace between numeric args is tolerated per-arg', () => {
    expect(parseVisionAction('  click(340,  220)  ')).toEqual({ type: 'click', x: 340, y: 220 });
  });
});

// ---------------------------------------------------------------------------
// Rejection cases + tryParseVisionAction null-parity
// ---------------------------------------------------------------------------

describe('rejection: unknown verb', () => {
  it('throws on unknown verb', () => {
    expect(() => parseVisionAction('foo(1, 2)')).toThrow('unknown verb');
  });

  it('tryParseVisionAction returns null for unknown verb', () => {
    expect(tryParseVisionAction('foo(1, 2)')).toBeNull();
  });
});

describe('rejection: missing required coord args', () => {
  it('throws when click has only one arg', () => {
    expect(() => parseVisionAction('click(100)')).toThrow('expected 2 args');
  });

  it('tryParseVisionAction returns null for missing coord args', () => {
    expect(tryParseVisionAction('click(100)')).toBeNull();
  });
});

describe('rejection: negative x or y', () => {
  it('throws on negative x for click', () => {
    expect(() => parseVisionAction('click(-1, 220)')).toThrow('non-negative integer');
  });

  it('throws on negative y for click', () => {
    expect(() => parseVisionAction('click(340, -5)')).toThrow('non-negative integer');
  });

  it('tryParseVisionAction returns null for negative x', () => {
    expect(tryParseVisionAction('click(-1, 220)')).toBeNull();
  });
});

describe('rejection: non-integer coords', () => {
  it('throws on float x for click', () => {
    expect(() => parseVisionAction('click(3.5, 220)')).toThrow('non-negative integer');
  });

  it('throws on non-numeric coord', () => {
    expect(() => parseVisionAction('click(abc, 220)')).toThrow('non-negative integer');
  });

  it('tryParseVisionAction returns null for float coord', () => {
    expect(tryParseVisionAction('click(3.5, 220)')).toBeNull();
  });
});

describe('rejection: negative ms for wait', () => {
  it('throws on zero ms', () => {
    expect(() => parseVisionAction('wait(0)')).toThrow('positive integer');
  });

  it('throws on negative ms', () => {
    expect(() => parseVisionAction('wait(-100)')).toThrow();
  });

  it('tryParseVisionAction returns null for zero ms', () => {
    expect(tryParseVisionAction('wait(0)')).toBeNull();
  });
});

describe('rejection: malformed combo for hotkey', () => {
  it('throws on hotkey with empty combo', () => {
    expect(() => parseVisionAction('hotkey("")')).toThrow('empty');
  });

  it('throws on hotkey with trailing plus (empty token)', () => {
    expect(() => parseVisionAction('hotkey("ctrl+")')).toThrow('malformed combo');
  });

  it('tryParseVisionAction returns null for malformed combo', () => {
    expect(tryParseVisionAction('hotkey("ctrl+")')).toBeNull();
  });
});

describe('rejection: missing closing paren', () => {
  it('throws on missing closing paren', () => {
    expect(() => parseVisionAction('click(340, 220')).toThrow();
  });

  it('tryParseVisionAction returns null for missing closing paren', () => {
    expect(tryParseVisionAction('click(340, 220')).toBeNull();
  });
});

describe('rejection: type with unquoted string', () => {
  it('throws on type with unquoted text', () => {
    expect(() => parseVisionAction('type(hello)')).toThrow('double-quoted string');
  });

  it('tryParseVisionAction returns null for unquoted type arg', () => {
    expect(tryParseVisionAction('type(hello)')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// tryParseVisionAction happy-path parity
// ---------------------------------------------------------------------------

describe('tryParseVisionAction: returns action on valid input', () => {
  it('returns VisionAction for valid click', () => {
    expect(tryParseVisionAction('click(10, 20)')).toEqual({ type: 'click', x: 10, y: 20 });
  });

  it('returns VisionAction for screenshot()', () => {
    expect(tryParseVisionAction('screenshot()')).toEqual({ type: 'screenshot' });
  });
});
