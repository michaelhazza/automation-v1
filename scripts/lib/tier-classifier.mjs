/**
 * tier-classifier.mjs
 *
 * Chunk 1' — Honest Tier Categorisation
 *
 * Runs the with-org-tx analyser against the gate file list and classifies
 * each violation into Tier 0 / 1 / 1-blocked / 2 / 3 per the rules in
 * tasks/builds/wave-6-rls-residue-and-gate-fix/tier-categorisation-framework.md.
 *
 * Output: tasks/builds/wave-6-rls-residue-and-gate-fix/tier-categorisation.md
 *
 * Usage:
 *   node scripts/lib/tier-classifier.mjs
 */

import { enumerateGateFiles } from './gate-file-enumerator.mjs';
import { analyseWithOrgTxScope } from './with-org-tx-analyser.mjs';
import { writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../..');
const OUTPUT_PATH = path.join(
  REPO_ROOT,
  'tasks/builds/wave-6-rls-residue-and-gate-fix/tier-categorisation.md',
);

// ---------------------------------------------------------------------------
// RLS_PROTECTED_TABLE_NAMES — extracted inline (avoids TS import)
// ---------------------------------------------------------------------------
const RLS_PROTECTED_TABLE_NAMES = new Set([
  'tasks', 'actions', 'agent_runs', 'review_items', 'review_audit_records',
  'workspace_memories', 'llm_requests', 'llm_requests_archive', 'audit_events',
  'tool_call_security_events', 'org_subscriptions', 'reports', 'regression_cases',
  'agent_run_messages', 'agent_briefings', 'agent_beliefs',
  'subaccount_state_summaries', 'memory_blocks', 'scraping_selectors',
  'scraping_cache', 'memory_review_queue', 'trust_calibration_state',
  'drop_zone_upload_audit', 'onboarding_bundle_configs', 'agent_test_fixtures',
  'feature_requests', 'routing_outcomes', 'integration_ingestion_stats',
  'service_principals', 'teams', 'team_members', 'delegation_grants',
  'canonical_row_subaccount_scopes', 'canonical_accounts', 'canonical_contacts',
  'canonical_opportunities', 'canonical_conversations', 'canonical_revenue',
  'health_snapshots', 'anomaly_events', 'canonical_metrics',
  'canonical_metric_history', 'integration_connections',
  'canonical_subaccount_mutations', 'canonical_conversation_providers',
  'canonical_workflow_definitions', 'canonical_tag_definitions',
  'canonical_custom_field_definitions', 'canonical_contact_sources',
  'client_pulse_signal_observations', 'subaccount_tier_history',
  'client_pulse_health_snapshots', 'client_pulse_churn_assessments',
  'integration_fingerprints', 'integration_detections',
  'integration_unclassified_signals', 'agent_execution_events',
  'agent_run_prompts', 'agent_run_llm_payloads', 'fast_path_decisions',
  'conversations', 'conversation_messages', 'reference_documents',
  'reference_document_versions', 'document_bundles', 'document_bundle_members',
  'document_bundle_attachments', 'bundle_resolution_snapshots',
  'model_tier_budget_policies', 'bundle_suggestion_dismissals',
  'delegation_outcomes', 'skill_idempotency_keys', 'account_overrides',
  'action_events', 'action_resume_events', 'agent_conversations',
  'agent_prompt_revisions', 'agent_triggers', 'agents', 'board_configs',
  'executions', 'feedback_votes', 'goals', 'mcp_server_configs',
  'mcp_tool_invocations', 'config_backups', 'config_history',
  'connector_configs', 'geo_audits', 'hierarchy_templates', 'iee_artifacts',
  'iee_runs', 'iee_steps', 'intervention_outcomes', 'org_agent_configs',
  'org_budgets', 'org_compute_budgets', 'org_margin_configs', 'org_memories',
  'org_memory_entries', 'org_user_roles', 'organisation_secrets',
  'page_projects', 'permission_sets', 'workflow_templates', 'policy_rules',
  'portal_briefs', 'automation_connection_mappings', 'processed_resources',
  'projects', 'scheduled_tasks', 'skill_analyzer_jobs', 'skills',
  'slack_conversations', 'subaccount_agents', 'subaccount_onboarding_state',
  'subaccount_tags', 'subaccounts', 'task_activities', 'task_deliverables',
  'task_attachments', 'automation_categories', 'users',
  'webhook_adapter_configs', 'workspace_entities', 'workspace_health_findings',
  'workspace_memory_entries', 'workspace_actors', 'workspace_identities',
  'workspace_messages', 'workspace_calendar_events', 'workflow_engines',
  'automation_engines', 'workflow_runs', 'flow_runs', 'automations',
  'canonical_flow_definitions', 'document_cache', 'document_fetch_events',
  'conversation_thread_context', 'agent_recommendations',
  'connector_location_tokens', 'workflow_step_gates', 'workflow_drafts',
  'spending_budgets', 'spending_policies', 'agent_charges',
  'subaccount_approval_channels', 'org_approval_channels',
  'org_subaccount_channel_grants', 'spending_budget_approvers', 'task_events',
  'cost_aggregates', 'security_audit_events', 'subaccount_baselines',
  'subaccount_baseline_metrics', 'reference_document_chunks',
  'reference_document_data_sources', 'document_promotion_audit',
  'runtime_check_results', 'scorecards', 'agent_scorecard_attachments',
  'scorecard_judgements', 'bench_runs', 'bench_results', 'agent_observations',
  'iee_sessions', 'agent_presence_projections', 'agent_working_time_rollups',
  'agent_working_time_event_ledger', 'canonical_inboxes',
  'canonical_support_agents', 'canonical_tickets', 'canonical_ticket_messages',
  'canonical_ticket_drafts', 'action_attempts', 'run_artifacts',
  'support_eval_runs', 'webhook_replay_nonces', 'operator_session_consents',
  'operator_session_consent_events', 'operator_runs', 'operator_task_profiles',
  'subaccount_operator_settings', 'sandbox_executions', 'sandbox_artefacts',
  'sandbox_telemetry_events', 'sandbox_egress_audit', 'sandbox_logs',
  'voice_profiles', 'ea_drafts', 'external_trigger_dedup',
  'memory_block_version_sources', 'iee_browser_session_profiles',
  'subaccount_iee_browser_settings', 'browser_warm_sessions',
  'operator_run_files', 'skill_analyzer_results', 'agent_execution_log_edits',
]);

// WF1 FK-scoped tables — NOT in RLS_PROTECTED_TABLES by design
const WF1_FK_SCOPED_TABLES = new Set([
  'workflow_step_runs',
  'workflow_step_reviews',
  'workflow_studio_sessions',
  'workflow_run_event_sequences',
  'flow_step_outputs',
]);

// ---------------------------------------------------------------------------
// Tier 2 file-level patterns
// ---------------------------------------------------------------------------
const TIER2_JOB_NAME_PATTERNS = [
  'Job', 'job', 'Prune', 'prune', 'Cleanup', 'cleanup', 'Rollup', 'rollup',
  'Maintenance', 'maintenance', 'Archive', 'archive', 'Refresh', 'refresh',
  'Reconciliation', 'reconciliation', 'Sync', 'sync',
];

const TIER2_FILE_KEYWORDS = [
  'adminDbConnection', 'Admin', 'admin', 'crossOrg', 'crossTenant', 'allOrgs',
];

// Known Tier 2 service files (all callsites Tier 2)
const TIER2_KNOWN_SERVICE_FILES = new Set([
  'server/services/agentRecommendationsService.ts',
]);

// Tier 2 function-level patterns
const TIER2_FUNCTION_PATTERNS = [
  'admin', 'Admin', 'system', 'System', 'global', 'Global',
  'maintenance', 'pruneAll', 'archiveAll', 'rollup', 'Rollup',
  'aggregate', 'Aggregate',
];

// ---------------------------------------------------------------------------
// Domain section assignment
// ---------------------------------------------------------------------------
const DOMAIN_SECTIONS = [
  {
    name: 'agent-execution residue',
    keywords: ['agentExecution', 'agentRun', 'agentSchedule', 'agentDelegation', 'agentBrief', 'agentConversation'],
  },
  {
    name: 'skill-execution residue',
    keywords: ['skillExe', 'skillAnalyzer', 'skillRegistry', 'skillVersion', 'SkillExecutor', 'SkillAnalyzer'],
  },
  {
    name: 'workflow residue',
    keywords: ['workflow', 'Workflow', 'playbook', 'Playbook'],
  },
  {
    name: 'billing residue',
    keywords: ['billing', 'Billing', 'cost', 'Cost', 'spend', 'Spend', 'subscription', 'Subscription'],
  },
  {
    name: 'personal-assistant residue',
    keywords: ['personal', 'Personal', 'thread', 'Thread', 'eaDraft', 'EaDraft', 'voice', 'Voice', 'externalTrigger', 'ExternalTrigger'],
  },
  {
    name: 'sandbox residue',
    keywords: ['sandbox', 'Sandbox', 'iee', 'IEE', 'browser', 'Browser'],
  },
  {
    name: 'integration-services residue',
    keywords: ['connector', 'Connector', 'integration', 'Integration', 'ghl', 'GHL', 'crm', 'CRM', 'connectionToken', 'ConnectionToken', 'canonicalAccount'],
  },
];

function assignDomain(filePath) {
  const norm = filePath.replace(/\\/g, '/');
  const basename = path.basename(norm, '.ts');

  // Directory-level overrides first
  // Note: analyser returns relative paths like 'server/jobs/...' (no leading slash)
  if (norm.includes('server/jobs/')) return 'jobs residue';
  if (norm.includes('server/lib/')) return 'lib residue';
  if (norm.includes('server/adapters/')) return 'adapters residue';

  // Keyword matching on basename
  for (const section of DOMAIN_SECTIONS) {
    for (const kw of section.keywords) {
      if (basename.includes(kw)) return section.name;
    }
  }

  // Fallback: use directory
  if (norm.includes('server/services/')) return 'agent-execution residue'; // catch-all for services
  return 'lib residue';
}

function extractMethodFromMessage(message) {
  const m = /^db\.(\w+)\(\)/.exec(message);
  return m ? m[1] : 'select';
}

function extractFunctionFromMessage(message) {
  const m = /in '([^']+)'/.exec(message);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Tier classification
