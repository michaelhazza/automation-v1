/**
 * ghlEnrolCapDecisionPure
 *
 * Pure decision function for D.4: when an agency connection has more than
 * MAX_GHL_LOCATIONS_TO_ENROL locations, dispatch the background pagination
 * job instead of enrolling inline. This module exports the comparison rule
 * so the test file and any future consumer share a single source of truth
 * (rather than duplicating `locations.length > cap` inline).
 */

export type EnrolPath = 'inline' | 'background_job';

export function decideEnrolPath({ locationCount, cap }: { locationCount: number; cap: number }): EnrolPath {
  return locationCount <= cap ? 'inline' : 'background_job';
}
