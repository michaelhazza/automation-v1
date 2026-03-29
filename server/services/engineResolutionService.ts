/**
 * engineResolutionService
 *
 * Resolves which workflow engine should execute a process, following
 * the priority chain: process-specific → subaccount → organisation → system.
 */

import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { workflowEngines } from '../db/schema/index.js';
import type { Process } from '../db/schema/processes.js';
import type { WorkflowEngine } from '../db/schema/workflowEngines.js';

export const engineResolutionService = {
  /**
   * Resolve the engine for a given process and subaccount context.
   *
   * Priority:
   * 1. Process-specific engine (process.workflowEngineId)
   * 2. Subaccount-scoped engine
   * 3. Organisation-scoped engine
   * 4. System-scoped engine
   */
  async resolveEngine(
    process: Process,
    subaccountId: string,
    orgId: string
  ): Promise<WorkflowEngine> {
    // 1. Process has a specific engine assigned
    if (process.workflowEngineId) {
      const [engine] = await db.select()
        .from(workflowEngines)
        .where(and(
          eq(workflowEngines.id, process.workflowEngineId),
          eq(workflowEngines.status, 'active'),
          isNull(workflowEngines.deletedAt)
        ));
      if (engine) {
        // Validate engine belongs to the correct scope — prevent cross-tenant usage
        if (engine.scope === 'organisation' && engine.organisationId !== orgId) {
          throw { statusCode: 403, message: 'Process references an engine from a different organisation' };
        }
        if (engine.scope === 'subaccount' && engine.subaccountId !== subaccountId) {
          throw { statusCode: 403, message: 'Process references an engine from a different subaccount' };
        }
        return engine;
      }
      // Fall through if assigned engine is inactive/deleted
    }

    // 2. Subaccount-scoped engine
    const [subEngine] = await db.select()
      .from(workflowEngines)
      .where(and(
        eq(workflowEngines.subaccountId, subaccountId),
        eq(workflowEngines.scope, 'subaccount'),
        eq(workflowEngines.status, 'active'),
        isNull(workflowEngines.deletedAt)
      ));
    if (subEngine) return subEngine;

    // 3. Organisation-scoped engine
    const [orgEngine] = await db.select()
      .from(workflowEngines)
      .where(and(
        eq(workflowEngines.organisationId, orgId),
        eq(workflowEngines.scope, 'organisation'),
        eq(workflowEngines.status, 'active'),
        isNull(workflowEngines.deletedAt)
      ));
    if (orgEngine) return orgEngine;

    // 4. System-scoped engine
    const [sysEngine] = await db.select()
      .from(workflowEngines)
      .where(and(
        eq(workflowEngines.scope, 'system'),
        eq(workflowEngines.status, 'active'),
        isNull(workflowEngines.deletedAt)
      ));
    if (sysEngine) return sysEngine;

    throw { statusCode: 400, message: 'No active engine found for this process. Configure an engine at the subaccount, organisation, or system level.' };
  },
};
