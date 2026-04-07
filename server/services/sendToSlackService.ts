/**
 * sendToSlackService — backs the `send_to_slack` system skill.
 *
 * Spec: docs/reporting-agent-paywall-workflow-spec.md §5 (Code Change C),
 * §5.5.1 (T11 — deterministic post-hash dedup), §5.5.2 (T18 — persist
 * before post), §5.5 (T26 — verification ping).
 *
 * Order of operations (strict, never reordered):
 *
 *   1. Resolve the Slack connection (subaccount → org fallback).
 *   2. Persist the report body to task_deliverables (T18) BEFORE calling
 *      Slack so an operator can manually re-send if Slack fails.
 *   3. Compute the deterministic post hash (T11) on the FINAL rendered
 *      message text — not the templated input.
 *   4. Check agent_runs.metadata.slackPosts for the same hash — skip if
 *      found (idempotency for retries within the same run).
 *   5. Call chat.postMessage. Optional file upload threaded under the post.
 *   6. Verify messageTs + permalink are present (T26).
 *   7. Record the post hash on agent_runs.metadata.slackPosts.
 */

import { createHash } from 'crypto';
import { eq, and, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  integrationConnections,
  taskDeliverables,
  ieeArtifacts,
  agentRuns,
} from '../db/schema/index.js';
import { connectionTokenService } from './connectionTokenService.js';
import { withBackoff } from '../lib/withBackoff.js';
import { writeWithLimit, INLINE_TEXT_LIMITS } from '../lib/inlineTextWriter.js';
import { failure, FailureError } from '../../shared/iee/failure.js';
import { logger } from '../lib/logger.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SendToSlackInput {
  message: string;
  channel?: string;
  bodyText?: string;
  filename?: string;
  taskId?: string;
  onDuplicate?: 'skip' | 'force';
}

export interface SendToSlackContext {
  runId: string;
  organisationId: string;
  subaccountId: string | null;
  agentId: string;
  correlationId: string;
}

export interface SendToSlackResult {
  messageTs: string;
  permalink: string;
  postHash: string;
  deliverableId: string | null;
  cached: boolean;
}

interface SlackConfigStored {
  workspaceName?: string;
  workspaceId?: string;
  defaultChannel?: string;
  botUserId?: string;
}

interface PostedSlackEntry {
  postHash: string;
  channel: string;
  messageTs: string;
  permalink: string;
  postedAt: string;
  runId: string;
  correlationId: string;
}

const SLACK_POSTMESSAGE = 'https://slack.com/api/chat.postMessage';
const SLACK_PERMALINK = 'https://slack.com/api/chat.getPermalink';
const SLACK_FILES_UPLOAD = 'https://slack.com/api/files.upload';

// ─── Public API ───────────────────────────────────────────────────────────────

