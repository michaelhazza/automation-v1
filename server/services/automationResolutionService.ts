/**
 * automationResolutionService
 *
 * Given an automation_id and subaccount_id, resolves the full execution context:
 * automation access, connection mappings, token loading, engine resolution, and config merging.
 */

import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  automations,
  subaccountAutomationLinks,
  automationConnectionMappings,
  integrationConnections,
} from '../db/schema/index.js';
import { engineResolutionService } from './engineResolutionService.js';
import { connectionTokenService } from './connectionTokenService.js';
import type { Automation } from '../db/schema/automations.js';
import type { AutomationEngine } from '../db/schema/automationEngines.js';

interface ResolvedConnection {
  token: string;
  connectionId: string;
}

interface ConnectionSnapshot {
  connection_id: string;
  provider: string;
  label: string | null;
  status: string;
}

interface ExecutionContext {
  automation: Automation;
  engine: AutomationEngine;
  connections: Record<string, ResolvedConnection>;
  config: Record<string, unknown>;
  connectionSnapshot: Record<string, ConnectionSnapshot>;
}

export const automationResolutionService = {
  /**
   * Resolve everything needed to execute an automation in a subaccount context.
   *
   * For system-managed automations the org-level record is the "face" shown to
   * org admins (name, description, config overrides) while the actual
   * execution details (webhookPath, requiredConnections, engine assignment)
   * are sourced from the linked system automation at runtime.
   */
  async resolveForExecution(
    automationId: string,
    subaccountId: string,
    orgId: string,
    configOverrides?: Record<string, unknown>
  ): Promise<ExecutionContext> {
    // 1. Load the automation
    const [automation] = await db.select()
      .from(automations)
      .where(and(eq(automations.id, automationId), isNull(automations.deletedAt)));

    if (!automation) {
      throw { statusCode: 404, message: 'Automation not found' };
    }
    if (automation.status !== 'active') {
      throw { statusCode: 400, message: 'Automation is not active' };
    }

    // 2. Validate subaccount can access this automation
    await automationResolutionService.validateAccess(automation, subaccountId, orgId);

    // 3. For system-managed automations, resolve the inner config from the system automation.
    //    The org automation is the "shell"; the system automation provides the execution blueprint.
    const executionAutomation = await automationResolutionService.resolveSystemAutomation(automation);

    // 4. Load connection mappings
    const { connections, connectionSnapshot } = await automationResolutionService.resolveConnections(
      executionAutomation, subaccountId, automation.id
    );

    // 5. Resolve engine
    const engine = await engineResolutionService.resolveEngine(executionAutomation, subaccountId, orgId);

    // 6. Merge config
    const config = await automationResolutionService.resolveConfig(automation, subaccountId, configOverrides, executionAutomation);

    return { automation: executionAutomation, engine, connections, config, connectionSnapshot };
  },

  /**
   * If the automation is system-managed, load and return the linked system automation.
   * Falls through unchanged for non-system-managed automations.
   */
  async resolveSystemAutomation(automation: Automation): Promise<Automation> {
    if (!automation.isSystemManaged || !automation.systemProcessId) return automation;

    const [systemAutomation] = await db.select()
      .from(automations)
      .where(and(
        eq(automations.id, automation.systemProcessId),
        eq(automations.scope, 'system'),
        isNull(automations.deletedAt)
      ));

    if (!systemAutomation) {
      throw { statusCode: 400, message: `Linked system automation ${automation.systemProcessId} not found or deleted` };
    }
    if (systemAutomation.status !== 'active') {
      throw { statusCode: 400, message: `Linked system automation "${systemAutomation.name}" is not active` };
    }

    return systemAutomation;
  },

  /**
   * Check whether the subaccount has access to this automation:
   * - system-scoped: always accessible
   * - org-scoped: accessible if same org AND linked via subaccount_automation_links
   * - subaccount-scoped: accessible only if owned by this subaccount
   */
  async validateAccess(automation: Automation, subaccountId: string, orgId: string): Promise<void> {
    if (automation.scope === 'system') return;

    if (automation.scope === 'subaccount') {
      if (automation.subaccountId !== subaccountId) {
        throw { statusCode: 403, message: 'Automation belongs to a different subaccount' };
      }
      return;
    }

    if (automation.organisationId !== orgId) {
      throw { statusCode: 403, message: 'Automation belongs to a different organisation' };
    }

    const [link] = await db.select()
      .from(subaccountAutomationLinks)
      .where(and(
        eq(subaccountAutomationLinks.subaccountId, subaccountId),
        eq(subaccountAutomationLinks.processId, automation.id),
        eq(subaccountAutomationLinks.isActive, true)
      ));

    if (!link) {
      throw { statusCode: 403, message: 'Automation is not linked to this subaccount' };
    }
  },

  /**
   * Load and validate connection mappings for an automation in a subaccount.
   */
  async resolveConnections(
    automation: Automation,
    subaccountId: string,
    mappingAutomationId?: string
  ): Promise<{
    connections: Record<string, ResolvedConnection>;
    connectionSnapshot: Record<string, ConnectionSnapshot>;
  }> {
    const required = automation.requiredConnections ?? [];
    if (required.length === 0) {
      return { connections: {}, connectionSnapshot: {} };
    }

    const lookupId = mappingAutomationId ?? automation.id;
    const mappings = await db.select()
      .from(automationConnectionMappings)
      .where(and(
        eq(automationConnectionMappings.subaccountId, subaccountId),
        eq(automationConnectionMappings.processId, lookupId)
      ));

    const mappingByKey = new Map(mappings.map(m => [m.connectionKey, m]));

    for (const slot of required) {
      if (slot.required && !mappingByKey.has(slot.key)) {
        throw { statusCode: 400, message: `Missing required connection mapping: "${slot.key}" (${slot.provider})` };
      }
    }

    const connections: Record<string, ResolvedConnection> = {};
    const connectionSnapshot: Record<string, ConnectionSnapshot> = {};

    for (const [key, mapping] of mappingByKey.entries()) {
      const [connection] = await db.select()
        .from(integrationConnections)
        // guard-ignore-next-line: org-scoped-writes reason="read-only SELECT; connectionId obtained from automationConnectionMappings row which is org-scoped"
        .where(eq(integrationConnections.id, mapping.connectionId));

      if (!connection) {
        throw { statusCode: 400, message: `Connection ${mapping.connectionId} for slot "${key}" not found` };
      }

      if (connection.subaccountId !== subaccountId && connection.subaccountId !== null) {
        throw { statusCode: 403, message: `Connection for slot "${key}" does not belong to this subaccount` };
      }

      if (connection.connectionStatus !== 'active') {
        throw { statusCode: 400, message: `Connection for slot "${key}" has status "${connection.connectionStatus}"` };
      }

      const token = await connectionTokenService.getAccessToken(connection);

      connections[key] = { token, connectionId: connection.id };
      connectionSnapshot[key] = {
        connection_id: connection.id,
        provider: connection.providerType,
        label: connection.label,
        status: connection.connectionStatus,
      };
    }

    return { connections, connectionSnapshot };
  },

  /**
   * Merge automation default config with subaccount-level overrides and per-run overrides.
   */
  async resolveConfig(
    automation: Automation,
    subaccountId: string,
    runOverrides?: Record<string, unknown>,
    systemAutomation?: Automation
  ): Promise<Record<string, unknown>> {
    const systemBase = systemAutomation
      ? ((systemAutomation.defaultConfig as Record<string, unknown>) ?? {})
      : {};
    const base = (automation.defaultConfig as Record<string, unknown>) ?? {};

    const [link] = await db.select()
      .from(subaccountAutomationLinks)
      .where(and(
        eq(subaccountAutomationLinks.subaccountId, subaccountId),
        eq(subaccountAutomationLinks.processId, automation.id)
      ));

    const linkOverrides = (link?.configOverrides as Record<string, unknown>) ?? {};
    const perRun = runOverrides ?? {};

    return { ...systemBase, ...base, ...linkOverrides, ...perRun };
  },
};
