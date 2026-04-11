/**
 * detectors/index.ts — Brain Tree OS adoption P4.
 *
 * Re-exports the array of all detectors in declaration order. Adding a new
 * detector is a one-file change: create the file under `detectors/`, then
 * append it to the array below.
 *
 * Detectors are pure functions and can be unit-tested independently. The
 * runner walks this list and concatenates the results.
 */

import type { Detector } from '../detectorTypes';
import { agentNoRecentRuns } from './agentNoRecentRuns';
import { subaccountAgentNoSkills } from './subaccountAgentNoSkills';
import { subaccountAgentNoSchedule } from './subaccountAgentNoSchedule';
import { processBrokenConnectionMapping } from './processBrokenConnectionMapping';
import { processNoEngine } from './processNoEngine';
import { systemAgentLinkNeverSynced } from './systemAgentLinkNeverSynced';

export const ALL_DETECTORS: Detector[] = [
  agentNoRecentRuns,
  subaccountAgentNoSkills,
  subaccountAgentNoSchedule,
  processBrokenConnectionMapping,
  processNoEngine,
  systemAgentLinkNeverSynced,
];

export {
  agentNoRecentRuns,
  subaccountAgentNoSkills,
  subaccountAgentNoSchedule,
  processBrokenConnectionMapping,
  processNoEngine,
  systemAgentLinkNeverSynced,
};
