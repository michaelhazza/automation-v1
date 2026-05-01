import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createHash, randomUUID } from 'crypto';
import { logger } from '../lib/logger.js';
import { mcpServerConfigService } from './mcpServerConfigService.js';
import { integrationConnectionService } from './integrationConnectionService.js';
import { connectionTokenService } from './connectionTokenService.js';
import type { McpServerConfig } from '../db/schema/mcpServerConfigs.js';
import type { AnthropicTool } from './llmService.js';
import {
  MAX_MCP_TOOLS_PER_RUN,
  MAX_MCP_CALLS_PER_RUN,
  MAX_MCP_RESPONSE_SIZE,
  MCP_CONNECT_TIMEOUT_MS,
  MCP_CALL_TIMEOUT_MS,
  MCP_CIRCUIT_BREAKER_THRESHOLD,
  MCP_CIRCUIT_BREAKER_DURATION_MS,
  MCP_TOOLS_CACHE_TTL_MS,
  MCP_ALLOWED_COMMANDS,
} from '../config/limits.js';
import { db } from '../db/index.js';
import { mcpToolInvocations } from '../db/schema/mcpToolInvocations.js';
import { mcpAggregateService } from './mcpAggregateService.js';

// ---------------------------------------------------------------------------
// MCP Client Manager — lifecycle, tool discovery, and tool calling for
// external MCP servers. Creates per-run client instances.
// ---------------------------------------------------------------------------

export interface McpClientInstance {
  client: Client;
  transport: StdioClientTransport;
  serverSlug: string;
  serverConfig: McpServerConfig;
  tools: Array<{ name: string; description?: string; inputSchema: Record<string, unknown>; annotations?: Record<string, boolean> }>;
}

interface McpRunContext {
  runId: string;
  organisationId: string;
  agentId: string;
  subaccountId: string | null;
  isTestRun: boolean;
}

// ---------------------------------------------------------------------------
// Failure classification
// ---------------------------------------------------------------------------

type McpFailureReason =
  | 'timeout'
  | 'process_crash'
  | 'invalid_response'
  | 'auth_error'
  | 'rate_limited'
  | 'unknown';

function classifyMcpError(err: unknown): { reason: McpFailureReason; message: string; retryable: boolean } {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (err instanceof Error && err.name === 'AbortError') return { reason: 'timeout', message, retryable: true };
  if (lower.includes('timeout') || lower.includes('deadline')) return { reason: 'timeout', message, retryable: true };
  if (lower.includes('exit code') || lower.includes('sigterm') || lower.includes('sigkill') || lower.includes('enoent')) return { reason: 'process_crash', message, retryable: true };
  if (lower.includes('auth') || lower.includes('401') || lower.includes('403') || lower.includes('token')) return { reason: 'auth_error', message, retryable: false };
  if (lower.includes('rate') || lower.includes('429')) return { reason: 'rate_limited', message, retryable: true };
  if (lower.includes('json') || lower.includes('parse') || lower.includes('schema')) return { reason: 'invalid_response', message, retryable: false };
  return { reason: 'unknown', message, retryable: false };
}

// ---------------------------------------------------------------------------
// Tool schema validation
// ---------------------------------------------------------------------------

interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: Record<string, boolean>;
}

function jsonDepth(obj: unknown, depth = 0): number {
  if (depth > 10) return depth; // safety cap
  if (typeof obj !== 'object' || obj === null) return depth;
  const entries = Object.values(obj as Record<string, unknown>);
  if (entries.length === 0) return depth;
  return Math.max(...entries.map(v => jsonDepth(v, depth + 1)));
}

