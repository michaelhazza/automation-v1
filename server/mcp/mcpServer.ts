// ---------------------------------------------------------------------------
// MCP Server — exposes the action registry AND system skills as MCP tools.
//
// Each registered action type becomes an MCP tool with typed parameter schemas
// and real descriptions. System skills from .md files that are NOT in the
// action registry are also exposed, so MCP clients see the full tool surface.
//
// Tool-catalogue resource is also exposed so clients can browse available
// tools with their MCP annotations without calling tools directly.
// ---------------------------------------------------------------------------

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ACTION_REGISTRY, type ParameterSchema } from '../config/actionRegistry.js';
import { skillExecutor } from '../services/skillExecutor.js';
import { systemSkillService, type SystemSkill } from '../services/systemSkillService.js';

const SERVER_NAME = 'automation-os';
const SERVER_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a JSON Schema ParameterSchema into a Zod record that the MCP SDK
 * can use for tool parameter validation.
 *
 * We build a z.object() with the correct field types so MCP clients get
 * properly typed tool definitions instead of z.record(z.unknown()).
 */
function parameterSchemaToZod(schema: ParameterSchema): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, prop] of Object.entries(schema.properties)) {
    let field: z.ZodTypeAny;

    switch (prop.type) {
      case 'number':
        field = z.number();
        break;
      case 'boolean':
        field = z.boolean();
        break;
      case 'array':
        field = z.array(z.unknown());
        break;
      case 'object':
        field = z.record(z.unknown());
        break;
      default: // string and fallback
        if (prop.enum) {
          field = z.enum(prop.enum as [string, ...string[]]);
        } else {
          field = z.string();
        }
    }

    if (prop.description) {
      field = field.describe(prop.description);
    }

    if (!schema.required.includes(key)) {
      field = field.optional();
    }

    shape[key] = field;
  }

  return z.object(shape);
}

/**
 * Convert an AnthropicTool input_schema from a system skill .md file
 * into a ParameterSchema so we can reuse the same Zod conversion.
 */
function anthropicSchemaToParameterSchema(inputSchema: SystemSkill['definition']['input_schema']): ParameterSchema {
  return {
    type: 'object',
    properties: inputSchema.properties as ParameterSchema['properties'],
    required: inputSchema.required ?? [],
  };
}

/**
 * Build a fresh McpServer instance bound to the given execution context.
 *
 * A new instance is created per HTTP request so each session carries its
 * own tenant context — no shared mutable state across requests.
 *
 * @param allowedSkillSlugs — if provided, only these tool slugs are exposed.
 *   Mirrors the toolRestrictionMiddleware behaviour for MCP clients.
 */
export async function buildMcpServer(context: {
  runId: string;
  organisationId: string;
  subaccountId: string;
  agentId: string;
  allowedSkillSlugs?: string[] | null;
}): Promise<McpServer> {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  const allowlist = context.allowedSkillSlugs?.length ? new Set(context.allowedSkillSlugs) : null;

  // Track which slugs we register so we don't double-register when a skill
  // exists in both the action registry and as a system skill .md file.
  const registeredSlugs = new Set<string>();

  // ── 1. Register action registry entries as MCP tools ───────────────────
  for (const [slug, def] of Object.entries(ACTION_REGISTRY)) {
    // Filter by allowlist if one is configured
    if (allowlist && !allowlist.has(slug)) continue;

    const annotations = def.mcp?.annotations;
    const zodSchema = parameterSchemaToZod(def.parameterSchema);

    server.tool(
      slug,
      def.description,
      { payload: zodSchema },
      {
        readOnlyHint:    annotations?.readOnlyHint    ?? false,
        destructiveHint: annotations?.destructiveHint ?? false,
        idempotentHint:  annotations?.idempotentHint  ?? false,
        openWorldHint:   annotations?.openWorldHint   ?? false,
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

    registeredSlugs.add(slug);
  }

  // ── 2. Register system skills NOT already in the action registry ───────
  const systemSkills = await systemSkillService.listActiveSkills();

  for (const skill of systemSkills) {
    if (registeredSlugs.has(skill.slug)) continue;
    if (allowlist && !allowlist.has(skill.slug)) continue;

    const paramSchema = anthropicSchemaToParameterSchema(skill.definition.input_schema);
    const zodSchema = parameterSchemaToZod(paramSchema);

    server.tool(
      skill.slug,
      skill.definition.description || skill.description,
      { payload: zodSchema },
      {
        // System skills default to non-destructive, non-external
        readOnlyHint:    false,
        destructiveHint: false,
        idempotentHint:  false,
        openWorldHint:   false,
      },
      async (args) => {
        try {
          const result = await skillExecutor.execute({
            skillName: skill.slug,
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

    registeredSlugs.add(skill.slug);
  }

  // ── tool-catalogue resource ────────────────────────────────────────────
  // Returns all registered tools with their MCP annotations, descriptions,
  // and parameter schemas. Clients can read this to discover capabilities.
  server.resource(
    'tool-catalogue',
    'tool-catalogue://all',
    { mimeType: 'application/json' },
    async () => {
      const registryEntries = Object.values(ACTION_REGISTRY)
        .filter((def) => !allowlist || allowlist.has(def.actionType))
        .map((def) => ({
          slug: def.actionType,
          description: def.description,
          category: def.actionCategory,
          isExternal: def.isExternal,
          defaultGateLevel: def.defaultGateLevel,
          parameterSchema: def.parameterSchema,
          annotations: def.mcp?.annotations ?? null,
        }));

      const skillEntries = systemSkills
        .filter((s) => !registeredSlugs.has(s.slug) || !ACTION_REGISTRY[s.slug])
        .filter((s) => !allowlist || allowlist.has(s.slug))
        .map((s) => ({
          slug: s.slug,
          description: s.definition.description || s.description,
          category: 'system_skill',
          isExternal: false,
          defaultGateLevel: 'auto',
          parameterSchema: anthropicSchemaToParameterSchema(s.definition.input_schema),
          annotations: null,
        }));

      const catalogue = [...registryEntries, ...skillEntries];

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
