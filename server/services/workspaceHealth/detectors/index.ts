/**
 * detectors/index.ts — Brain Tree OS adoption P4.
 *
 * Re-exports the array of all detectors in declaration order. Adding a new
 * detector is a one-file change: create the file under `detectors/`, then
 * append it to the array below.
 *
 * Detectors are pure functions and can be unit-tested independently. The
 * runner walks this list and concatenates the results.
 *
 * Async (impure) detectors that perform their own DB reads are exported
 * separately via ASYNC_DETECTORS. The impure runner invokes them after the
 * pure sweep and merges the results.
 */

import type { Detector } from '../detectorTypes';
import { agentNoRecentRuns } from './agentNoRecentRuns';
import { subaccountAgentNoSkills } from './subaccountAgentNoSkills';
import { subaccountAgentNoSchedule } from './subaccountAgentNoSchedule';
import { processBrokenConnectionMapping } from './processBrokenConnectionMapping';
import { processNoEngine } from './processNoEngine';
import { systemAgentLinkNeverSynced } from './systemAgentLinkNeverSynced';
import { detectStaleConnectors } from './staleConnectorDetector';
import { detectSubaccountMultipleRoots } from './subaccountMultipleRoots';
import { detectSubaccountNoRoot } from './subaccountNoRoot';
import { detectExplicitDelegationSkillsWithoutChildren } from './explicitDelegationSkillsWithoutChildren';

export const ALL_DETECTORS: Detector[] = [
  agentNoRecentRuns,
  subaccountAgentNoSkills,
  subaccountAgentNoSchedule,
  processBrokenConnectionMapping,
  processNoEngine,
  systemAgentLinkNeverSynced,
];

/**
 * Async detectors that query the DB directly. Each entry is a function
 * that takes (organisationId) and returns WorkspaceHealthFinding[].
 */
export const ASYNC_DETECTORS = [
  detectStaleConnectors,
  detectSubaccountMultipleRoots,
  detectSubaccountNoRoot,
  detectExplicitDelegationSkillsWithoutChildren,   // Phase 4 — §6.9
] as const;

export {
  agentNoRecentRuns,
  subaccountAgentNoSkills,
  subaccountAgentNoSchedule,
  processBrokenConnectionMapping,
  processNoEngine,
  systemAgentLinkNeverSynced,
  detectStaleConnectors,
  detectSubaccountMultipleRoots,
  detectSubaccountNoRoot,
  detectExplicitDelegationSkillsWithoutChildren,
};
