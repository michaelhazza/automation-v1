import { Router } from 'express';
import multer from 'multer';
import { authenticate, requireSystemAdmin, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { systemAgentService } from '../services/systemAgentService.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ─── CSV helpers ──────────────────────────────────────────────────────────────

const CSV_COLS = [
  'slug', 'name', 'description', 'icon', 'masterPrompt',
  'modelProvider', 'modelId', 'temperature', 'maxTokens',
  'defaultSystemSkillSlugs', 'defaultOrgSkillSlugs',
  'defaultTokenBudget', 'defaultMaxToolCalls',
  'executionMode', 'isPublished', 'status', 'defaultScheduleCron',
];

function csvEscape(val: string): string {
  if (/[",\r\n]/.test(val)) return '"' + val.replace(/"/g, '""') + '"';
  return val;
}

function toCsvRow(fields: string[]): string {
  return fields.map(csvEscape).join(',');
}

/** Minimal RFC 4180 parser — handles quoted fields with embedded newlines and commas. */
function parseCsv(raw: string): Record<string, string>[] {
  const lines: string[][] = [];
  let field = '';
  let inQuote = false;
  let row: string[] = [];

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const next = raw[i + 1];

    if (inQuote) {
      if (ch === '"' && next === '"') { field += '"'; i++; }
      else if (ch === '"') { inQuote = false; }
      else { field += ch; }
    } else {
      if (ch === '"') { inQuote = true; }
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\r' && next === '\n') { row.push(field); field = ''; lines.push(row); row = []; i++; }
      else if (ch === '\n') { row.push(field); field = ''; lines.push(row); row = []; }
      else { field += ch; }
    }
  }
  if (field || row.length) { row.push(field); lines.push(row); }

  if (lines.length < 2) return [];
  const headers = lines[0];
  return lines.slice(1).filter(r => r.some(f => f.trim())).map(r => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h.trim()] = r[i] ?? ''; });
    return obj;
  });
}

// ─── System Admin: System Agent CRUD ──────────────────────────────────────────

router.get('/api/system/agents', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const agents = await systemAgentService.listAgents();
  res.json(agents);
}));

// Export must come before /:id to avoid being matched as an id
router.get('/api/system/agents/export', authenticate, requireSystemAdmin, asyncHandler(async (_req, res) => {
  const agents = await systemAgentService.listAgents();

  const rows = [toCsvRow(CSV_COLS)];
  for (const a of agents) {
    rows.push(toCsvRow([
      a.slug ?? '',
      a.name ?? '',
      a.description ?? '',
      a.icon ?? '',
      a.masterPrompt ?? '',
      a.modelProvider ?? 'anthropic',
      a.modelId ?? 'claude-sonnet-4-6',
      String(a.temperature ?? 0.7),
      String(a.maxTokens ?? 4096),
      JSON.stringify(a.defaultSystemSkillSlugs ?? []),
      JSON.stringify(a.defaultOrgSkillSlugs ?? []),
      String(a.defaultTokenBudget ?? 30000),
      String(a.defaultMaxToolCalls ?? 20),
      a.executionMode ?? 'api',
      String(a.isPublished ?? false),
      a.status ?? 'draft',
      a.defaultScheduleCron ?? '',
    ]));
  }

  const csv = rows.join('\r\n') + '\r\n';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="system-agents.csv"');
  res.send(csv);
}));

