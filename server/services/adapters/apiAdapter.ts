import type { Action } from '../../db/schema/actions.js';
import type { IntegrationConnection } from '../../db/schema/integrationConnections.js';
import type { ExecutionAdapter, ExecutionResult } from './workerAdapter.js';
import {
  classifyAdapterOutcome,
  type AdapterOutcomeClassification,
} from './apiAdapterClassifierPure.js';
import {
  GHL_ENDPOINTS,
  substituteUrlTemplate,
  type GhlEndpointKey,
  type GhlEndpointSpec,
} from './ghlEndpoints.js';
import { DEFAULT_ADAPTER_TIMEOUT_MS } from '../../config/limits.js';

// ---------------------------------------------------------------------------
// API Adapter — real GHL dispatcher. Spec §§2.2, 2.4, 2.5 (ClientPulse Session 2).
// Owns: dispatch, idempotency forwarding, classifier consumption, structured logging.
// Does NOT own: proposer validation, actions.status transitions, config-history writes.
// ---------------------------------------------------------------------------

type InternalResult =
  | { ok: true; providerResponseSummary: string; classification: AdapterOutcomeClassification }
  | {
      ok: false;
      errorCode: 'AUTH' | 'NOT_FOUND' | 'VALIDATION' | 'RATE_LIMITED' | 'GATEWAY' | 'NETWORK_TIMEOUT' | 'OTHER';
      message: string;
      retryable: boolean;
      classification: AdapterOutcomeClassification;
    };

function mapClassification(
  classification: AdapterOutcomeClassification,
  providerBody: string,
): InternalResult {
  switch (classification.kind) {
    case 'terminal_success':
      return {
        ok: true,
        providerResponseSummary: providerBody.slice(0, 500),
        classification,
      };
    case 'retryable':
      switch (classification.reason) {
        case 'rate_limit':
          return {
            ok: false,
            errorCode: 'RATE_LIMITED',
            message: 'GHL rate limited (429)',
            retryable: true,
            classification,
          };
        case 'gateway':
          return {
            ok: false,
            errorCode: 'GATEWAY',
            message: 'GHL gateway error (502/503)',
            retryable: true,
            classification,
          };
        case 'network_timeout':
          return {
            ok: false,
            errorCode: 'NETWORK_TIMEOUT',
            message: 'Network timeout reaching GHL',
            retryable: true,
            classification,
          };
        case 'server_error':
          return {
            ok: false,
            errorCode: 'OTHER',
            message: 'GHL server error (5xx)',
            retryable: true,
            classification,
          };
      }
      break;
    case 'terminal_failure':
      switch (classification.reason) {
        case 'auth':
          return {
            ok: false,
            errorCode: 'AUTH',
            message: 'GHL authentication failed (401/403)',
            retryable: false,
            classification,
          };
        case 'not_found':
          return {
            ok: false,
            errorCode: 'NOT_FOUND',
            message: 'GHL resource not found (404)',
            retryable: false,
            classification,
          };
        case 'validation':
          return {
            ok: false,
            errorCode: 'VALIDATION',
            message: 'GHL rejected payload (422)',
            retryable: false,
            classification,
          };
        case 'other':
          return {
            ok: false,
            errorCode: 'OTHER',
            message: 'GHL returned a terminal error',
            retryable: false,
            classification,
          };
      }
  }
  // unreachable — every classification branch is handled
  throw new Error('classifyAdapterOutcome returned an unknown kind');
}

function validateRequiredFields(
  payload: Record<string, unknown>,
  endpoint: GhlEndpointSpec,
): string | null {
  for (const field of endpoint.requiredFields) {
    const value = payload[field];
    if (value === undefined || value === null || value === '') {
      return `Missing required payload field: ${field}`;
    }
  }
  return null;
}

async function dispatchHttp(
  url: string,
  method: GhlEndpointSpec['method'],
  body: Record<string, unknown>,
  accessToken: string,
  idempotencyKey: string,
  timeoutMs: number,
): Promise<AdapterOutcomeClassification & { providerBody?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'Idempotency-Key': idempotencyKey,
      },
      body: method === 'GET' ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const providerBody = await response.text().catch(() => '');
    const classification = classifyAdapterOutcome({ status: response.status });
    return { ...classification, providerBody };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return classifyAdapterOutcome({ networkError: true, timedOut: isAbort });
  } finally {
    clearTimeout(timer);
  }
}

function resolveBaseUrl(connection: IntegrationConnection | null): string {
  const config = (connection?.configJson as Record<string, unknown> | null) ?? null;
  const configured = typeof config?.baseUrl === 'string' ? (config.baseUrl as string) : null;
  // GHL's stable REST base. Per-org overrides stored in configJson.baseUrl.
  return configured ?? 'https://services.leadconnectorhq.com';
}

function logDispatch(payload: {
  actionId: string;
  actionType: string;
  outcome: 'success' | 'retryable' | 'terminal_failure' | 'precondition';
  reason?: string;
  status?: number;
}): void {
  // Structured log line per contract (q) — keyed on actionId so downstream log
  // analysis can reconstruct the full dispatch history of any single action.
  console.log(
    JSON.stringify({
      evt: 'apiAdapter.dispatch',
      actionId: payload.actionId,
      actionType: payload.actionType,
      outcome: payload.outcome,
      reason: payload.reason ?? null,
      status: payload.status ?? null,
    }),
  );
}