function validateMcpToolSchema(tool: McpToolDefinition): { valid: boolean; reason?: string } {
  if (!tool.name || tool.name.length > 100) return { valid: false, reason: 'name too long or empty' };
  if (!/^[a-zA-Z0-9_.-]+$/.test(tool.name)) return { valid: false, reason: 'invalid name characters' };
  if (tool.description && tool.description.length > 1000) return { valid: false, reason: 'description exceeds 1000 chars' };

  if (tool.inputSchema) {
    const schema = tool.inputSchema;
    const props = (schema as { properties?: Record<string, unknown> }).properties;
    const propCount = props ? Object.keys(props).length : 0;
    if (propCount > 50) return { valid: false, reason: 'too many properties (>50)' };
    if (jsonDepth(schema) > 5) return { valid: false, reason: 'schema too deeply nested (>5)' };
    if (JSON.stringify(schema).length > 10_000) return { valid: false, reason: 'schema too large (>10KB)' };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Gate resolution
// ---------------------------------------------------------------------------

function resolveGateLevel(
  serverConfig: McpServerConfig,
  toolName: string,
  annotations?: { destructiveHint?: boolean; readOnlyHint?: boolean },
): 'auto' | 'review' | 'block' {
  // 1. Explicit per-tool override
  if (serverConfig.toolGateOverrides?.[toolName]) {
    return serverConfig.toolGateOverrides[toolName];
  }
  // 2. MCP annotation-driven: destructive tools escalate to review
  if (annotations?.destructiveHint && serverConfig.defaultGateLevel === 'auto') {
    return 'review';
  }
  // 3. Server-level default
  return serverConfig.defaultGateLevel;
}

// ---------------------------------------------------------------------------
// Credential resolution (subaccount-first, org-fallback)
// ---------------------------------------------------------------------------

async function resolveCredentials(
  config: McpServerConfig,
  subaccountId: string | null,
  organisationId: string,
): Promise<{ accessToken?: string; refreshToken?: string } | null> {
  // 1. Fixed connection override
  if (config.fixedConnectionId) {
    try {
      const conn = await integrationConnectionService.getDecryptedConnection(
        null, config.credentialProvider!, organisationId, config.fixedConnectionId,
      );
      return { accessToken: conn.accessToken, refreshToken: conn.refreshToken };
    } catch {
      return null;
    }
  }

  // 2. No credential provider — server uses envEncrypted only
  if (!config.credentialProvider) return null;

  // 3. Dynamic resolution: subaccount first, org fallback
  if (subaccountId) {
    try {
      const conn = await integrationConnectionService.getDecryptedConnection(
        subaccountId, config.credentialProvider, organisationId,
      );
      return { accessToken: conn.accessToken, refreshToken: conn.refreshToken };
    } catch {
      // Fall through to org-level
    }
  }

  try {
    const conn = await integrationConnectionService.getDecryptedConnection(
      null, config.credentialProvider, organisationId,
    );
    return { accessToken: conn.accessToken, refreshToken: conn.refreshToken };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Timeout helper
// ---------------------------------------------------------------------------

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      val => { clearTimeout(timer); resolve(val); },
      err => { clearTimeout(timer); reject(err); },
    );
  });
}

// ---------------------------------------------------------------------------
// Main service
// ---------------------------------------------------------------------------

