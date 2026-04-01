// ---------------------------------------------------------------------------
// MCP Server — exposes the action registry as MCP tools via McpServer.
//
// Each registered action type becomes an MCP tool. All calls are routed
// through skillExecutor.execute() so the full HITL gate, audit trail, and
// processor pipeline apply identically to both internal and MCP invocations.
//
// A tool-catalogue resource is also exposed so clients can browse available
// tools with their MCP annotations without calling tools directly.
// ---------------------------------------------------------------------------

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ACTION_REGISTRY } from '../config/actionRegistry.js';
import { skillExecutor } from '../services/skillExecutor.js';

const SERVER_NAME = 'automation-os';
const SERVER_VERSION = '1.0.0';

/**
 * Build a fresh McpServer instance bound to the given execution context.
 *
 * A new instance is created per HTTP request so each session carries its
 * own tenant context — no shared mutable state across requests.
 */
export function buildMcpServer(context: {
  runId: string;
  organisationId: string;
  subaccountId: string;
  agentId: string;
}): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  // ── Register every action type as an MCP tool ──────────────────────────
  for (const [slug, def] of Object.entries(ACTION_REGISTRY)) {
    const annotations = def.mcp?.annotations;

    server.tool(
      slug,
      `${slug.replace(/_/g, ' ')} — category: ${def.actionCategory}`,
      { payload: z.record(z.unknown()).describe('Action-specific payload fields') },
      {
        readOnlyHint:   annotations?.readOnlyHint   ?? false,
        destructiveHint: annotations?.destructiveHint ?? false,
        idempotentHint: annotations?.idempotentHint  ?? false,
        openWorldHint:  annotations?.openWorldHint   ?? false,
      },
      async (args) => {
        try {
          const result = await skillExecutor.execute({
            skillName: slug,
            input: args.payload ?? {},
            context: {
              runId: context.runId,
              organisationId: context.organisationId,
              subaccountId: context.subaccountId,
              agentId: context.agentId,
              orgProcesses: [],
            },
          });

          return {
            content: [
              {
                type: 'text' as const,
                text: typeof result === 'string' ? result : JSON.stringify(result),
              },
            ],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: 'text' as const, text: `Error: ${message}` }],
            isError: true,
          };
        }
      },
    );
  }

  // ── tool-catalogue resource ────────────────────────────────────────────
  // Returns all registered tools with their MCP annotations and payload
  // field list. Clients can read this to discover available capabilities.
  server.resource(
    'tool-catalogue',
    'tool-catalogue://all',
    { mimeType: 'application/json' },
    async () => {
      const catalogue = Object.values(ACTION_REGISTRY).map((def) => ({
        slug: def.actionType,
        category: def.actionCategory,
        isExternal: def.isExternal,
        defaultGateLevel: def.defaultGateLevel,
        payloadFields: def.payloadFields,
        annotations: def.mcp?.annotations ?? null,
      }));

      return {
        contents: [
          {
            uri: 'tool-catalogue://all',
            mimeType: 'application/json',
            text: JSON.stringify(catalogue, null, 2),
          },
        ],
      };
    },
  );

  return server;
}
