/**
 * WorkflowEngineService — public re-export facade.
 *
 * The engine implementation lives in server/services/workflowEngine/.
 * This file re-exports the public API so existing callers need no import changes.
 */

import { enqueueTick, TICK_QUEUE, WATCHDOG_QUEUE } from './workflowEngine/constants.js';
import {
  failStepRunInternal,
  computeDownstreamSet,
  handleBulkFanOut,
  checkBulkParentCompletion,
  replayDispatch,
  createReplayRun,
  estimateCascadeCostCents,
  computeCriticalPath,
  completeStepRunInternal,
  completeStepRunFromReview,
  completeStepRun,
  failStepRun,
  resumeInvokeAutomationStep,
} from './workflowEngine/stepLifecycle.js';
import { tick } from './workflowEngine/queueLifecycle/tick.js';
import {
  dispatchStep,
  resolveAgentForStep,
  findReusableOutputForStep,
  editStepOutput,
} from './workflowEngine/queueLifecycle/dispatch.js';
import { watchdogSweep } from './workflowEngine/queueLifecycle/watchdog.js';
import {
  onAgentRunCompleted,
  handleDecisionStepCompletion,
} from './workflowEngine/queueLifecycle/agentStep.js';
import { registerWorkers } from './workflowEngine/queueLifecycle/registerWorkers.js';

export const WorkflowEngineService = {
  TICK_QUEUE,
  WATCHDOG_QUEUE,
  enqueueTick,
  tick,
  dispatchStep,
  resolveAgentForStep,
  findReusableOutputForStep,
  resumeInvokeAutomationStep,
  failStepRunInternal,
  computeDownstreamSet,
  editStepOutput,
  handleBulkFanOut,
  checkBulkParentCompletion,
  replayDispatch,
  createReplayRun,
  estimateCascadeCostCents,
  computeCriticalPath,
  completeStepRunInternal,
  completeStepRunFromReview,
  completeStepRun,
  failStepRun,
  onAgentRunCompleted,
  handleDecisionStepCompletion,
  watchdogSweep,
  registerWorkers,
};