export async function sendToSlack(
  input: SendToSlackInput,
  ctx: SendToSlackContext,
): Promise<SendToSlackResult> {
  // 1. Resolve the Slack connection (subaccount → org fallback)
  const conn = await resolveSlackConnection(ctx.organisationId, ctx.subaccountId);
  if (!conn) {
    throw new FailureError(
      failure('auth_failure', 'slack_not_configured', {
        runId: ctx.runId,
        correlationId: ctx.correlationId,
      }),
    );
  }
  const config = (conn.configJson as SlackConfigStored | null) ?? {};
  const channel = input.channel ?? config.defaultChannel;
  if (!channel) {
    throw new FailureError(
      failure('data_incomplete', 'slack_channel_not_specified', {
        runId: ctx.runId,
        hint: 'Either pass channel in the skill input or set defaultChannel on the Slack connection.',
      }),
    );
  }

  // 2. Persist deliverable BEFORE Slack call (T18)
  let deliverableId: string | null = null;
  if (input.bodyText && input.taskId) {
    const { stored, wasTruncated } = writeWithLimit(
      'slack_deliverable',
      input.bodyText,
      INLINE_TEXT_LIMITS.DELIVERABLE_BODY_TEXT,
    );
    const [created] = await db
      .insert(taskDeliverables)
      .values({
        taskId: input.taskId,
        deliverableType: 'file',
        title: input.filename ?? 'Slack post',
        path: null,
        description: input.message.slice(0, 500),
        bodyText: stored,
        bodyTextTruncated: wasTruncated,
      })
      .returning();
    deliverableId = created.id;
  }

  // 3. Compute deterministic post hash on the FINAL rendered text (T11)
  const renderedText = input.message; // already rendered by the agent
  const messageTextHash = sha256(renderedText);
  const postHash = sha256(`${ctx.runId}:${channel}:${input.filename ?? ''}:${messageTextHash}`);

  // 4. Check the dedup cache on agent_runs.metadata.slackPosts
  const onDuplicate = input.onDuplicate ?? 'skip';
  const priorPost = await findPriorPost(ctx.runId, postHash);
  if (priorPost && onDuplicate === 'skip') {
    logger.warn('sendToSlack.duplicate_post_skipped', {
      runId: ctx.runId,
      correlationId: ctx.correlationId,
      postHash,
      cachedMessageTs: priorPost.messageTs,
    });
    return {
      messageTs: priorPost.messageTs,
      permalink: priorPost.permalink,
      postHash,
      deliverableId,
      cached: true,
    };
  }

  // 5. Call Slack
  const botToken = connectionTokenService.decryptToken(getEncryptedBotToken(conn));
  const post = await withBackoff(
    () => chatPostMessage({ token: botToken, channel, text: renderedText }),
    {
      label: 'slack.chat.postMessage',
      runId: ctx.runId,
      correlationId: ctx.correlationId,
      maxAttempts: 3,
      baseDelayMs: 1_000,
      // Per pr-reviewer MAJOR-3: retry on transient network errors as well
      // as Slack 429 / 5xx. Only Slack-mapped 4xx (invalid_auth,
      // channel_not_found) are non-retryable terminal failures.
      isRetryable: (err: unknown) => {
        if (err instanceof SlackHttpError) {
          return err.status === 429 || err.status >= 500;
        }
        // Anything else (DNS failure, ECONNREFUSED, TCP reset, fetch
        // throwing a TypeError on network) is treated as transient.
        return true;
      },
      retryAfterMs: (err: unknown) =>
        err instanceof SlackHttpError && err.retryAfterSeconds ? err.retryAfterSeconds * 1000 : undefined,
    },
  );

  const permalink = await getPermalink({ token: botToken, channel, messageTs: post.ts });

  // 6. T26 verification ping — assert messageTs and permalink are present
  if (!post.ts || !permalink) {
    throw new FailureError(
      failure('internal_error', 'slack_post_incomplete', {
        hasMessageTs: !!post.ts,
        hasPermalink: !!permalink,
        runId: ctx.runId,
      }),
    );
  }

  // 7. Record on agent_runs.metadata.slackPosts so subsequent calls dedupe
  await recordPriorPost(ctx.runId, {
    postHash,
    channel,
    messageTs: post.ts,
    permalink,
    postedAt: new Date().toISOString(),
    runId: ctx.runId,
    correlationId: ctx.correlationId,
  });

  return {
    messageTs: post.ts,
    permalink,
    postHash,
    deliverableId,
    cached: false,
  };
}

// ─── Internals ────────────────────────────────────────────────────────────────

async function resolveSlackConnection(
  organisationId: string,
  subaccountId: string | null,
) {
  // Subaccount-first, then org fallback. Same precedence as the existing
  // integrationConnectionService.getDecryptedConnection.
  if (subaccountId) {
    const [row] = await db
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.organisationId, organisationId),
          eq(integrationConnections.subaccountId, subaccountId),
          eq(integrationConnections.providerType, 'slack'),
          eq(integrationConnections.connectionStatus, 'active'),
        ),
      )
      .limit(1);
    if (row) return row;
  }
  const [row] = await db
    .select()
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organisationId, organisationId),
        isNull(integrationConnections.subaccountId),
        eq(integrationConnections.providerType, 'slack'),
        eq(integrationConnections.connectionStatus, 'active'),
      ),
    )
    .limit(1);
  return row ?? null;
}

