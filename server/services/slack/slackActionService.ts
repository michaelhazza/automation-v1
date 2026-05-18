import { and, eq } from 'drizzle-orm';
import { getOrgScopedDb } from '../../lib/orgScopedDb.js';
import { eaDrafts } from '../../db/schema/eaDrafts.js';
import { actions } from '../../db/schema/actions.js';
import { integrationConnections } from '../../db/schema/integrationConnections.js';
import { credentialBrokerService } from '../credentialBrokerService.js';
import { eaDraftService } from '../eaDrafts/eaDraftService.js';
import {
  decideAutoSendScope,
  validatePostMessageInput,
  validatePostDmInput,
  assembleThreadSummaryPrompt,
} from './slackActionServicePure.js';
import { dispatchWithDraftClaim } from '../actions/dispatchHelper.js';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface SlackCtx {
  organisationId: string;
  subaccountId: string;
  ownerUserId: string;
  /**
   * Internal flag — set by `eaDraftDispatchService.dispatchAfterApproval`
   * when it has already claimed the draft (ea_drafts.send_state idle → sending)
   * before invoking the handler. The handler MUST then skip its own
   * `claimSend` call. Default (undefined / false) preserves the legacy
   * direct-call contract where the handler claims itself.
   *
   * chatgpt-pr-review R2 F2: claiming in the dispatch hook ensures any
   * routing failure before this point (e.g. dynamic import error, body
   * shape mismatch, missing provider module) is paired with
   * `markSendFailed` — drafts never get stuck in `approved`/`idle`.
   */
  _dispatchPreClaimed?: boolean;
}

interface SlackMessage {
  user: string;
  text: string;
  ts: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Credential resolution
// ---------------------------------------------------------------------------

async function resolveSlackToken(
  ownerUserId: string,
  organisationId: string,
  subaccountId: string,
): Promise<string> {
  const scopedDb = getOrgScopedDb('slackActionService.resolveSlackToken');
  const [conn] = await scopedDb
    .select()
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organisationId, organisationId),
        eq(integrationConnections.ownerUserId, ownerUserId),
        eq(integrationConnections.providerType, 'slack'),
        eq(integrationConnections.connectionStatus, 'active'),
      ),
    )
    .limit(1);

  if (!conn) {
    throw Object.assign(
      new Error(`No active Slack connection found for owner ${ownerUserId}`),
      { statusCode: 404, errorCode: 'INTEGRATION_NOT_CONNECTED' },
    );
  }

  const issued = await credentialBrokerService.issueCredential({
    organisationId,
    subaccountId,
    connectionId: conn.id,
    purpose: 'slack_action',
  });

  const env: Record<string, string> = {};
  await credentialBrokerService.injectIntoEnvironment({
    issuedCredential: issued as Parameters<typeof credentialBrokerService.injectIntoEnvironment>[0]['issuedCredential'],
    environment: env,
    ownerUserId,
  });

  const token = env['CREDENTIAL_TOKEN'];
  if (!token) {
    throw Object.assign(
      new Error('Failed to resolve Slack access token'),
      { statusCode: 502, errorCode: 'CREDENTIAL_INJECT_FAILED' },
    );
  }
  return token;
}

// ---------------------------------------------------------------------------
// Slack API fetch helper
// ---------------------------------------------------------------------------

const SLACK_API_BASE = 'https://slack.com/api';

