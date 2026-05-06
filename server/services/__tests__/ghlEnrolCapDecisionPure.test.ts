/**
 * Pure tests for D.4 — GHL enrol cap decision function.
 */

import { expect, test } from 'vitest';
import { decideEnrolPath } from '../ghlEnrolCapDecisionPure.js';

test('at or below cap → inline', () => {
  expect(decideEnrolPath({ locationCount: 0,   cap: 250 })).toBe('inline');
  expect(decideEnrolPath({ locationCount: 1,   cap: 250 })).toBe('inline');
  expect(decideEnrolPath({ locationCount: 250, cap: 250 })).toBe('inline');
});

test('above cap → background_job', () => {
  expect(decideEnrolPath({ locationCount: 251, cap: 250 })).toBe('background_job');
  expect(decideEnrolPath({ locationCount: 500, cap: 250 })).toBe('background_job');
  expect(decideEnrolPath({ locationCount: 1,   cap: 0   })).toBe('background_job');
});
