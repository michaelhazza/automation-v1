/**
 * engineResolutionService
 *
 * Resolves which workflow engine should execute a process, following
 * the priority chain: process-specific → subaccount → organisation → system.
 */

import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { automationEngines } from '../db/schema/index.js';
import type { Automation } from '../db/schema/automations.js';
import type { AutomationEngine } from '../db/schema/automationEngines.js';

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
    automation: Automation,
    subaccountId: string,
    orgId: string
  ): Promise<AutomationEngine> {
    // 1. Process has a specific engine assigned
    if (process.workflowEngineId) {
      const [engine] = await db.select()
        .from(automationEngines)
        .where(and(
          eq(automationEngines.id, process.workflowEngineId),
          eq(automationEngines.status, 'active'),
          isNull(automationEngines.deletedAt)
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
      .from(automationEngines)
      .where(and(
        eq(automationEngines.subaccountId, subaccountId),
        eq(automationEngines.scope, 'subaccount'),
        eq(automationEngines.status, 'active'),
        isNull(automationEngines.deletedAt)
      ));
    if (subEngine) return subEngine;

    // 3. Organisation-scoped engine
    const [orgEngine] = await db.select()
      .from(automationEngines)
      .where(and(
        eq(automationEngines.organisationId, orgId),
        eq(automationEngines.scope, 'organisation'),
        eq(automationEngines.status, 'active'),
        isNull(automationEngines.deletedAt)
      ));
    if (orgEngine) return orgEngine;

    // 4. System-scoped engine
    const [sysEngine] = await db.select()
      .from(automationEngines)
      .where(and(
        eq(automationEngines.scope, 'system'),
        eq(automationEngines.status, 'active'),
        isNull(automationEngines.deletedAt)
      ));
    if (sysEngine) return sysEngine;

    throw { statusCode: 400, message: 'No active engine found for this process. Configure an engine at the subaccount, organisation, or system level.' };
  },
};