// ---------------------------------------------------------------------------
function classifyTier(violation, sourceLines) {
  const { file, message } = violation;
  const norm = file.replace(/\\/g, '/');
  const basename = path.basename(norm);

  // Tier 0 — Pure helper
  if (basename.endsWith('Pure.ts') || basename.endsWith('pure.ts')) {
    return 'Tier 0';
  }

  // Tier 3 — Migration/seed/CI path
  if (
    norm.includes('migrations/') ||
    norm.includes('seeds/') ||
    norm.includes('seed/') ||
    // scripts/ would be in scope only if it slipped through the gate includes
    norm.includes('scripts/')
  ) {
    return 'Tier 3';
  }

  // Tier 2 checks — file-level
  // Jobs directory with job-related name patterns
  if (norm.includes('server/jobs/')) {
    const hasJobNamePattern = TIER2_JOB_NAME_PATTERNS.some(pat => basename.includes(pat));
    if (hasJobNamePattern) return 'Tier 2';
  }

  // File-level Tier 2 indicators (admin/cross-org keywords in filename)
  const filenameTier2 = TIER2_FILE_KEYWORDS.some(kw => basename.includes(kw));
  if (filenameTier2) return 'Tier 2';

  // Known Tier 2 service files
  if (TIER2_KNOWN_SERVICE_FILES.has(norm)) return 'Tier 2';

  // Check if file imports withAdminConnection — callsites without it are new residue
  // also Tier 2 by convention
  const sourceText = sourceLines ? sourceLines.join('\n') : '';
  if (sourceText.includes('withAdminConnection')) {
    // This file already uses withAdminConnection — any unconverted callsites are also Tier 2
    return 'Tier 2';
  }

  // Tier 2 — function-level patterns
  const enclosingFn = extractFunctionFromMessage(message);
  if (enclosingFn) {
    const fnTier2 = TIER2_FUNCTION_PATTERNS.some(pat => enclosingFn.includes(pat));
    if (fnTier2) return 'Tier 2';
  }

  // Tier 1 — default for services and lib
  if (norm.includes('server/services/') || norm.includes('server/lib/') || norm.includes('server/adapters/') || norm.includes('server/jobs/')) {
    // Tier 1-blocked if enclosing function is not identifiable and in lib/adapters
    if (!enclosingFn && (norm.includes('server/lib/') || norm.includes('server/adapters/'))) {
      return 'Tier 1-blocked';
    }
    return 'Tier 1';
  }

  return 'Tier 1';
}

