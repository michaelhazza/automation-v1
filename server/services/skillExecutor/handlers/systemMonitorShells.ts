import type { SkillHandler } from '../context.js';

export const systemMonitorShellHandlers: Record<string, SkillHandler> = {
  read_agent_run: async (input, context) => {
    const { executeReadAgentRun } = await import('../../systemMonitor/skills/readAgentRun.js');
    return executeReadAgentRun(input, context);
  },
  read_baseline: async (input, context) => {
    const { executeReadBaseline } = await import('../../systemMonitor/skills/readBaseline.js');
    return executeReadBaseline(input, context);
  },
  read_connector_state: async (input, context) => {
    const { executeReadConnectorState } = await import('../../systemMonitor/skills/readConnectorState.js');
    return executeReadConnectorState(input, context);
  },
  read_dlq_recent: async (input, context) => {
    const { executeReadDlqRecent } = await import('../../systemMonitor/skills/readDlqRecent.js');
    return executeReadDlqRecent(input, context);
  },
  read_heuristic_fires: async (input, context) => {
    const { executeReadHeuristicFires } = await import('../../systemMonitor/skills/readHeuristicFires.js');
    return executeReadHeuristicFires(input, context);
  },
  read_incident: async (input, context) => {
    const { executeReadIncident } = await import('../../systemMonitor/skills/readIncident.js');
    return executeReadIncident(input, context);
  },
  read_logs_for_correlation_id: async (input, context) => {
    const { executeReadLogsForCorrelationId } = await import('../../systemMonitor/skills/readLogsForCorrelationId.js');
    return executeReadLogsForCorrelationId(input, context);
  },
  read_recent_runs_for_agent: async (input, context) => {
    const { executeReadRecentRunsForAgent } = await import('../../systemMonitor/skills/readRecentRunsForAgent.js');
    return executeReadRecentRunsForAgent(input, context);
  },
  read_skill_execution: async (input, context) => {
    const { executeReadSkillExecution } = await import('../../systemMonitor/skills/readSkillExecution.js');
    return executeReadSkillExecution(input, context);
  },
  write_diagnosis: async (input, context) => {
    const { executeWriteDiagnosis } = await import('../../systemMonitor/skills/writeDiagnosis.js');
    return executeWriteDiagnosis(input, context);
  },
  write_event: async (input, context) => {
    const { executeWriteEvent } = await import('../../systemMonitor/skills/writeEvent.js');
    return executeWriteEvent(input, context);
  },
};
