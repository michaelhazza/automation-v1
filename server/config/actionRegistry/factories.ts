import { z } from 'zod';
import type { ActionDefinition, McpAnnotations, RetryPolicy } from './types.js';
import type { RuntimeCheckKind } from '../../../shared/types/runtimeCheck.js';

// ── Private retry-policy constants ───────────────────────────────────────────
// These are starting defaults extracted from the existing source. Every factory
// accepts an optional `retryPolicy` override so per-entry divergences compile.

const RETRY_NONE: RetryPolicy = {
  maxRetries: 0,
  strategy: 'none',
  retryOn: [],
  doNotRetryOn: [],
};

// Internal-state-write default. Source shows mixed shapes (db_error vs db_transient,
// maxRetries 1 or 2) — factories accept an explicit override for entries that diverge.
const RETRY_FIXED_DB: RetryPolicy = {
  maxRetries: 1,
  strategy: 'fixed',
  retryOn: ['db_error'],
  doNotRetryOn: ['validation_error'],
};

// Config-write default. Verified against config_update_agent, config_activate_agent, etc.
const RETRY_BACKOFF_NETWORK: RetryPolicy = {
  maxRetries: 2,
  strategy: 'exponential_backoff',
  retryOn: ['timeout', 'network_error'],
  doNotRetryOn: ['validation_error', 'auth_error'],
};

// External-write / customer-messaging default.
// Verified against crm.send_email, crm.send_sms, crm.fire_automation (maxRetries 2,
// retryOn timeout/network_error/rate_limit, doNotRetryOn validation_error/auth_error/...)
// Note: send_email uses ['timeout','network_error','rate_limit']/['validation_error','auth_error','recipient_not_found'].
// Factory sets the base shape; per-entry overrides handle additions like 'rate_limit'.
const RETRY_NETWORK_AGGRESSIVE: RetryPolicy = {
  maxRetries: 3,
  strategy: 'exponential_backoff',
  retryOn: ['timeout', 'network_error', '5xx'],
  doNotRetryOn: ['4xx', 'validation_error'],
};

// ── Private MCP annotation helpers ───────────────────────────────────────────

function createMcpRead(openWorldHint: boolean): { annotations: McpAnnotations } {
  return {
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint,
    },
  };
}

function createMcpWrite(
  overrides: Partial<McpAnnotations>,
): { annotations: McpAnnotations } {
  return {
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
      ...overrides,
    },
  };
}

// ── Private justification template ───────────────────────────────────────────

function templateVerifyNullJustification(verifyActionNoun: string): string {
  return `Review-gated ${verifyActionNoun}: HITL approval is the verification boundary; actionService wrapper has no comparable post-check shape`;
}

// ── 1. defineCanonicalRead ────────────────────────────────────────────────────

export interface CanonicalReadArgs {
  slug: string;
  description: string;
  topics?: string[];
  riskTier: ActionDefinition['riskTier'];
  payloadFields: string[];
  parameterSchema: z.ZodObject<z.ZodRawShape>;
  retryPolicy?: RetryPolicy;
  requiredIntegration?: ActionDefinition['requiredIntegration'];
}

export function defineCanonicalRead(args: CanonicalReadArgs): ActionDefinition {
  return {
    actionType: args.slug,
    description: args.description,
    actionCategory: 'worker',
    topics: args.topics,
    isExternal: false,
    readPath: 'canonical',
    defaultGateLevel: 'auto',
    riskTier: args.riskTier,
    createsBoardTask: false,
    payloadFields: args.payloadFields,
    parameterSchema: args.parameterSchema,
    retryPolicy: args.retryPolicy ?? RETRY_NONE,
    mcp: createMcpRead(false),
    idempotencyStrategy: 'read_only',
    ...(args.requiredIntegration !== undefined && { requiredIntegration: args.requiredIntegration }),
  };
}

// ── 2. defineInternalRead ─────────────────────────────────────────────────────

export interface InternalReadArgs {
  slug: string;
  description: string;
  topics?: string[];
  readPath: 'canonical' | 'none';
  riskTier: ActionDefinition['riskTier'];
  payloadFields: string[];
  parameterSchema: z.ZodObject<z.ZodRawShape>;
  retryPolicy?: RetryPolicy;
  isUniversal?: boolean;
}

export function defineInternalRead(args: InternalReadArgs): ActionDefinition {
  return {
    actionType: args.slug,
    description: args.description,
    actionCategory: 'worker',
    topics: args.topics,
    isExternal: false,
    readPath: args.readPath,
    defaultGateLevel: 'auto',
    riskTier: args.riskTier,
    createsBoardTask: false,
    payloadFields: args.payloadFields,
    parameterSchema: args.parameterSchema,
    retryPolicy: args.retryPolicy ?? RETRY_NONE,
    mcp: createMcpRead(false),
    idempotencyStrategy: 'read_only',
    ...(args.isUniversal !== undefined && { isUniversal: args.isUniversal }),
  };
}