// ---------------------------------------------------------------------------
// Upstream entrypoint lookup
// ---------------------------------------------------------------------------
function getUpstreamEntrypoint(file, enclosingFn) {
  const norm = file.replace(/\\/g, '/');
  const basename = path.basename(norm, '.ts');

  if (norm.includes('server/jobs/')) {
    // Infer queue name from file basename
    const queueName = basename
      .replace(/([A-Z])/g, (_, c, i) => (i > 0 ? '-' : '') + c.toLowerCase())
      .replace(/^-/, '');
    return `pg-boss worker: ${queueName}`;
  }

  if (norm.includes('agentExecution') || norm.includes('agentRun') || norm.includes('agentSchedule') || norm.includes('agentDelegation') || norm.includes('agentBrief') || norm.includes('agentConversation')) {
    return 'POST /api/agents/:id/run (via agentExecutionService)';
  }
  if (norm.includes('workflowAgentRunHook')) {
    return 'internal hook from agentExecutionService';
  }
  if (norm.includes('workflowEngine') || norm.includes('workflow') || norm.includes('Workflow') || norm.includes('playbook') || norm.includes('Playbook')) {
    return 'POST /api/workflows/:id/run (via workflowEngineService)';
  }
  if (norm.includes('skill') || norm.includes('Skill')) {
    return 'POST /api/agents/:id/run > skillExecutor';
  }
  if (norm.includes('personal') || norm.includes('Personal') || norm.includes('thread') || norm.includes('Thread') || norm.includes('eaDraft') || norm.includes('voice') || norm.includes('Voice') || norm.includes('externalTrigger')) {
    return 'POST /api/agents/:id/run (EA dispatch)';
  }
  if (norm.includes('billing') || norm.includes('Billing') || norm.includes('cost') || norm.includes('Cost')) {
    return 'POST /api/agents/:id/run (cost ledger hook)';
  }
  if (norm.includes('sandbox') || norm.includes('Sandbox') || norm.includes('iee') || norm.includes('IEE')) {
    return 'POST /api/agents/:id/run (sandbox dispatch)';
  }
  if (norm.includes('connector') || norm.includes('integration') || norm.includes('Integration')) {
    return 'POST /api/connections/:id/sync';
  }
  if (norm.includes('ghl') || norm.includes('GHL')) {
    return 'POST /api/integrations/ghl/webhook';
  }
  if (norm.includes('server/lib/')) {
    return `[varies — see function name: ${enclosingFn || 'unknown'}]`;
  }
  if (norm.includes('server/adapters/')) {
    return `[varies — see file name: ${path.basename(norm)}]`;
  }
  return '[varies — see function name]';
}

