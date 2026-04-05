import { Router, NextFunction } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { mcpServerConfigService } from '../services/mcpServerConfigService.js';
import { mcpClientManager } from '../services/mcpClientManager.js';
import { MCP_PRESETS, MCP_PRESET_CATEGORY_LABELS } from '../config/mcpPresets.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

// ── List org MCP servers ─────────────────────────────────────────────────

router.get('/api/mcp-servers', authenticate, requireOrgPermission(ORG_PERMISSIONS.MCP_SERVERS_VIEW), asyncHandler(async (req, res, _next: NextFunction) => {
  const configs = await mcpServerConfigService.list(req.orgId!);
  res.json(configs);
}));

// ── Get single MCP server ────────────────────────────────────────────────

router.get('/api/mcp-servers/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.MCP_SERVERS_VIEW), asyncHandler(async (req, res, _next: NextFunction) => {
  const config = await mcpServerConfigService.getById(req.params.id, req.orgId!);
  res.json(config);
}));

// ── Create MCP server (from preset) ──────────────────────────────────────

router.post('/api/mcp-servers', authenticate, requireOrgPermission(ORG_PERMISSIONS.MCP_SERVERS_MANAGE), asyncHandler(async (req, res, _next: NextFunction) => {
  const { presetSlug, envVars, defaultGateLevel } = req.body;

  if (!presetSlug) {
    return res.status(400).json({ message: 'presetSlug is required' });
  }

  const preset = MCP_PRESETS.find(p => p.slug === presetSlug);
  if (!preset) {
    return res.status(400).json({ message: `Unknown preset: ${presetSlug}` });
  }

  // Validate envVars format (KEY=VALUE lines)
  if (envVars) {
    const lines = String(envVars).split('\n').filter((l: string) => l.trim());
    const invalid = lines.filter((l: string) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(l.trim()));
    if (invalid.length > 0) {
      return res.status(400).json({ message: `Invalid env var format. Expected KEY=VALUE. Invalid lines: ${invalid.map((l: string) => l.trim().slice(0, 30)).join(', ')}` });
    }
  }

  const config = await mcpServerConfigService.create(req.orgId!, {
    presetSlug: preset.slug,
    name: preset.name,
    slug: preset.slug,
    description: preset.description,
    transport: preset.transport,
    command: preset.command,
    args: preset.args,
    credentialProvider: (preset.credentialProvider as McpServerConfigCredProvider) ?? null,
    defaultGateLevel: defaultGateLevel ?? preset.recommendedGateLevel,
    envEncrypted: envVars ?? null,
    status: 'active',
  });

  res.status(201).json(config);
}));

// Type helper for credential provider
type McpServerConfigCredProvider = 'gmail' | 'github' | 'hubspot' | 'slack' | 'ghl' | 'stripe' | 'teamwork' | 'custom' | null;

// ── Update MCP server ────────────────────────────────────────────────────

router.patch('/api/mcp-servers/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.MCP_SERVERS_MANAGE), asyncHandler(async (req, res, _next: NextFunction) => {
  const { envVars, defaultGateLevel, toolGateOverrides, status, allowedTools, blockedTools } = req.body;

  // Validate envVars format
  if (envVars) {
    const lines = String(envVars).split('\n').filter((l: string) => l.trim());
    const invalid = lines.filter((l: string) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(l.trim()));
    if (invalid.length > 0) {
      return res.status(400).json({ message: `Invalid env var format. Expected KEY=VALUE.` });
    }
  }

  const updates: Record<string, unknown> = {};

  if (envVars !== undefined) updates.envEncrypted = envVars;
  if (defaultGateLevel !== undefined) updates.defaultGateLevel = defaultGateLevel;
  if (toolGateOverrides !== undefined) updates.toolGateOverrides = toolGateOverrides;
  if (status !== undefined) updates.status = status;
  if (allowedTools !== undefined) updates.allowedTools = allowedTools;
  if (blockedTools !== undefined) updates.blockedTools = blockedTools;

  const config = await mcpServerConfigService.update(req.params.id, req.orgId!, updates);
  res.json(config);
}));

// ── Delete MCP server ────────────────────────────────────────────────────

router.delete('/api/mcp-servers/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.MCP_SERVERS_MANAGE), asyncHandler(async (req, res, _next: NextFunction) => {
  await mcpServerConfigService.delete(req.params.id, req.orgId!);
  res.status(204).end();
}));

// ── Test connection ──────────────────────────────────────────────────────

router.post('/api/mcp-servers/:id/test', authenticate, requireOrgPermission(ORG_PERMISSIONS.MCP_SERVERS_MANAGE), asyncHandler(async (req, res, _next: NextFunction) => {
  const result = await mcpClientManager.testConnection(req.params.id, req.orgId!);
  res.json(result);
}));

// ── Refresh tools ────────────────────────────────────────────────────────

router.post('/api/mcp-servers/:id/refresh-tools', authenticate, requireOrgPermission(ORG_PERMISSIONS.MCP_SERVERS_MANAGE), asyncHandler(async (req, res, _next: NextFunction) => {
  await mcpClientManager.refreshTools(req.params.id, req.orgId!);
  const config = await mcpServerConfigService.getById(req.params.id, req.orgId!);
  res.json({ toolCount: config.discoveredToolsJson?.length ?? 0 });
}));

// ── Agent links ──────────────────────────────────────────────────────────

router.get('/api/mcp-servers/:id/agent-links', authenticate, requireOrgPermission(ORG_PERMISSIONS.MCP_SERVERS_VIEW), asyncHandler(async (req, res, _next: NextFunction) => {
  const links = await mcpServerConfigService.listAgentLinks(req.params.id);
  res.json(links);
}));

router.post('/api/mcp-servers/:id/agent-links', authenticate, requireOrgPermission(ORG_PERMISSIONS.MCP_SERVERS_MANAGE), asyncHandler(async (req, res, _next: NextFunction) => {
  const { agentId, gateOverride } = req.body;
  if (!agentId) return res.status(400).json({ message: 'agentId is required' });
  const link = await mcpServerConfigService.createAgentLink(req.params.id, agentId, gateOverride);
  res.status(201).json(link);
}));

router.delete('/api/mcp-servers/:id/agent-links/:linkId', authenticate, requireOrgPermission(ORG_PERMISSIONS.MCP_SERVERS_MANAGE), asyncHandler(async (req, res, _next: NextFunction) => {
  await mcpServerConfigService.deleteAgentLink(req.params.linkId);
  res.status(204).end();
}));

// ── Presets catalogue ────────────────────────────────────────────────────

router.get('/api/mcp-presets', authenticate, asyncHandler(async (req, res, _next: NextFunction) => {
  const category = req.query.category as string | undefined;
  let presets = MCP_PRESETS;
  if (category) presets = presets.filter(p => p.category === category);

  // Check which presets are already added for this org
  const existing = await mcpServerConfigService.list(req.orgId!);
  const existingSlugs = new Set(existing.map(c => c.presetSlug));

  const result = presets.map(p => ({
    ...p,
    isAdded: existingSlugs.has(p.slug),
  }));

  res.json({ presets: result, categories: MCP_PRESET_CATEGORY_LABELS });
}));

export default router;