// ── 3. defineExternalRead ─────────────────────────────────────────────────────

export interface ExternalReadArgs {
  slug: string;
  description: string;
  topics?: string[];
  riskTier: ActionDefinition['riskTier'];
  payloadFields: string[];
  parameterSchema: z.ZodObject<z.ZodRawShape>;
  liveFetchRationale: string;
  retryPolicy?: RetryPolicy;
  requiredIntegration?: ActionDefinition['requiredIntegration'];
}

export function defineExternalRead(args: ExternalReadArgs): ActionDefinition {
  return {
    actionType: args.slug,
    description: args.description,
    actionCategory: 'api',
    topics: args.topics,
    isExternal: true,
    readPath: 'liveFetch',
    liveFetchRationale: args.liveFetchRationale,
    defaultGateLevel: 'auto',
    riskTier: args.riskTier,
    createsBoardTask: false,
    payloadFields: args.payloadFields,
    parameterSchema: args.parameterSchema,
    retryPolicy: args.retryPolicy ?? RETRY_NONE,
    mcp: createMcpRead(true),
    idempotencyStrategy: 'read_only',
    ...(args.requiredIntegration !== undefined && { requiredIntegration: args.requiredIntegration }),
  };
}

// ── 4. defineInternalStateWrite ───────────────────────────────────────────────

export interface InternalStateWriteArgs {
  slug: string;
  description: string;
  topics?: string[];
  riskTier: ActionDefinition['riskTier'];
  defaultGateLevel?: 'auto' | 'review' | 'block';
  payloadFields: string[];
  parameterSchema: z.ZodObject<z.ZodRawShape>;
  retryPolicy?: RetryPolicy;
  idempotencyStrategy?: 'keyed_write' | 'state_based';
  mcp?: { annotations: McpAnnotations };
  createsBoardTask?: boolean;
  requiresCritiqueGate?: boolean;
}

export function defineInternalStateWrite(args: InternalStateWriteArgs): ActionDefinition {
  return {
    actionType: args.slug,
    description: args.description,
    actionCategory: 'worker',
    topics: args.topics,
    isExternal: false,
    readPath: 'none',
    defaultGateLevel: args.defaultGateLevel ?? 'auto',
    riskTier: args.riskTier,
    createsBoardTask: args.createsBoardTask ?? false,
    payloadFields: args.payloadFields,
    parameterSchema: args.parameterSchema,
    retryPolicy: args.retryPolicy ?? RETRY_FIXED_DB,
    mcp: args.mcp ?? createMcpWrite({}),
    idempotencyStrategy: args.idempotencyStrategy ?? 'state_based',
    ...(args.requiresCritiqueGate !== undefined && { requiresCritiqueGate: args.requiresCritiqueGate }),
  };
}

// ── 5. defineExternalWrite ────────────────────────────────────────────────────

export interface ExternalWriteArgs {
  slug: string;
  description: string;
  topics?: string[];
  riskTier: ActionDefinition['riskTier'];
  defaultGateLevel?: 'auto' | 'review' | 'block';
  payloadFields: string[];
  parameterSchema: z.ZodObject<z.ZodRawShape>;
  retryPolicy?: RetryPolicy;
  idempotencyStrategy?: 'keyed_write' | 'locked';
  mcp?: { annotations: McpAnnotations };
  requiredIntegration?: ActionDefinition['requiredIntegration'];
  integrationNotResumable?: true;
  createsBoardTask?: boolean;
  requiresCritiqueGate?: boolean;
}

export function defineExternalWrite(args: ExternalWriteArgs): ActionDefinition {
  return {
    actionType: args.slug,
    description: args.description,
    actionCategory: 'api',
    topics: args.topics,
    isExternal: true,
    readPath: 'none',
    defaultGateLevel: args.defaultGateLevel ?? 'review',
    riskTier: args.riskTier,
    createsBoardTask: args.createsBoardTask ?? false,
    payloadFields: args.payloadFields,
    parameterSchema: args.parameterSchema,
    retryPolicy: args.retryPolicy ?? RETRY_NETWORK_AGGRESSIVE,
    mcp: args.mcp ?? createMcpWrite({ openWorldHint: true }),
    idempotencyStrategy: args.idempotencyStrategy ?? 'keyed_write',
    ...(args.requiredIntegration !== undefined && { requiredIntegration: args.requiredIntegration }),
    ...(args.integrationNotResumable !== undefined && { integrationNotResumable: args.integrationNotResumable }),
    ...(args.requiresCritiqueGate !== undefined && { requiresCritiqueGate: args.requiresCritiqueGate }),
  };
}

// ── 6. defineCustomerMessagingWrite ──────────────────────────────────────────

