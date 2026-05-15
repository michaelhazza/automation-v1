import type { SkillHandler } from '../context.js';

// All dynamic-import dispatchers have a natural family home (systemMonitorShells,
// optimiserShells, spendShells, configShells, capabilityDiscovery, crm, orgInsights,
// output, threadContext, notifyOperator, memoryBlock, financialReporting,
// mediaTranscription, digest, memory, support, calendar, slack, meta) per spec §5.2.1.
// No catch-all thin dispatchers remain after the per-family splits.
export const thinDispatcherHandlers: Record<string, SkillHandler> = {};
