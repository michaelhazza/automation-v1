import { describe, it, expect } from 'vitest';
import { validateCurrentFocus, buildStaleFallbackFocus } from '../currentFocusValidator';

describe('validateCurrentFocus', () => {
  it('rejects empty string', () => {
    expect(validateCurrentFocus('')).toMatchObject({ ok: false });
  });

  it('rejects "Thinking"', () => {
    expect(validateCurrentFocus('Thinking')).toMatchObject({ ok: false });
  });

  it('rejects "Analysing data"', () => {
    expect(validateCurrentFocus('Analysing data')).toMatchObject({ ok: false });
  });

  it('rejects "Working on task"', () => {
    expect(validateCurrentFocus('Working on task')).toMatchObject({ ok: false });
  });

  it('rejects "Reasoning about"', () => {
    expect(validateCurrentFocus('Reasoning about the problem')).toMatchObject({ ok: false });
  });

  it('rejects "Preparing"', () => {
    expect(validateCurrentFocus('Preparing')).toMatchObject({ ok: false });
  });

  it('rejects "Processing"', () => {
    expect(validateCurrentFocus('Processing')).toMatchObject({ ok: false });
  });

  it('accepts focus text with a concrete step number', () => {
    expect(validateCurrentFocus('Step 3 of 7: Sending outreach email to Acme Corp')).toMatchObject({ ok: true });
  });

  it('accepts focus text with a concrete entity name', () => {
    expect(validateCurrentFocus('Waiting for HITL approval on task #1234')).toMatchObject({ ok: true });
  });

  it('accepts a concrete focus line about a specific action', () => {
    expect(validateCurrentFocus('Fetching data from Salesforce API for Acme Corp')).toMatchObject({ ok: true });
  });
});

describe('buildStaleFallbackFocus', () => {
  it('returns <1m copy for small ages', () => {
    expect(buildStaleFallbackFocus(30_000)).toBe('No recent activity (last event <1m ago)');
  });

  it('returns N minutes for larger ages', () => {
    expect(buildStaleFallbackFocus(4 * 60_000)).toBe('No recent activity (last event 4m ago)');
  });
});