router.post('/api/system/agents/import', authenticate, requireSystemAdmin, upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded. Send a CSV file in the "file" field.' });
    return;
  }

  const raw = req.file.buffer.toString('utf-8');
  const rows = parseCsv(raw);

  if (rows.length === 0) {
    res.status(400).json({ error: 'CSV is empty or has no data rows.' });
    return;
  }

  const results = { created: 0, updated: 0, errors: [] as string[] };

  for (const row of rows) {
    const slug = row.slug?.trim();
    if (!slug) { results.errors.push('Row skipped: missing slug'); continue; }
    if (!row.masterPrompt?.trim()) { results.errors.push(`Row skipped (slug: ${slug}): missing masterPrompt`); continue; }

    let defaultSystemSkillSlugs: string[] = [];
    let defaultOrgSkillSlugs: string[] = [];
    try { defaultSystemSkillSlugs = JSON.parse(row.defaultSystemSkillSlugs || '[]'); } catch { /* leave empty */ }
    try { defaultOrgSkillSlugs = JSON.parse(row.defaultOrgSkillSlugs || '[]'); } catch { /* leave empty */ }

    const values = {
      slug,
      name: row.name?.trim() || slug,
      description: row.description || null,
      icon: row.icon || null,
      masterPrompt: row.masterPrompt,
      modelProvider: row.modelProvider || 'anthropic',
      modelId: row.modelId || 'claude-sonnet-4-6',
      temperature: parseFloat(row.temperature) || 0.7,
      maxTokens: parseInt(row.maxTokens, 10) || 4096,
      defaultSystemSkillSlugs,
      defaultOrgSkillSlugs,
      defaultTokenBudget: parseInt(row.defaultTokenBudget, 10) || 30000,
      defaultMaxToolCalls: parseInt(row.defaultMaxToolCalls, 10) || 20,
      executionMode: (row.executionMode as 'api' | 'headless') || 'api',
      isPublished: row.isPublished?.toLowerCase() === 'true',
      status: (row.status as 'draft' | 'active' | 'inactive') || 'draft',
      defaultScheduleCron: row.defaultScheduleCron || null,
    };

    try {
      const result = await systemAgentService.upsertBySlug(values);
      if (result.created) results.created++; else results.updated++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.errors.push(`Error on slug "${slug}": ${msg}`);
    }
  }

  res.json({ message: `Import complete. Created: ${results.created}, Updated: ${results.updated}`, ...results });
}));

router.get('/api/system/agents/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const agent = await systemAgentService.getAgent(req.params.id);
  const installCount = await systemAgentService.getInstallCount(req.params.id);
  res.json({ ...agent, installCount });
}));

router.post('/api/system/agents', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const { name, masterPrompt } = req.body;
  if (!name || !masterPrompt) {
    res.status(400).json({ error: 'name and masterPrompt are required' });
    return;
  }
  const agent = await systemAgentService.createAgent(req.body);
  res.status(201).json(agent);
}));

router.patch('/api/system/agents/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const agent = await systemAgentService.updateAgent(req.params.id, req.body);
  res.json(agent);
}));

router.delete('/api/system/agents/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  await systemAgentService.deleteAgent(req.params.id);
  res.json({ message: 'System agent deleted' });
}));

router.post('/api/system/agents/:id/publish', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const agent = await systemAgentService.publishAgent(req.params.id);
  res.json(agent);
}));

router.post('/api/system/agents/:id/unpublish', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const agent = await systemAgentService.unpublishAgent(req.params.id);
  res.json(agent);
}));

// ─── Org Admin: Browse & install system agents ───────────────────────────────

router.get('/api/system-agents', authenticate, asyncHandler(async (req, res) => {
  const agents = await systemAgentService.listAgents({ publishedOnly: true });
  const redacted = agents.map(a => ({
    id: a.id,
    name: a.name,
    slug: a.slug,
    description: a.description,
    icon: a.icon,
    modelProvider: a.modelProvider,
    modelId: a.modelId,
    defaultOrgSkillSlugs: a.defaultOrgSkillSlugs,
    allowModelOverride: a.allowModelOverride,
    status: a.status,
    version: a.version,
  }));
  res.json(redacted);
}));

router.post('/api/system-agents/:id/install', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_CREATE), asyncHandler(async (req, res) => {
  const agent = await systemAgentService.installToOrg(req.params.id, req.orgId!);
  res.status(201).json(agent);
}));

export default router;
