/**
 * Structural test asserting that buildHandlerContext() returns a HandlerContext
 * whose workflowEngine and skillExecutor properties are callable functions.
 *
 * This is a boot-wiring test (wave-4 Chunk 4). It does NOT exercise the engine
 * or executor end-to-end — it only confirms the factory wires real (not stub)
 * values so that call-sites routing through handlerContext get live dispatch.
 */

import { describe, it, expect } from 'vitest';
import { buildHandlerContext } from '../lib/buildHandlerContext.js';

describe('buildHandlerContext', () => {
  it('returns an object with workflowEngine.enqueueTick as a function', () => {
    const ctx = buildHandlerContext();
    expect(typeof ctx.workflowEngine.enqueueTick).toBe('function');
  });

  it('returns an object with workflowEngine.tick as a function', () => {
    const ctx = buildHandlerContext();
    expect(typeof ctx.workflowEngine.tick).toBe('function');
  });

  it('returns an object with workflowEngine.dispatchStep as a function', () => {
    const ctx = buildHandlerContext();
    expect(typeof ctx.workflowEngine.dispatchStep).toBe('function');
  });

  it('returns an object with workflowEngine.startWorkflowRun as a function', () => {
    const ctx = buildHandlerContext();
    expect(typeof ctx.workflowEngine.startWorkflowRun).toBe('function');
  });

  it('returns an object with skillExecutor.execute as a function', () => {
    const ctx = buildHandlerContext();
    expect(typeof ctx.skillExecutor.execute).toBe('function');
  });
});