function getEncryptedBotToken(conn: typeof integrationConnections.$inferSelect): string {
  if (conn.accessToken) return conn.accessToken;
  if (conn.secretsRef) return conn.secretsRef;
  throw new FailureError(
    failure('auth_failure', 'slack_bot_token_missing', {
      connectionId: conn.id,
    }),
  );
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

async function findPriorPost(runId: string, postHash: string): Promise<PostedSlackEntry | null> {
  // Read from agent_runs.run_metadata.slackPosts. This is the dedicated
  // mutable run-scoped metadata bucket added in migration 0073 — distinct
  // from configSnapshot which is immutable and reflects the start-of-run
  // resolved configuration. Spec v3.4 §5.5.1 / T11; pr-reviewer MAJOR-2.
  const [row] = await db
    .select({ runMetadata: agentRuns.runMetadata })
    .from(agentRuns)
    .where(eq(agentRuns.id, runId))
    .limit(1);
  if (!row || !row.runMetadata) return null;
  const meta = row.runMetadata as Record<string, unknown>;
  const slackPosts = (meta.slackPosts as PostedSlackEntry[] | undefined) ?? [];
  return slackPosts.find((p) => p.postHash === postHash) ?? null;
}

async function recordPriorPost(runId: string, entry: PostedSlackEntry): Promise<void> {
  // Read-modify-write on agent_runs.run_metadata.slackPosts (the dedicated
  // mutable metadata bucket — see findPriorPost comment for context).
  const [row] = await db
    .select({ runMetadata: agentRuns.runMetadata })
    .from(agentRuns)
    .where(eq(agentRuns.id, runId))
    .limit(1);
  if (!row) return;
  const meta = ((row.runMetadata as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
  const slackPosts = ((meta.slackPosts as PostedSlackEntry[] | undefined) ?? []).slice();
  slackPosts.push(entry);
  meta.slackPosts = slackPosts;
  await db
    .update(agentRuns)
    .set({ runMetadata: meta })
    .where(eq(agentRuns.id, runId));
}

class SlackHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

async function chatPostMessage(args: { token: string; channel: string; text: string }): Promise<{ ts: string }> {
  const res = await fetch(SLACK_POSTMESSAGE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${args.token}`,
    },
    body: JSON.stringify({ channel: args.channel, text: args.text }),
  });
  if (!res.ok) {
    const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
    throw new SlackHttpError(`slack.chat.postMessage:${res.status}`, res.status, retryAfter);
  }
  const json = (await res.json()) as { ok: boolean; ts?: string; error?: string };
  if (!json.ok || !json.ts) {
    // Slack returns 200 OK with `{ ok: false, error: ... }` for many failures.
    // Map known auth errors to a non-retryable status.
    if (json.error === 'invalid_auth' || json.error === 'token_revoked') {
      throw new SlackHttpError(`slack.chat.postMessage:invalid_auth`, 401);
    }
    if (json.error === 'channel_not_found') {
      throw new SlackHttpError(`slack.chat.postMessage:channel_not_found`, 404);
    }
    throw new SlackHttpError(`slack.chat.postMessage:${json.error ?? 'unknown'}`, 500);
  }
  return { ts: json.ts };
}

async function getPermalink(args: { token: string; channel: string; messageTs: string }): Promise<string> {
  const url = new URL(SLACK_PERMALINK);
  url.searchParams.set('channel', args.channel);
  url.searchParams.set('message_ts', args.messageTs);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${args.token}` },
  });
  if (!res.ok) {
    throw new SlackHttpError(`slack.chat.getPermalink:${res.status}`, res.status);
  }
  const json = (await res.json()) as { ok: boolean; permalink?: string };
  if (!json.ok || !json.permalink) {
    throw new SlackHttpError(`slack.chat.getPermalink:invalid`, 502);
  }
  return json.permalink;
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const num = Number(header);
  if (Number.isFinite(num) && num >= 0) return num;
  return undefined;
}