async function slackFetch(
  endpoint: string,
  token: string,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const url = `${SLACK_API_BASE}/${endpoint}`;

  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(
      new Error(`Slack API HTTP error ${res.status}: ${text}`),
      { statusCode: res.status >= 500 ? 502 : res.status, errorCode: 'SLACK_API_ERROR' },
    );
  }

  const data = (await res.json()) as Record<string, unknown>;

  // Slack always returns HTTP 200; actual errors live in data.error
  if (data['ok'] === false) {
    const errorCode = data['error'] as string | undefined;
    // Plan-restricted search errors: surface a structured error
    if (
      errorCode === 'not_allowed_token_type' ||
      errorCode === 'missing_scope' ||
      errorCode === 'team_not_authorized'
    ) {
      throw Object.assign(
        new Error(`Slack search not available: ${errorCode}`),
        { code: 'PLAN_NOT_SUPPORTED', statusCode: 422, slackError: errorCode },
      );
    }
    throw Object.assign(
      new Error(`Slack API error: ${errorCode ?? 'unknown'}`),
      { statusCode: 502, errorCode: 'SLACK_API_ERROR', slackError: errorCode },
    );
  }

  return data;
}

// ---------------------------------------------------------------------------
// Approved-draft pre-flight: check actions.status === 'approved' AND sendState === 'idle'
// ---------------------------------------------------------------------------