export interface CustomerMessagingWriteArgs {
  slug: string;
  description: string;
  topics: string[];
  riskTier: ActionDefinition['riskTier'];
  actionCategory?: 'api' | 'worker';
  verifyActionNoun: string;
  payloadFields: string[];
  parameterSchema: z.ZodObject<z.ZodRawShape>;
  retryPolicy?: RetryPolicy;
  mcp?: { annotations: McpAnnotations };
  requiredIntegration?: ActionDefinition['requiredIntegration'];
  idempotencyStrategy?: 'keyed_write' | 'locked';
}

export function defineCustomerMessagingWrite(
  args: CustomerMessagingWriteArgs,
): ActionDefinition {
  return {
    actionType: args.slug,
    description: args.description,
    actionCategory: args.actionCategory ?? 'api',
    topics: args.topics,
    isExternal: true,
    readPath: 'none',
    defaultGateLevel: 'review',
    riskTier: args.riskTier,
    createsBoardTask: false,
    payloadFields: args.payloadFields,
    parameterSchema: args.parameterSchema,
    retryPolicy: args.retryPolicy ?? RETRY_NETWORK_AGGRESSIVE,
    mcp: args.mcp ?? createMcpWrite({ openWorldHint: true }),
    idempotencyStrategy: args.idempotencyStrategy ?? 'keyed_write',
    ...(args.requiredIntegration !== undefined && { requiredIntegration: args.requiredIntegration }),
    verify: null,
    verifyNullJustification: templateVerifyNullJustification(args.verifyActionNoun),
    reversible: false,
    blastRadius: 'external',
  };
}

// ── 7. defineConfigWrite ─────────────────────────────────────────────────────

export interface ConfigWriteArgs {
  slug: string;
  description: string;
  parameterSchema: z.ZodObject<z.ZodRawShape>;
  riskTier?: 2 | 3;
}

export function defineConfigWrite(args: ConfigWriteArgs): ActionDefinition {
  return {
    actionType: args.slug,
    description: args.description,
    actionCategory: 'api',
    topics: ['configuration'],
    isExternal: false,
    readPath: 'none',
    defaultGateLevel: 'review',
    riskTier: args.riskTier ?? 3,
    createsBoardTask: false,
    payloadFields: [],
    parameterSchema: args.parameterSchema,
    retryPolicy: RETRY_BACKOFF_NETWORK,
    idempotencyStrategy: 'keyed_write',
  };
}

// ── 8. defineSpendWrite ───────────────────────────────────────────────────────

export interface SpendWriteArgs {
  slug: string;
  description: string;
  payloadFields: string[];
  parameterSchema: z.ZodObject<z.ZodRawShape>;
  executionPath: 'main_app_stripe' | 'worker_hosted_form';
  verify?: RuntimeCheckKind | null;
  verifyActionNoun?: string;
}

export function defineSpendWrite(args: SpendWriteArgs): ActionDefinition {
  const defaultVerify: RuntimeCheckKind = {
    kind: 'external_returns',
    provider: 'stripe',
    expectedField: 'id',
  };

  // 'verify' in args distinguishes "caller explicitly passed verify: null"
  // (preserve null + use the templated verifyNullJustification — IIFE skips because
  // verifyNullJustification is set inline) from "caller omitted verify"
  // (use defaultVerify and leave verifyNullJustification undefined). Do NOT collapse
  // to args.verify ?? defaultVerify — that would replace explicit-null with default
  // and re-trigger the IIFE's verify-null fallback path on entries like pay_invoice.
  const hasExplicitVerify = 'verify' in args;

  return {
    actionType: args.slug,
    description: args.description,
    actionCategory: 'api',
    isExternal: true,
    readPath: 'none',
    defaultGateLevel: 'review',
    riskTier: 6,
    createsBoardTask: false,
    payloadFields: args.payloadFields,
    parameterSchema: args.parameterSchema,
    retryPolicy: RETRY_NONE,
    mcp: {
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    idempotencyStrategy: 'locked',
    directExternalSideEffect: true,
    requiredIntegration: 'stripe_agent',
    spendsMoney: true,
    executionPath: args.executionPath,
    reversible: false,
    blastRadius: 'external',
    verify: hasExplicitVerify ? args.verify : defaultVerify,
    ...(args.verify === null && args.verifyActionNoun !== undefined && {
      verifyNullJustification: templateVerifyNullJustification(args.verifyActionNoun),
    }),
  };
}

// ── 9. defineMethodologySkill ─────────────────────────────────────────────────

export interface MethodologySkillArgs {
  slug: string;
  description: string;
  topics: string[];
}

export function defineMethodologySkill(args: MethodologySkillArgs): ActionDefinition {
  return {
    actionType: args.slug,
    description: args.description,
    actionCategory: 'worker',
    topics: args.topics,
    isExternal: false,
    readPath: 'none',
    defaultGateLevel: 'auto',
    riskTier: 0,
    createsBoardTask: false,
    payloadFields: [],
    parameterSchema: z.object({}),
    retryPolicy: RETRY_NONE,
    mcp: createMcpRead(false),
    idempotencyStrategy: 'read_only',
    isMethodology: true,
  };
}