export const mcpClientManager = {
  /**
   * Connect to all MCP servers configured for this agent run.
   * Returns Anthropic-formatted tool definitions + client handles.
   */
  async connectForRun(ctx: McpRunContext): Promise<{
    tools: AnthropicTool[];
    clients: Map<string, McpClientInstance>;
    lazyRegistry: Map<string, McpServerConfig>;
  }> {
    const configs = await mcpServerConfigService.listForAgent(ctx.agentId, ctx.organisationId);
    const clients = new Map<string, McpClientInstance>();
    const lazyRegistry = new Map<string, McpServerConfig>();
    const allTools: AnthropicTool[] = [];

    // Split by connection mode
    const eagerConfigs = configs.filter(c => c.connectionMode === 'eager');
    const lazyConfigs = configs.filter(c => c.connectionMode === 'lazy');

    // Connect eager servers (bounded concurrency = 3)
    const connectResults = await Promise.allSettled(
      eagerConfigs.map(config => this._connectSingleServer(config, ctx))
    );

    for (let i = 0; i < connectResults.length; i++) {
      const result = connectResults[i];
      const config = eagerConfigs[i];
      if (result.status === 'fulfilled' && result.value) {
        clients.set(config.slug, result.value);
        allTools.push(...this._toAnthropicTools(result.value.tools, config.slug));
      }
      // Failures already logged in _connectSingleServer
    }

    // Register lazy server tools from cache (no process spawned)
    for (const config of lazyConfigs) {
      if (!config.discoveredToolsJson?.length) continue;
      // Skip stale cache — tools must have been refreshed within TTL
      const cacheAge = config.lastToolsRefreshAt
        ? Date.now() - config.lastToolsRefreshAt.getTime()
        : Infinity;
      if (cacheAge > MCP_TOOLS_CACHE_TTL_MS) {
        logger.info('mcp.lazy_cache_stale', { serverSlug: config.slug, cacheAgeMs: cacheAge });
        continue; // stale tools not registered — server won't be available this run
      }
      lazyRegistry.set(config.slug, config);
      // Use cached tool definitions
      const cachedTools = config.discoveredToolsJson.filter((t: McpToolDefinition) => validateMcpToolSchema(t).valid);
      allTools.push(...this._toAnthropicTools(cachedTools, config.slug));
    }

    // Apply tool limit
    const limited = allTools.slice(0, MAX_MCP_TOOLS_PER_RUN);
    if (allTools.length > MAX_MCP_TOOLS_PER_RUN) {
      logger.info('mcp.tools_limited', {
        runId: ctx.runId,
        total: allTools.length,
        limit: MAX_MCP_TOOLS_PER_RUN,
      });
    }

    return { tools: limited, clients, lazyRegistry };
  },

  /**
   * Write one row to mcp_tool_invocations. Completely fire-and-forget —
   * never throws, never blocks the agent loop. The id is generated client-side
   * so the aggregate service receives the full row without awaiting a DB round-trip.
   */
  writeInvocation(params: {
    ctx: McpRunContext;
    serverSlug: string;
    toolName: string;
    mcpServerConfigId?: string;
    gateLevel: 'auto' | 'review' | 'block' | null;
    status: 'success' | 'error' | 'timeout' | 'budget_blocked';
    failureReason?: 'timeout' | 'process_crash' | 'invalid_response' | 'auth_error' | 'rate_limited' | 'unknown' | 'pre_execution_failure';
    durationMs: number;
    responseSizeBytes?: number;
    wasTruncated?: boolean;
    isRetry: boolean;
    callIndex: number | null;
  }): void {
    const now = new Date();
    const row = {
      id: randomUUID(),
      organisationId: params.ctx.organisationId,
      subaccountId: params.ctx.subaccountId ?? undefined,
      runId: params.ctx.runId !== 'test' ? params.ctx.runId : undefined,
      agentId: params.ctx.agentId !== 'test' ? params.ctx.agentId : undefined,
      mcpServerConfigId: params.mcpServerConfigId,
      serverSlug: params.serverSlug || '__unknown__',
      toolName: params.toolName || '__unknown__',
      gateLevel: params.gateLevel ?? undefined,
      status: params.status,
      // Runtime guard: error/timeout rows must carry a failureReason — fall back to 'unknown'
      // so the DB constraint (failure_reason IS NOT NULL for error/timeout) is never hit silently.
      failureReason: (params.status === 'error' || params.status === 'timeout') && !params.failureReason
        ? 'unknown'
        : (params.failureReason ?? undefined),
      durationMs: params.durationMs,
      responseSizeBytes: params.responseSizeBytes,
      wasTruncated: params.wasTruncated ?? false,
      isTestRun: params.ctx.isTestRun,
      isRetry: params.isRetry,
      callIndex: params.callIndex ?? undefined,
      billingMonth: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`,
      billingDay: now.toISOString().slice(0, 10),
      createdAt: now,
    };

    void db
      .insert(mcpToolInvocations)
      .values(row)
      .onConflictDoNothing()
      .returning({ id: mcpToolInvocations.id })
      .then((inserted) => {
        // Only update aggregates when a row was actually written — deduped rows must not
        // inflate cost_aggregates, which would break the "recomputable from ledger" guarantee.
        if (inserted.length === 0) return;
        void mcpAggregateService.upsertMcpAggregates(row as Parameters<typeof mcpAggregateService.upsertMcpAggregates>[0]).catch((err: unknown) => {
          logger.warn('mcp.aggregate_failed', {
            invocationId: row.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      })
      .catch((err: unknown) => {
        logger.warn('mcp.invocation_log_failed', { error: err instanceof Error ? err.message : String(err) });
      });
  },

  /**
   * Call a tool on an external MCP server.
   */
  async callTool(
    clients: Map<string, McpClientInstance>,
    lazyRegistry: Map<string, McpServerConfig>,
    toolSlug: string,
    args: Record<string, unknown>,
    ctx: McpRunContext & { taskId?: string; mcpCallCount?: number },
    retryCount = 0,
  ): Promise<unknown> {
    // Capture callIndex before any counter increment or pre-execution exit.
    // Pre-execution exits (budget-blocked, invalid slug, connect failure) use null
    // so the UNIQUE (run_id, call_index) constraint is not triggered.
    const callIndex = ctx.mcpCallCount ?? 0;

    // Budget check — pre-execution exit
    const callCount = ctx.mcpCallCount ?? 0;
    if (callCount >= MAX_MCP_CALLS_PER_RUN) {
      const slugParts = toolSlug.split('.');
      this.writeInvocation({
        ctx,
        serverSlug: slugParts[1] ?? '__unknown__',
        toolName: slugParts.slice(2).join('.') || '__unknown__',
        gateLevel: null,
        status: 'budget_blocked',
        durationMs: 0,
        isRetry: false,
        callIndex: null,
      });
      return { error: `MCP tool call limit reached (${MAX_MCP_CALLS_PER_RUN}/${MAX_MCP_CALLS_PER_RUN}). Use internal skills or request a budget increase.` };
    }

    // Parse slug: mcp.gmail.send_email → serverSlug=gmail, toolName=send_email
    const parts = toolSlug.split('.');
    if (parts.length < 3 || parts[0] !== 'mcp') {
      this.writeInvocation({
        ctx,
        serverSlug: '__unknown__',
        toolName: '__unknown__',
        gateLevel: null,
        status: 'error',
        failureReason: 'pre_execution_failure',
        durationMs: 0,
        isRetry: false,
        callIndex: null,
      });
      return { error: `Invalid MCP tool slug: ${toolSlug}` };
    }
    const serverSlug = parts[1];
    const toolName = parts.slice(2).join('.');

    // Lazy connect if needed — pre-execution exit on failure
    if (!clients.has(serverSlug) && lazyRegistry.has(serverSlug)) {
      const config = lazyRegistry.get(serverSlug)!;
      try {
        const instance = await this._connectSingleServer(config, ctx);
        if (instance) {
          clients.set(serverSlug, instance);
          lazyRegistry.delete(serverSlug);
        }
      } catch (err) {
        logger.error('mcp.lazy_connect_failed', { serverSlug, error: err instanceof Error ? err.message : String(err) });
        this.writeInvocation({
          ctx, serverSlug, toolName, gateLevel: null,
          status: 'error', failureReason: 'process_crash',
          durationMs: 0, isRetry: false, callIndex: null,
        });
        return { error: `Failed to connect to ${serverSlug} MCP server` };
      }
    }

    const instance = clients.get(serverSlug);
    if (!instance) {
      this.writeInvocation({
        ctx, serverSlug, toolName, gateLevel: null,
        status: 'error', failureReason: 'pre_execution_failure',
        durationMs: 0, isRetry: false, callIndex: null,
      });
      return { error: `MCP server "${serverSlug}" not connected` };
    }

    // Increment call count (execution path only — not incremented for pre-execution exits)
    if (ctx.mcpCallCount !== undefined) ctx.mcpCallCount++;
    else ctx.mcpCallCount = 1;

    // Resolve tool annotations for accurate gate-level recording.
    // Annotation-driven escalation (destructiveHint) is part of resolveGateLevel() — passing
    // undefined here would silently record the wrong gate level for destructive tools.
    const toolAnnotations = instance.tools.find((t) => t.name === toolName)?.annotations;

    // Variables declared before try so finally can access them in all paths.
    const callStart = Date.now();
    // eslint-disable-next-line no-useless-assignment
    let status: 'success' | 'error' | 'timeout' | 'budget_blocked' = 'error'; // safe default for finally
    let failureReason: 'timeout' | 'process_crash' | 'invalid_response' | 'auth_error' | 'rate_limited' | 'unknown' | undefined;
    let responseSizeBytes: number | undefined;
    let wasTruncated = false;
    // eslint-disable-next-line no-useless-assignment
    let durationMs = 0; // safe default for finally
    // Set to true in the retry branch so finally skips the write (catch already wrote it)
    let wroteInCatch = false;

    try {
      const result = await withTimeout(
        instance.client.callTool({ name: toolName, arguments: args }),
        MCP_CALL_TIMEOUT_MS,
        `mcp.${serverSlug}.${toolName}`,
      );
      durationMs = Date.now() - callStart;

      const serialised = JSON.stringify(result);
      const byteLength = Buffer.byteLength(serialised, 'utf8');
      responseSizeBytes = byteLength;
      wasTruncated = byteLength > MAX_MCP_RESPONSE_SIZE;
      status = 'success';

      if (wasTruncated) {
        logger.warn('mcp.output_truncated', { serverSlug, toolName, sizeBytes: byteLength, durationMs });
        return serialised.slice(0, MAX_MCP_RESPONSE_SIZE) + '\n[... response truncated at 100KB]';
      }

      logger.info('mcp.call.success', { serverSlug, toolName, durationMs, responseSizeBytes: byteLength });
      return result;
    } catch (err) {
      durationMs = Date.now() - callStart;
      const classified = classifyMcpError(err);
      status = classified.reason === 'timeout' ? 'timeout' : 'error';
      failureReason = classified.reason;

      logger.warn('mcp.call.error', {
        serverSlug, toolName, reason: classified.reason,
        retryable: classified.retryable, retryCount, durationMs,
      });

      if (classified.retryable && retryCount < 1) {
        // Write this attempt's row before recursing — the retry gets its own row via its own finally
        wroteInCatch = true;
        this.writeInvocation({
          ctx, serverSlug, toolName,
          mcpServerConfigId: instance.serverConfig.id,
          gateLevel: resolveGateLevel(instance.serverConfig, toolName, toolAnnotations),
          status, failureReason, durationMs, isRetry: false, callIndex,
        });

        // On process crash: reconnect before retrying
        if (classified.reason === 'process_crash') {
          try {
            const freshInstance = await this._connectSingleServer(instance.serverConfig, ctx);
            if (freshInstance) clients.set(serverSlug, freshInstance);
          } catch {
            // Reconnect failed — retry will fail again and write its own row
          }
        }
        return this.callTool(clients, lazyRegistry, toolSlug, args, ctx, retryCount + 1);
      }

      return { error: `MCP tool call failed: ${classified.message}`, failureReason: classified.reason };
    } finally {
      // Covers: success, truncated-success, and non-retryable errors.
      // Skipped for retryable paths where catch already wrote the row.
      if (!wroteInCatch) {
        this.writeInvocation({
          ctx, serverSlug, toolName,
          mcpServerConfigId: instance.serverConfig.id,
          gateLevel: resolveGateLevel(instance.serverConfig, toolName, toolAnnotations),
          status, failureReason, durationMs,
          responseSizeBytes, wasTruncated, isRetry: retryCount > 0, callIndex,
        });
      }
    }
  },

  /**
   * Gracefully disconnect all MCP clients for a run.
   */
  async disconnectAll(clients: Map<string, McpClientInstance>): Promise<void> {
    const results = await Promise.allSettled(
      Array.from(clients.values()).map(async ({ client, transport, serverSlug }) => {
        try {
          await withTimeout(client.close(), 5_000, `close:${serverSlug}`);
        } catch {
          // SDK close failed
        }
        // Force-kill stdio child process if still alive
        const proc = (transport as unknown as { _process?: { pid?: number; killed?: boolean; kill: (s: string) => void } })._process;
        if (proc?.pid && !proc.killed) {
          proc.kill('SIGTERM');
          setTimeout(() => {
            if (!proc.killed) proc.kill('SIGKILL');
          }, 2_000);
        }
      })
    );

    for (const r of results) {
      if (r.status === 'rejected') {
        logger.warn('mcp.client_cleanup_failed', { error: String(r.reason) });
      }
    }
  },

  /**
   * Test connectivity to a single MCP server config.
   */
  async testConnection(configId: string, organisationId: string): Promise<{
    success: boolean;
    toolCount: number;
    tools: Array<{ name: string; description?: string }>;
    error?: string;
  }> {
    const config = await mcpServerConfigService.getById(configId, organisationId);
    const ctx: McpRunContext = { runId: 'test', organisationId, agentId: 'test', subaccountId: null, isTestRun: true };

    try {
      const instance = await this._connectSingleServer(config, ctx);
      if (!instance) return { success: false, toolCount: 0, tools: [], error: 'Failed to connect' };

      const tools = instance.tools.map(t => ({ name: t.name, description: t.description }));
      await this.disconnectAll(new Map([[config.slug, instance]]));
      return { success: true, toolCount: tools.length, tools };
    } catch (err) {
      return { success: false, toolCount: 0, tools: [], error: err instanceof Error ? err.message : String(err) };
    }
  },

  /**
   * Refresh discovered tools for a server config.
   */
  async refreshTools(configId: string, organisationId: string): Promise<void> {
    const result = await this.testConnection(configId, organisationId);
    if (result.success) {
      const config = await mcpServerConfigService.getById(configId, organisationId);
      const hash = createHash('sha256').update(JSON.stringify(result.tools)).digest('hex');
      await mcpServerConfigService.updateDiscoveredTools(
        configId,
        result.tools as McpServerConfig['discoveredToolsJson'],
        hash,
        0,
      );
    }
  },

  // ── Internal helpers ─────────────────────────────────────────────────────

  async _connectSingleServer(config: McpServerConfig, ctx: McpRunContext): Promise<McpClientInstance | null> {
    // Circuit breaker check
    if (config.circuitOpenUntil && config.circuitOpenUntil > new Date()) {
      logger.info('mcp.circuit_open', { serverSlug: config.slug });
      return null;
    }

    // Command allowlist
    if (config.transport === 'stdio' && config.command) {
      if (!MCP_ALLOWED_COMMANDS.has(config.command)) {
        logger.error('mcp.command_blocked', { serverSlug: config.slug, command: config.command });
        return null;
      }
    }

    try {
      // Resolve credentials
      const creds = await resolveCredentials(config, ctx.subaccountId, ctx.organisationId);
      if (config.credentialProvider && !creds) {
        logger.info('mcp.no_credentials', { serverSlug: config.slug, subaccountId: ctx.subaccountId });
        return null;
      }

      // Build env — scoped, not process.env
      const env: Record<string, string> = { PATH: process.env.PATH ?? '' };
      if (config.envEncrypted) {
        try {
          const decrypted = connectionTokenService.decryptToken(config.envEncrypted);
          const parsed = JSON.parse(decrypted) as Record<string, string>;
          Object.assign(env, parsed);
        } catch {
          // Try as KEY=VALUE format
          const lines = connectionTokenService.decryptToken(config.envEncrypted).split('\n');
          for (const line of lines) {
            const idx = line.indexOf('=');
            if (idx > 0) env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
          }
        }
      }
      if (creds?.accessToken) env.ACCESS_TOKEN = creds.accessToken;
      if (creds?.refreshToken) env.REFRESH_TOKEN = creds.refreshToken;

      // Create transport and client
      const transport = new StdioClientTransport({
        command: config.command!,
        args: (config.args as string[]) ?? [],
        env,
      });

      const client = new Client({ name: 'automation-os', version: '1.0.0' });

      await withTimeout(client.connect(transport), MCP_CONNECT_TIMEOUT_MS, `connect:${config.slug}`);

      // Discover tools (or use warm cache)
      let tools: McpToolDefinition[];
      const cacheAge = config.lastToolsRefreshAt
        ? Date.now() - config.lastToolsRefreshAt.getTime()
        : Infinity;

      if (cacheAge < MCP_TOOLS_CACHE_TTL_MS && config.discoveredToolsJson?.length) {
        tools = config.discoveredToolsJson;
      } else {
        const listResult = await client.listTools();
        tools = (listResult.tools ?? []) as McpToolDefinition[];

        // Update cache in background
        const newHash = createHash('sha256').update(JSON.stringify(tools)).digest('hex');
        if (newHash !== config.discoveredToolsHash) {
          const validTools = tools.filter(t => validateMcpToolSchema(t).valid);
          const rejectedCount = tools.length - validTools.length;
          mcpServerConfigService.updateDiscoveredTools(
            config.id, validTools as McpServerConfig['discoveredToolsJson'], newHash, rejectedCount,
          ).catch(() => {}); // guard-ignore: no-silent-failures reason="fire-and-forget background cache update"
        }
      }

      // Validate and filter
      const validTools = tools.filter(t => {
        const check = validateMcpToolSchema(t);
        if (!check.valid) {
          logger.warn('mcp.tool_schema_rejected', { serverSlug: config.slug, tool: t.name, reason: check.reason });
        }
        return check.valid;
      });

      // Apply allowedTools / blockedTools
      const allowed = config.allowedTools ? new Set(config.allowedTools) : null;
      const blocked = config.blockedTools ? new Set(config.blockedTools) : new Set<string>();

      const filteredTools = validTools.filter(t => {
        if (blocked.has(t.name)) return false;
        if (allowed && !allowed.has(t.name)) return false;
        return true;
      });

      // Reset circuit breaker on success
      await mcpServerConfigService.resetCircuit(config.id);

      return {
        client,
        transport,
        serverSlug: config.slug,
        serverConfig: config,
        tools: filteredTools.map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
          annotations: t.annotations,
        })),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('mcp.connect_failed', { serverSlug: config.slug, error: message, runId: ctx.runId });

      // Circuit breaker
      await mcpServerConfigService.incrementFailure(config.id);
      if ((config.consecutiveFailures + 1) >= MCP_CIRCUIT_BREAKER_THRESHOLD) {
        await mcpServerConfigService.openCircuit(
          config.id,
          new Date(Date.now() + MCP_CIRCUIT_BREAKER_DURATION_MS),
        );
      }

      return null;
    }
  },

  _toAnthropicTools(
    tools: Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }>,
    serverSlug: string,
  ): AnthropicTool[] {
    return tools.map(t => ({
      name: `mcp.${serverSlug}.${t.name}`,
      description: `[External: ${serverSlug}] ${t.description ?? ''}`.trim(),
      input_schema: t.inputSchema as AnthropicTool['input_schema'],
    }));
  },
};
