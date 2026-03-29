/**
 * processResolutionService
 *
 * Given a process_id and subaccount_id, resolves the full execution context:
 * process access, connection mappings, token loading, engine resolution, and config merging.
 */

import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  processes,
  subaccountProcessLinks,
  processConnectionMappings,
  integrationConnections,
} from '../db/schema/index.js';
import { engineResolutionService } from './engineResolutionService.js';
import { connectionTokenService } from './connectionTokenService.js';
import type { Process } from '../db/schema/processes.js';
import type { WorkflowEngine } from '../db/schema/workflowEngines.js';

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
  process: Process;
  engine: WorkflowEngine;
  connections: Record<string, ResolvedConnection>;
  config: Record<string, unknown>;
  connectionSnapshot: Record<string, ConnectionSnapshot>;
}

export const processResolutionService = {
  /**
   * Resolve everything needed to execute a process in a subaccount context.
   */
  async resolveForExecution(
    processId: string,
    subaccountId: string,
    orgId: string,
    configOverrides?: Record<string, unknown>
  ): Promise<ExecutionContext> {
    // 1. Load the process
    const [process] = await db.select()
      .from(processes)
      .where(and(eq(processes.id, processId), isNull(processes.deletedAt)));

    if (!process) {
      throw { statusCode: 404, message: 'Process not found' };
    }
    if (process.status !== 'active') {
      throw { statusCode: 400, message: 'Process is not active' };
    }

    // 2. Validate subaccount can access this process
    await processResolutionService.validateAccess(process, subaccountId, orgId);

    // 3. Load connection mappings and validate
    const { connections, connectionSnapshot } = await processResolutionService.resolveConnections(
      process, subaccountId
    );

    // 4. Resolve engine
    const engine = await engineResolutionService.resolveEngine(process, subaccountId, orgId);

    // 5. Merge config
    const config = await processResolutionService.resolveConfig(process, subaccountId, configOverrides);

    return { process, engine, connections, config, connectionSnapshot };
  },

  /**
   * Check whether the subaccount has access to this process:
   * - system-scoped: always accessible
   * - org-scoped: accessible if same org AND linked via subaccount_process_links
   * - subaccount-scoped: accessible only if owned by this subaccount
   */
  async validateAccess(process: Process, subaccountId: string, orgId: string): Promise<void> {
    if (process.scope === 'system') return; // system processes accessible to all

    if (process.scope === 'subaccount') {
      if (process.subaccountId !== subaccountId) {
        throw { statusCode: 403, message: 'Process belongs to a different subaccount' };
      }
      return;
    }

    // org-scoped: must belong to same org
    if (process.organisationId !== orgId) {
      throw { statusCode: 403, message: 'Process belongs to a different organisation' };
    }

    // Must be linked to this subaccount
    const [link] = await db.select()
      .from(subaccountProcessLinks)
      .where(and(
        eq(subaccountProcessLinks.subaccountId, subaccountId),
        eq(subaccountProcessLinks.processId, process.id),
        eq(subaccountProcessLinks.isActive, true)
      ));

    if (!link) {
      throw { statusCode: 403, message: 'Process is not linked to this subaccount' };
    }
  },

  /**
   * Load and validate connection mappings for a process in a subaccount.
   */
  async resolveConnections(
    process: Process,
    subaccountId: string
  ): Promise<{
    connections: Record<string, ResolvedConnection>;
    connectionSnapshot: Record<string, ConnectionSnapshot>;
  }> {
    const required = process.requiredConnections ?? [];
    if (required.length === 0) {
      return { connections: {}, connectionSnapshot: {} };
    }

    // Load all mappings for this process + subaccount
    const mappings = await db.select()
      .from(processConnectionMappings)
      .where(and(
        eq(processConnectionMappings.subaccountId, subaccountId),
        eq(processConnectionMappings.processId, process.id)
      ));

    const mappingByKey = new Map(mappings.map(m => [m.connectionKey, m]));

    // Validate required slots
    for (const slot of required) {
      if (slot.required && !mappingByKey.has(slot.key)) {
        throw { statusCode: 400, message: `Missing required connection mapping: "${slot.key}" (${slot.provider})` };
      }
    }

    // Load and decrypt tokens for each mapped connection
    const connections: Record<string, ResolvedConnection> = {};
    const connectionSnapshot: Record<string, ConnectionSnapshot> = {};

    for (const [key, mapping] of mappingByKey.entries()) {
      const [connection] = await db.select()
        .from(integrationConnections)
        .where(eq(integrationConnections.id, mapping.connectionId));

      if (!connection) {
        throw { statusCode: 400, message: `Connection ${mapping.connectionId} for slot "${key}" not found` };
      }

      if (connection.subaccountId !== subaccountId) {
        throw { statusCode: 403, message: `Connection for slot "${key}" does not belong to this subaccount` };
      }

      if (connection.connectionStatus !== 'active') {
        throw { statusCode: 400, message: `Connection for slot "${key}" has status "${connection.connectionStatus}"` };
      }

      // Decrypt and refresh token
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
   * Merge process default config with subaccount-level overrides and per-run overrides.
   */
  async resolveConfig(
    process: Process,
    subaccountId: string,
    runOverrides?: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const base = (process.defaultConfig as Record<string, unknown>) ?? {};

    // Load subaccount link overrides
    const [link] = await db.select()
      .from(subaccountProcessLinks)
      .where(and(
        eq(subaccountProcessLinks.subaccountId, subaccountId),
        eq(subaccountProcessLinks.processId, process.id)
      ));

    const linkOverrides = (link?.configOverrides as Record<string, unknown>) ?? {};
    const perRun = runOverrides ?? {};

    // Merge: base ← link overrides ← per-run overrides
    return { ...base, ...linkOverrides, ...perRun };
  },
};