export const apiAdapter: ExecutionAdapter = {
  async execute(action: Action, connection?: unknown): Promise<ExecutionResult> {
    const typedConnection = (connection ?? null) as IntegrationConnection | null;
    const payload = (action.payloadJson ?? {}) as Record<string, unknown>;
    const actionType = action.actionType as GhlEndpointKey | string;
    const endpoint = GHL_ENDPOINTS[actionType as GhlEndpointKey];

    if (!endpoint) {
      logDispatch({
        actionId: action.id,
        actionType,
        outcome: 'terminal_failure',
        reason: 'unknown_action_type',
      });
      return {
        success: false,
        resultStatus: 'failed',
        error: `apiAdapter does not handle actionType: ${actionType}`,
        errorCode: 'unknown_action_type',
      };
    }

    // notify_operator short-circuits per spec §2.4 — the fan-out lives in Phase 8.3.
    // Until skillExecutor routes notify_operator through the fan-out service
    // (Chunk 5), returning terminal_success here preserves prior stub semantics.
    if (endpoint.internal) {
      logDispatch({
        actionId: action.id,
        actionType,
        outcome: 'success',
        reason: 'internal_shortcircuit',
      });
      return {
        success: true,
        resultStatus: 'success',
        result: { delivered: false, reason: 'fan_out_not_yet_wired' },
      };
    }

    const missingField = validateRequiredFields(payload, endpoint);
    if (missingField) {
      logDispatch({
        actionId: action.id,
        actionType,
        outcome: 'terminal_failure',
        reason: 'missing_required_field',
      });
      return {
        success: false,
        resultStatus: 'failed',
        error: missingField,
        errorCode: 'validation_failed',
      };
    }

    if (!typedConnection?.accessToken) {
      logDispatch({
        actionId: action.id,
        actionType,
        outcome: 'terminal_failure',
        reason: 'no_access_token',
      });
      return {
        success: false,
        resultStatus: 'failed',
        error: 'No active GHL integration connection with access token',
        errorCode: 'no_connection',
      };
    }

    // Defensive pre-dispatch warning: OAuth refresh-on-expire is deferred to
    // Session 3. If the stored token is near expiry, surface it in logs so the
    // eventual AUTH terminal_failure is traceable to token staleness rather
    // than misconfiguration.
    if (typedConnection.tokenExpiresAt) {
      const msToExpiry = typedConnection.tokenExpiresAt.getTime() - Date.now();
      if (msToExpiry <= 0) {
        console.warn(
          JSON.stringify({
            evt: 'apiAdapter.token_expired',
            actionId: action.id,
            actionType,
            tokenExpiresAt: typedConnection.tokenExpiresAt.toISOString(),
          }),
        );
      } else if (msToExpiry < 5 * 60 * 1000) {
        console.warn(
          JSON.stringify({
            evt: 'apiAdapter.token_near_expiry',
            actionId: action.id,
            actionType,
            tokenExpiresAt: typedConnection.tokenExpiresAt.toISOString(),
            secondsRemaining: Math.floor(msToExpiry / 1000),
          }),
        );
      }
    }

    let url: string;
    try {
      url = resolveBaseUrl(typedConnection) + substituteUrlTemplate(endpoint.urlTemplate, payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logDispatch({
        actionId: action.id,
        actionType,
        outcome: 'terminal_failure',
        reason: 'url_substitution_failed',
      });
      return {
        success: false,
        resultStatus: 'failed',
        error: message,
        errorCode: 'validation_failed',
      };
    }

    const metadata = (action.metadataJson ?? {}) as Record<string, unknown>;
    const timeoutMs =
      typeof metadata.timeoutBudgetMs === 'number'
        ? (metadata.timeoutBudgetMs as number)
        : DEFAULT_ADAPTER_TIMEOUT_MS;

    const classification = await dispatchHttp(
      url,
      endpoint.method,
      payload,
      typedConnection.accessToken,
      action.idempotencyKey,
      timeoutMs,
    );
    const providerBody = 'providerBody' in classification ? classification.providerBody ?? '' : '';
    const mapped = mapClassification(classification, providerBody);

    logDispatch({
      actionId: action.id,
      actionType,
      outcome:
        mapped.classification.kind === 'terminal_success'
          ? 'success'
          : mapped.classification.kind === 'retryable'
          ? 'retryable'
          : 'terminal_failure',
      reason:
        mapped.classification.kind === 'retryable' || mapped.classification.kind === 'terminal_failure'
          ? mapped.classification.reason
          : undefined,
    });

    if (mapped.ok) {
      return {
        success: true,
        resultStatus: 'success',
        result: { providerResponseSummary: mapped.providerResponseSummary },
      };
    }

    return {
      success: false,
      resultStatus: 'failed',
      error: mapped.message,
      errorCode: mapped.errorCode,
      retryable: mapped.retryable,
    };
  },
};
