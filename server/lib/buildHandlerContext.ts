import { WorkflowEngineService } from '../services/workflowEngineService.js';
import { skillExecutor } from '../services/skillExecutor.js';
import { handleWorkflowRunStartSkill } from '../services/workflowRunStartSkillService.js';
import type { HandlerContext } from '../services/handlerContextTypes.js';

/**
 * Boot-time factory. Call once at server startup and pass the returned
 * context to WorkflowEngineService.registerWorkers(handlerContext).
 *
 * This is the ONLY file in server/ that value-imports both
 * WorkflowEngineService and skillExecutor. All other files that need to
 * cross the skillExecutor <-> workflowEngine boundary receive a
 * HandlerContext and import only the interface type.
 */
export function buildHandlerContext(): HandlerContext {
  return {
    workflowEngine: {
      enqueueTick: WorkflowEngineService.enqueueTick,
      tick: WorkflowEngineService.tick,
      dispatchStep: WorkflowEngineService.dispatchStep,
      startWorkflowRun: handleWorkflowRunStartSkill,
    },
    skillExecutor: {
      execute: skillExecutor.execute.bind(skillExecutor),
    },
  };
}
