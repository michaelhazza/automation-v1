/**
 * Register ClientPulse's sensitive operational_config dot-paths.
 *
 * Imported once at server boot via server/index.ts so the paths are in the
 * registry before any route registers. Per spec §3.6 + §4.10(3) — top of the
 * route-wiring section, before any route registration.
 *
 * Paths enumerated from spec §3.6. Changes here are deliberate deploys; the
 * registry is append-only at runtime.
 */

import { registerSensitiveConfigPaths } from '../../config/sensitiveConfigPathsRegistry.js';

registerSensitiveConfigPaths('clientpulse', [
  // Intervention governance — changes affect every subsequent proposal
  'interventionDefaults.defaultGateLevel',
  'interventionDefaults.cooldownHours',
  'interventionDefaults.maxProposalsPerDayPerSubaccount',
  'interventionDefaults.maxProposalsPerDayPerOrg',
  'interventionTemplates',
  // Scoring / band definitions — changing these reshapes every client's view
  'healthScoreFactors',
  'churnRiskSignals',
  'churnBands',
  // Staff-activity classification — excluding a user kind hides activity signals
  'staffActivity.excludedUserKinds',
  'staffActivity.automationUserResolution',
  'staffActivity.churnFlagThresholds',
  // Alert limits — lowering these can mask incidents
  'alertLimits.maxAlertsPerRun',
  'alertLimits.maxAlertsPerAccountPerDay',
  // Data retention — shortening destroys history
  'dataRetention',
]);
