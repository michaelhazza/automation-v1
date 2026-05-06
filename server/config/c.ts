/**
 * Canonical system-agent registry — compile-time mirror of system_agents DB rows.
 *
 * The DB seed (migrations/0256_system_agents_human_names.sql) is authoritative.
 * This file mirrors those values so static UI references and skill registrations
 * agree with the DB at compile time. When renaming an agent:
 *   1. Add/update the migration SQL.
 *   2. Update this file to match.
 *
 * Internal-only agents (orchestrator, heads) are listed but NOT renamed.
 * Subaccount-facing agents have human-style names + explicit agent_role.
 */

export interface SystemAgentEntry {
  slug: string;
  name: string;
  agentRole: 'Specialist' | 'Worker' | 'Orchestrator' | 'Head' | null;
  executionScope: 'subaccount' | 'org';
}

/**
 * Subaccount-facing agents — have human-style names after migration 0256.
 * These are the "employee" templates shown to subaccount operators.
 */
export const SUBACCOUNT_AGENTS: SystemAgentEntry[] = [
  { slug: 'business-analyst',       name: 'Sarah',   agentRole: 'Specialist', executionScope: 'subaccount' },
  { slug: 'crm-pipeline-agent',     name: 'Johnny',  agentRole: 'Worker',     executionScope: 'subaccount' },
  { slug: 'client-reporting-agent', name: 'Helena',  agentRole: 'Specialist', executionScope: 'subaccount' },
  { slug: 'finance-agent',          name: 'Patel',   agentRole: 'Specialist', executionScope: 'subaccount' },
  { slug: 'email-outreach-agent',   name: 'Riley',   agentRole: 'Worker',     executionScope: 'subaccount' },
  { slug: 'sdr-agent',              name: 'Dana',    agentRole: 'Worker',     executionScope: 'subaccount' },
];

/**
 * Org-level / internal agents — technical names retained.
 */
export const ORG_AGENTS: SystemAgentEntry[] = [
  { slug: 'orchestrator',                name: 'Chief Operating Officer', agentRole: 'Orchestrator', executionScope: 'org' },
  { slug: 'head-of-client-services',     name: 'Head of Client Services', agentRole: 'Head', executionScope: 'org' },
  { slug: 'head-of-commercial',          name: 'Head of Commercial',      agentRole: 'Head', executionScope: 'org' },
  { slug: 'head-of-growth',              name: 'Head of Growth',          agentRole: 'Head', executionScope: 'org' },
  { slug: 'head-of-product-engineering', name: 'Head of Product Engineering', agentRole: 'Head', executionScope: 'org' },
];

export const ALL_SYSTEM_AGENTS: SystemAgentEntry[] = [...SUBACCOUNT_AGENTS, ...ORG_AGENTS];

export const SYSTEM_AGENT_BY_SLUG = new Map(ALL_SYSTEM_AGENTS.map((a) => [a.slug, a]));
