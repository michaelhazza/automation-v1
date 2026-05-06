/**
 * Pure tests for D.4 — GHL enrol cap decision function.
 * No IO; pure decision function only.
 */

import { strict as assert } from 'assert';

type EnrolPath = 'inline' | 'background_job';

function decideEnrolPath({ locationCount, cap }: { locationCount: number; cap: number }): EnrolPath {
  return locationCount <= cap ? 'inline' : 'background_job';
}

// at or below cap → inline
assert.equal(decideEnrolPath({ locationCount: 0,   cap: 250 }), 'inline',         '0 locations → inline');
assert.equal(decideEnrolPath({ locationCount: 1,   cap: 250 }), 'inline',         '1 location → inline');
assert.equal(decideEnrolPath({ locationCount: 250, cap: 250 }), 'inline',         'exactly at cap → inline');

// above cap → background_job
assert.equal(decideEnrolPath({ locationCount: 251, cap: 250 }), 'background_job', '251 locations → background_job');
assert.equal(decideEnrolPath({ locationCount: 500, cap: 250 }), 'background_job', '500 locations → background_job');
assert.equal(decideEnrolPath({ locationCount: 1,   cap: 0   }), 'background_job', 'cap=0 always background_job');

console.log('ghlEnrolCapDecisionPure: all assertions passed');
