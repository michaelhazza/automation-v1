import type { WorkflowEngineService } from './workflowEngineService.js';
import type { skillExecutor, SkillExecutionContext } from './skillExecutor.js';

/**
 * HandlerContext is injected as the last parameter to skill handlers and
 * workflow queue-lifecycle handlers that need to cross the
 * skillExecutor <-> workflowEngine boundary.
 *
 * Governance invariant (spec §5.2.3): every method on this interface MUST
 * have a cycle-break justification. Additions without one are rejected at
 * PR review. This constraint prevents HandlerContext from drifting into a
 * service locator over time.
 */
export interface HandlerContext {
  workflowEngine: Pick<typeof WorkflowEngineService, 'enqueueTick' | 'tick' | 'dispatchStep'> & {
    /**
     * Cycle-break: replaces dynamic `await import('../../workflowRunStartSkillService.js')`
     * in handlers that need to start a workflow run (e.g. workflowStudio.ts:184).
     */
    startWorkflowRun: (input: Record<string, unknown>, ctx: SkillExecutionContext) => Promise<unknown>;
  };
  /**
   * Cycle-break: replaces static `import { skillExecutor }` in
   * workflowActionCallExecutor.ts, allowing that file to live outside both
   * the skillExecutor and workflowEngine import graphs.
   */
  skillExecutor: Pick<typeof skillExecutor, 'execute'>;
}
