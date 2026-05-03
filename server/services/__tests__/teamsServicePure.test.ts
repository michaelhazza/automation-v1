// guard-ignore-file: pure-helper-convention reason="Pure-helper test — no DB imports"
/**
 * teamsServicePure.test.ts
 *
 * Tests for assertTeamNameValid — name validation cases.
 *
 * No DB imports. No I/O. All pure functions.
 */

import { describe, expect, test } from 'vitest';
import { assertTeamNameValid } from '../teamsServicePure.js';

describe('assertTeamNameValid', () => {
  // Valid names
  test('single character is valid', () => {
    expect(assertTeamNameValid('A')).toEqual({ ok: true });
  });

  test('normal name is valid', () => {
    expect(assertTeamNameValid('Sales Team')).toEqual({ ok: true });
  });

  test('64-character name is valid (boundary)', () => {
    expect(assertTeamNameValid('A'.repeat(64))).toEqual({ ok: true });
  });

  // Too short
  test('empty string is too short', () => {
    expect(assertTeamNameValid('')).toEqual({ ok: false, reason: 'too_short' });
  });

  // Too long
  test('65-character name is too long', () => {
    expect(assertTeamNameValid('A'.repeat(65))).toEqual({ ok: false, reason: 'too_long' });
  });

  test('100-character name is too long', () => {
    expect(assertTeamNameValid('A'.repeat(100))).toEqual({ ok: false, reason: 'too_long' });
  });

  // Invalid chars — leading/trailing whitespace
  test('name with leading space is invalid', () => {
    expect(assertTeamNameValid(' Sales')).toEqual({ ok: false, reason: 'invalid_chars' });
  });

  test('name with trailing space is invalid', () => {
    expect(assertTeamNameValid('Sales ')).toEqual({ ok: false, reason: 'invalid_chars' });
  });

  test('name with leading tab is invalid', () => {
    expect(assertTeamNameValid('\tSales')).toEqual({ ok: false, reason: 'invalid_chars' });
  });

  test('name with trailing newline is invalid', () => {
    expect(assertTeamNameValid('Sales\n')).toEqual({ ok: false, reason: 'invalid_chars' });
  });

  // Interior whitespace is fine
  test('name with interior space is valid', () => {
    expect(assertTeamNameValid('Alpha Team')).toEqual({ ok: true });
  });

  // Numbers and special chars in names
  test('name with numbers is valid', () => {
    expect(assertTeamNameValid('Team 2')).toEqual({ ok: true });
  });

  test('name with hyphen is valid', () => {
    expect(assertTeamNameValid('Front-end')).toEqual({ ok: true });
  });
});