// ---------------------------------------------------------------------------
// Extract table from source text around the violation line
// ---------------------------------------------------------------------------
function extractTableFromSource(sourceLines, lineNo) {
  // Look in a window of ±3 lines around the violation
  const start = Math.max(0, lineNo - 4);
  const end = Math.min(sourceLines.length, lineNo + 2);
  const window = sourceLines.slice(start, end).join('\n');

  // Pattern: .from(tableName) or .from(schema.tableName)
  const fromMatch = /\.from\(\s*([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)\s*\)/.exec(window);
  if (fromMatch) {
    // Strip schema prefix if present (e.g. schema.tasks -> tasks)
    const raw = fromMatch[1];
    return raw.includes('.') ? raw.split('.').pop() : raw;
  }

  // Pattern: .into(tableName) for inserts
  const intoMatch = /\.into\(\s*([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)\s*\)/.exec(window);
  if (intoMatch) {
    const raw = intoMatch[1];
    return raw.includes('.') ? raw.split('.').pop() : raw;
  }

  // Pattern: db.update(tableName) or db.delete(tableName) etc.
  const methodMatch = /db\.\w+\(\s*([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)\s*\)/.exec(window);
  if (methodMatch) {
    const raw = methodMatch[1];
    return raw.includes('.') ? raw.split('.').pop() : raw;
  }

  return null;
}

// Extract the call expression snippet from source
function extractCallExpr(sourceLines, lineNo) {
  const lineIdx = lineNo - 1;
  if (lineIdx < 0 || lineIdx >= sourceLines.length) return 'db.select()...';
  const line = sourceLines[lineIdx].trim();
  // Truncate if too long
  return line.length > 80 ? line.substring(0, 77) + '...' : line;
}

// ---------------------------------------------------------------------------
// Load source lines for a file (cached)
// ---------------------------------------------------------------------------
const sourceCache = new Map();
function getSourceLines(absPath) {
  if (sourceCache.has(absPath)) return sourceCache.get(absPath);
  try {
    const text = readFileSync(absPath, 'utf8');
    const lines = text.split('\n');
    sourceCache.set(absPath, lines);
    return lines;
  } catch {
    sourceCache.set(absPath, []);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Escape markdown table cell
// ---------------------------------------------------------------------------
function cell(val) {
  if (val == null || val === '') return 'n/a';
  return String(val).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
console.error('[tier-classifier] Enumerating gate files...');

const files = enumerateGateFiles({
  root: REPO_ROOT,
  includes: [
    'server/services/**/*.ts',
    'server/jobs/**/*.ts',
    'server/lib/**/*.ts',
    'server/adapters/**/*.ts',
  ],
  excludes: ['**/__tests__/**', '**/*.test.ts', '**/*.integration.test.ts'],
});

console.error(`[tier-classifier] ${files.length} files enumerated. Running analyser...`);

const violations = analyseWithOrgTxScope(REPO_ROOT, files);

console.error(`[tier-classifier] ${violations.length} violations found. Classifying...`);

// Classify each violation
const classified = violations.map((v) => {
  const absPath = path.join(REPO_ROOT, v.file.replace(/\\/g, '/'));
  const sourceLines = getSourceLines(absPath);

  const tier = classifyTier(v, sourceLines);
  const method = extractMethodFromMessage(v.message);
  const enclosingFn = extractFunctionFromMessage(v.message);
  const tableName = extractTableFromSource(sourceLines, v.line);
  const drizzleName = tableName || '[unknown — see source]';
  // Convert likely Drizzle variable name to Postgres table name (camelCase to snake_case)
  const postgresName = drizzleName.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
  const inRls = WF1_FK_SCOPED_TABLES.has(postgresName)
    ? 'no'
    : RLS_PROTECTED_TABLE_NAMES.has(postgresName)
    ? 'yes'
    : RLS_PROTECTED_TABLE_NAMES.has(drizzleName)
    ? 'yes'
    : 'no';
  const callExpr = extractCallExpr(sourceLines, v.line);
  const domain = assignDomain(v.file);
  const upstreamEntrypoint =
    tier === 'Tier 1' ? getUpstreamEntrypoint(v.file, enclosingFn) : 'n/a';
  const bypassRationale =
    tier === 'Tier 2' ? 'admin/system/cross-tenant path — see ADR-0041 (Wave 5 Tier 2 convention)' : 'n/a';
  const requiredEntrypoint =
    tier === 'Tier 1-blocked' ? getUpstreamEntrypoint(v.file, enclosingFn) : 'n/a';

  return {
    file: v.file,
    line: v.line,
    message: v.message,
    method,
    enclosingFn,
    tableName: drizzleName,
    postgresName,
    inRls,
    callExpr,
    domain,
    tier,
    upstreamEntrypoint,
    bypassRationale,
    requiredEntrypoint,
    tenantKey: tier === 'Tier 2' ? 'n/a' : 'organisationId',
  };
});

// ---------------------------------------------------------------------------
// Group by domain
// ---------------------------------------------------------------------------
const DOMAIN_ORDER = [
  'agent-execution residue',
  'skill-execution residue',
  'workflow residue',
  'billing residue',
  'personal-assistant residue',
  'sandbox residue',
  'integration-services residue',
  'jobs residue',
  'lib residue',
  'adapters residue',
];

const grouped = {};
for (const d of DOMAIN_ORDER) grouped[d] = [];

for (const c of classified) {
  if (grouped[c.domain]) {
    grouped[c.domain].push(c);
  } else {
    grouped['lib residue'].push(c);
  }
}

// Sort within each domain by file then line
for (const d of DOMAIN_ORDER) {
  grouped[d].sort((a, b) => {
    if (a.file < b.file) return -1;
    if (a.file > b.file) return 1;
    return a.line - b.line;
  });
}

// ---------------------------------------------------------------------------
// Collect blocked entries
// ---------------------------------------------------------------------------
const blockedEntries = classified.filter((c) => c.tier === 'Tier 1-blocked');

// ---------------------------------------------------------------------------
// Grand totals
// ---------------------------------------------------------------------------
const tierCounts = { 'Tier 0': 0, 'Tier 1': 0, 'Tier 1-blocked': 0, 'Tier 2': 0, 'Tier 3': 0 };
for (const c of classified) {
  tierCounts[c.tier] = (tierCounts[c.tier] || 0) + 1;
}
const total = classified.length;

// ---------------------------------------------------------------------------
// Build markdown
// ---------------------------------------------------------------------------
const TABLE_HEADER = `| file:line | Call expression | Target table | In RLS_PROTECTED_TABLES? | Tenant key | Tier verdict | Upstream entrypoint (Tier 1 only) | Bypass rationale + ADR (Tier 2 only) | Required new entrypoint (Tier 1-blocked only) |`;
const TABLE_SEP = `|-----------|----------------|-------------|--------------------------|-----------|-------------|-----------------------------------|--------------------------------------|-----------------------------------------------|`;

function formatRow(c) {
  return `| ${cell(c.file + ':' + c.line)} | ${cell(c.callExpr)} | ${cell(c.postgresName)} | ${cell(c.inRls)} | ${cell(c.tenantKey)} | ${cell(c.tier)} | ${cell(c.upstreamEntrypoint)} | ${cell(c.bypassRationale)} | ${cell(c.requiredEntrypoint)} |`;
}

const lines = [];
lines.push(`# Tier Categorisation — wave-6-rls-residue-and-gate-fix`);
lines.push('');
lines.push(`**Total residue callsites:** ${total}`);
lines.push(`**Chunk 1' date:** 2026-05-17`);
lines.push(`**Generated by:** scripts/lib/tier-classifier.mjs`);
lines.push('');

for (const domain of DOMAIN_ORDER) {
  const rows = grouped[domain];
  if (rows.length === 0) continue;

  const t0 = rows.filter(r => r.tier === 'Tier 0').length;
  const t1 = rows.filter(r => r.tier === 'Tier 1').length;
  const t1b = rows.filter(r => r.tier === 'Tier 1-blocked').length;
  const t2 = rows.filter(r => r.tier === 'Tier 2').length;
  const t3 = rows.filter(r => r.tier === 'Tier 3').length;

  const summary = [
    t1 ? `${t1} Tier 1` : null,
    t2 ? `${t2} Tier 2` : null,
    t3 ? `${t3} Tier 3` : null,
    t0 ? `${t0} Tier 0` : null,
    t1b ? `${t1b} blocked` : null,
  ].filter(Boolean).join(', ');

  lines.push(`## ${domain} (${rows.length} rows: ${summary})`);
  lines.push('');
  lines.push(TABLE_HEADER);
  lines.push(TABLE_SEP);
  for (const row of rows) {
    lines.push(formatRow(row));
  }
  lines.push('');
}

lines.push('---');
lines.push('');
lines.push('## Blocked verdicts requiring operator review');
lines.push('');

if (blockedEntries.length === 0) {
  lines.push('_None — all callsites have a resolvable upstream entrypoint._');
  lines.push('');
} else {
  for (const b of blockedEntries) {
    lines.push(`### ${b.file}:${b.line}`);
    lines.push('');
    lines.push(`- **Call expression:** \`${b.callExpr}\``);
    lines.push(`- **Target table:** ${b.postgresName}`);
    lines.push(`- **Block reason:** enclosing function name not identifiable (anonymous/arrow function at top level of lib/adapters file)`);
    lines.push(`- **Attempted trace:** ${b.enclosingFn || '(none — top-level)'}`);
    lines.push(`- **Required new entrypoint:** expose via named function wrapping the db call, then wire through withOrgTx or getOrgScopedDb`);
    lines.push(`- **Suggested Chunk 13 action:** extract anonymous db call into a named function, trace callers, reclassify as Tier 1 or Tier 2`);
    lines.push('');
  }
}

lines.push('---');
lines.push('');
lines.push('## Grand Total');
lines.push('');
lines.push('| Tier | Count |');
lines.push('|------|-------|');
lines.push(`| Tier 0 (pure helper) | ${tierCounts['Tier 0']} |`);
lines.push(`| Tier 1 (migrate to getOrgScopedDb) | ${tierCounts['Tier 1']} |`);
lines.push(`| Tier 1-blocked (operator review) | ${tierCounts['Tier 1-blocked']} |`);
lines.push(`| Tier 2 (admin/cross-tenant) | ${tierCounts['Tier 2']} |`);
lines.push(`| Tier 3 (migration/seed/CI) | ${tierCounts['Tier 3']} |`);
lines.push(`| **Total** | **${total}** |`);
lines.push('');

const output = lines.join('\n');
writeFileSync(OUTPUT_PATH, output, 'utf8');

console.error(`[tier-classifier] Done. Written to ${OUTPUT_PATH}`);
console.error(`[tier-classifier] Total: ${total} rows`);
console.error(`[tier-classifier] Tier breakdown: Tier 0=${tierCounts['Tier 0']}, Tier 1=${tierCounts['Tier 1']}, Tier 1-blocked=${tierCounts['Tier 1-blocked']}, Tier 2=${tierCounts['Tier 2']}, Tier 3=${tierCounts['Tier 3']}`);
