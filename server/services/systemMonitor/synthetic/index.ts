import type { SyntheticCheck } from './types.js';
import { pgBossQueueStalled } from './pgBossQueueStalled.js';
import { noAgentRunsInWindow } from './noAgentRunsInWindow.js';
import { connectorPollStale } from './connectorPollStale.js';
import { dlqNotDrained } from './dlqNotDrained.js';
import { heartbeatSelf } from './heartbeatSelf.js';
import { connectorErrorRateElevated } from './connectorErrorRateElevated.js';
import { agentRunSuccessRateLow } from './agentRunSuccessRateLow.js';
import { sweepCoverageDegraded } from './sweepCoverageDegraded.js';

export const SYNTHETIC_CHECKS: SyntheticCheck[] = [
  pgBossQueueStalled,
  noAgentRunsInWindow,
  connectorPollStale,
  dlqNotDrained,
  heartbeatSelf,
  connectorErrorRateElevated,
  agentRunSuccessRateLow,
  sweepCoverageDegraded,
];

export type { SyntheticCheck };
export { type SyntheticResult, bucket15min } from './types.js';
