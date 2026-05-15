export type { AgentPersonality, AgentRunPreview, AgentFull, DataSourceScope, LoadedDataSource } from './agentService/types.js';

import { dataSyncScheduler } from './agentService/scheduler.js';
export { dataSyncScheduler };

export { loadSourceContent } from './agentService/externalFetchers.js';
import { loadSourceContent } from './agentService/externalFetchers.js';
import { fetchDataSourcesByScope, fetchAgentDataSources } from './agentService/dataSourceScope.js';
export { fetchDataSourcesByScope, fetchAgentDataSources } from './agentService/dataSourceScope.js';

import * as crudMethods from './agentService/crud.js';
import { _assertNotSystemManaged, _assertEtag } from './agentService/helpers.js';
import { agentDataSourcesMethods } from './agentService/agentDataSources.js';
import { scheduledTaskDataSourcesMethods } from './agentService/scheduledTaskDataSources.js';
import { agentFullViewMethods } from './agentService/agentFullView.js';

export const agentService = {
  ...crudMethods,
  _assertNotSystemManaged,
  _assertEtag,

  ...agentDataSourcesMethods,

  fetchAgentDataSources,
  fetchDataSourcesByScope,
  loadSourceContent,

  ...scheduledTaskDataSourcesMethods,

  // Note: previewScheduledTaskReassignment was removed in the pr-reviewer
  // hardening pass. The cascade itself in scheduledTaskService.update is
  // implemented and transactional, but the UI flow that would have called
  // this preview endpoint was deferred — there's no agent picker in the
  // ScheduledTaskDetailPage edit form yet. When the agent reassignment UI
  // lands, restore this method (it was a pure read with no side effects)
  // and re-add the GET /reassignment-preview route in scheduledTasks.ts.

  ...agentFullViewMethods,
};