async function writePreFlight(
  draftId: string,
  organisationId: string,
  callerOwnerUserId: string,
): Promise<void> {
  const scopedDb = getOrgScopedDb('slackActionService.writePreFlight');
  const rows = await scopedDb
    .select({
      sendState: eaDrafts.sendState,
      actionStatus: actions.status,
      draftOwnerUserId: eaDrafts.ownerUserId,
    })
    .from(eaDrafts)
    .innerJoin(actions, eq(eaDrafts.proposalActionId, actions.id))
    .where(
      and(
        eq(eaDrafts.id, draftId),
        eq(eaDrafts.organisationId, organisationId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw Object.assign(
      new Error(`EA draft ${draftId} not found`),
      { statusCode: 404, errorCode: 'DRAFT_NOT_FOUND' },
    );
  }

  // Owner-mismatch guard — see calendarActionService.writePreFlight for context.
  if (row.draftOwnerUserId !== callerOwnerUserId) {
    throw Object.assign(
      new Error(`Draft ${draftId} does not belong to caller ${callerOwnerUserId}`),
      { statusCode: 403, errorCode: 'DRAFT_OWNER_MISMATCH' },
    );
  }

  if (row.actionStatus !== 'approved') {
    throw Object.assign(
      new Error(`Action for draft ${draftId} is not approved (status: ${row.actionStatus})`),
      { statusCode: 422, errorCode: 'DRAFT_NOT_APPROVED' },
    );
  }

  if (row.sendState !== 'idle') {
    throw Object.assign(
      new Error(`Draft ${draftId} send is in flight (sendState: ${row.sendState})`),
      { statusCode: 409, errorCode: 'DRAFT_SEND_IN_FLIGHT' },
    );
  }
}

// ---------------------------------------------------------------------------
// Public service
// ---------------------------------------------------------------------------

export const slackActionService = {
  // ── Read actions ─────────────────────────────────────────────────────────

  async listChannels(
    input: {
      cursor?: string;
      limit?: number;
      excludeArchived?: boolean;
      types?: Array<'public_channel' | 'private_channel' | 'mpim' | 'im'>;
    },
    ctx: SlackCtx,
  ): Promise<{ channels: unknown[]; nextCursor?: string }> {
    const token = await resolveSlackToken(ctx.ownerUserId, ctx.organisationId, ctx.subaccountId);

    const params = new URLSearchParams({
      limit: String(input.limit ?? 100),
      exclude_archived: String(input.excludeArchived ?? true),
    });
    if (input.cursor) params.set('cursor', input.cursor);
    if (input.types && input.types.length > 0) {
      // Slack's conversations.list expects a comma-separated `types` param.
      params.set('types', input.types.join(','));
    }

    const data = await slackFetch(`conversations.list?${params.toString()}`, token);

    return {
      channels: (data['channels'] as unknown[]) ?? [],
      nextCursor: (data['response_metadata'] as Record<string, unknown> | undefined)?.['next_cursor'] as string | undefined,
    };
  },

  async readChannel(
    input: { channelId: string; limit?: number; oldest?: string; latest?: string },
    ctx: SlackCtx,
  ): Promise<{ messages: SlackMessage[] }> {
    const token = await resolveSlackToken(ctx.ownerUserId, ctx.organisationId, ctx.subaccountId);

    const params = new URLSearchParams({
      channel: input.channelId,
      limit: String(input.limit ?? 50),
    });
    if (input.oldest) params.set('oldest', input.oldest);
    if (input.latest) params.set('latest', input.latest);

    const data = await slackFetch(`conversations.history?${params.toString()}`, token);

    return { messages: (data['messages'] as SlackMessage[]) ?? [] };
  },

  async searchMessages(
    input: { query: string; count?: number; page?: number; sort?: string; sortDir?: string },
    ctx: SlackCtx,
  ): Promise<{ matches: unknown[]; total: number }> {
    const token = await resolveSlackToken(ctx.ownerUserId, ctx.organisationId, ctx.subaccountId);

    const params = new URLSearchParams({ query: input.query });
    if (input.count !== undefined) params.set('count', String(input.count));
    if (input.page !== undefined) params.set('page', String(input.page));
    if (input.sort) params.set('sort', input.sort);
    if (input.sortDir) params.set('sort_dir', input.sortDir);

    const data = await slackFetch(`search.messages?${params.toString()}`, token);

    const messages = data['messages'] as Record<string, unknown> | undefined;
    return {
      matches: (messages?.['matches'] as unknown[]) ?? [],
      total: (messages?.['total'] as number) ?? 0,
    };
  },

  async summariseThread(
    input: { channelId: string; threadTs: string },
    ctx: SlackCtx,
  ): Promise<{ messages: SlackMessage[]; summary: null }> {
    const token = await resolveSlackToken(ctx.ownerUserId, ctx.organisationId, ctx.subaccountId);

    const params = new URLSearchParams({
      channel: input.channelId,
      ts: input.threadTs,
    });

    const data = await slackFetch(`conversations.replies?${params.toString()}`, token);
    const messages = (data['messages'] as SlackMessage[]) ?? [];

    // V1: return raw thread messages with assembled prompt; LLM integration deferred
    void assembleThreadSummaryPrompt(messages);

    return { messages, summary: null };
  },

  // ── Write actions ─────────────────────────────────────────────────────────

  async postMessage(
    input: {
      channelId: string;
      text: string;
      agentId: string;
      agentRunId: string;
      kind?: 'slack_post';
    },
    ctx: SlackCtx,
  ): Promise<{ queued: true; draftId: string; actionId: string }> {
    const validation = validatePostMessageInput(input);
    if (!validation.valid) {
      throw Object.assign(
        new Error(`Invalid postMessage input: ${validation.reason}`),
        { statusCode: 400, errorCode: 'INVALID_INPUT' },
      );
    }

    // post_message always goes through review
    const scope = decideAutoSendScope({
      action: 'post_message',
      target: input.channelId,
      ownerUserId: ctx.ownerUserId,
    });
    // scope is always 'review' for post_message, but kept for clarity

    if (scope === 'review') {
      const result = await eaDraftService.createDraftWithProposal(
        {
          kind: 'slack_post',
          body: { channelId: input.channelId, text: input.text },
          targetRef: input.channelId,
          agentId: input.agentId,
          agentRunId: input.agentRunId,
          ownerUserId: ctx.ownerUserId,
          subaccountId: ctx.subaccountId,
        },
        { organisationId: ctx.organisationId },
      );
      return { queued: true, draftId: result.draftId, actionId: result.actionId };
    }

    // TypeScript exhaustive guard — should never reach here for post_message
    throw Object.assign(
      new Error('Unexpected scope for postMessage'),
      { statusCode: 500, errorCode: 'INTERNAL_ERROR' },
    );
  },

  async postDm(
    input: {
      targetUserId: string;
      text: string;
      agentId: string;
      agentRunId: string;
      kind?: 'slack_dm';
    },
    ctx: SlackCtx,
  ): Promise<
    | { queued: true; draftId: string; actionId: string }
    | { sent: true; ts: string }
  > {
    const validation = validatePostDmInput(input);
    if (!validation.valid) {
      throw Object.assign(
        new Error(`Invalid postDm input: ${validation.reason}`),
        { statusCode: 400, errorCode: 'INVALID_INPUT' },
      );
    }

    const scope = decideAutoSendScope({
      action: 'post_dm',
      target: input.targetUserId,
      ownerUserId: ctx.ownerUserId,
    });

    if (scope === 'review') {
      const result = await eaDraftService.createDraftWithProposal(
        {
          kind: 'slack_dm',
          body: { targetUserId: input.targetUserId, text: input.text },
          targetRef: input.targetUserId,
          agentId: input.agentId,
          agentRunId: input.agentRunId,
          ownerUserId: ctx.ownerUserId,
          subaccountId: ctx.subaccountId,
        },
        { organisationId: ctx.organisationId },
      );
      return { queued: true, draftId: result.draftId, actionId: result.actionId };
    }

    // auto path: target === ownerUserId, send directly without a draft
    const token = await resolveSlackToken(ctx.ownerUserId, ctx.organisationId, ctx.subaccountId);

    // Open a DM channel, then post
    const openData = await slackFetch('conversations.open', token, {
      users: input.targetUserId,
    });
    const channelId = (openData['channel'] as Record<string, unknown> | undefined)?.['id'] as string | undefined;
    if (!channelId) {
      throw Object.assign(
        new Error('Failed to open Slack DM channel'),
        { statusCode: 502, errorCode: 'SLACK_DM_OPEN_FAILED' },
      );
    }

    const postData = await slackFetch('chat.postMessage', token, {
      channel: channelId,
      text: input.text,
    });

    return { sent: true, ts: (postData['ts'] as string) ?? '' };
  },

  // ---------------------------------------------------------------------------
  // executeApprovedDraftSend
  // Called from the approval flow after an ea_draft's associated action is approved.
  // Loads the draft, verifies approved+idle, claims send, posts to Slack, marks sent/failed.
  // ---------------------------------------------------------------------------

  async executeApprovedDraftSend(
    draftId: string,
    ctx: SlackCtx,
  ): Promise<{ sent: true; ts: string }> {
    await writePreFlight(draftId, ctx.organisationId, ctx.ownerUserId);

    return dispatchWithDraftClaim({
      draftId,
      ctx,
      performDispatch: async () => {
        const draft = await eaDraftService.getDraft(draftId, ctx);
        if (!draft) {
          throw Object.assign(
            new Error(`EA draft ${draftId} not found after claim`),
            { statusCode: 404, errorCode: 'DRAFT_NOT_FOUND' },
          );
        }

        const token = await resolveSlackToken(ctx.ownerUserId, ctx.organisationId, ctx.subaccountId);
        const body = draft.body as Record<string, unknown>;

        let postData: Record<string, unknown>;
        if (draft.kind === 'slack_dm') {
          const targetUserId = body['targetUserId'] as string;
          const openData = await slackFetch('conversations.open', token, { users: targetUserId });
          const channelId = (openData['channel'] as Record<string, unknown> | undefined)?.['id'] as string | undefined;
          if (!channelId) {
            throw Object.assign(
              new Error('Failed to open Slack DM channel'),
              { statusCode: 502, errorCode: 'SLACK_DM_OPEN_FAILED' },
            );
          }
          postData = await slackFetch('chat.postMessage', token, { channel: channelId, text: body['text'] });
        } else {
          postData = await slackFetch('chat.postMessage', token, { channel: body['channelId'], text: body['text'] });
        }

        return { sent: true as const, ts: (postData['ts'] as string) ?? '' };
      },
      resolveSentId: (result) => result.ts,
    });
  },
};
