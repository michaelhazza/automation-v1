/**
 * POST /api/workspace/native/inbound
 *
 * Receives inbound email payloads from the native email provider (Postmark,
 * SendGrid, Mailgun, etc.) and pipes them into workspaceEmailPipeline.ingest.
 *
 * Security: HMAC-SHA256 signature verified against
 * NATIVE_EMAIL_INBOUND_WEBHOOK_SECRET when the secret is set. In development
 * (secret empty) verification is skipped with a warning.
 *
 * Provider normalisation: the route handles the most common field names used by
 * Postmark and SendGrid. Unknown providers fall through with best-effort field
 * mapping.
 *
 * Identity resolution: the recipient address (first item in ToFull / to / To)
 * is matched against workspace_identities.email_address. 404 if no match.
 *
 * Route is intentionally unauthenticated (provider cannot supply a JWT).
 */

import { Router, raw } from 'express';
import crypto from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js'; // guard-ignore: rls-contract-compliance reason="D19 deferred — email→identity bootstrap lookup; withAdminConnection wrap tracked in tasks/todo.md"
import { workspaceIdentities } from '../db/schema/workspaceIdentities.js';
import { withOrgTx } from '../instrumentation.js';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { nativeWorkspaceAdapter } from '../adapters/workspace/nativeWorkspaceAdapter.js';
import { ingest } from '../services/workspace/workspaceEmailPipeline.js';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';
import type { InboundMessage } from '../../shared/types/workspaceAdapterContract.js';

const router = Router();

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

function verifySignature(rawBody: Buffer, header: string | undefined): boolean {
  const secret = env.NATIVE_EMAIL_INBOUND_WEBHOOK_SECRET;
  if (!secret) {
    logger.warn('workspace.inbound_webhook.no_secret');
    return true;
  }
  if (!header) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(header));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Payload normalisation (Postmark / SendGrid common fields)
// ---------------------------------------------------------------------------

interface RawPayload {
  // Postmark style
  MessageID?: string;
  From?: string;
  ToFull?: Array<{ Email: string }>;
  To?: string;
  Cc?: string;
  Subject?: string;
  TextBody?: string;
  HtmlBody?: string;
  Date?: string;
  ReplyTo?: string;
  InReplyTo?: string;
  References?: string;
  Attachments?: unknown[];
  // SendGrid style
  from?: string;
  to?: string;
  cc?: string;
  subject?: string;
  text?: string;
  html?: string;
  dkim?: string;
  headers?: string;
  charsets?: string;
  envelope?: string;
  // Generic
  messageId?: string;
  message_id?: string;
  timestamp?: string | number;
}

function normalise(body: RawPayload): { msg: Omit<InboundMessage, 'rawProviderId'>; toAddress: string } | null {
  const from = body.From ?? body.from ?? '';
  if (!from) return null;

  // Recipient
  let toAddress = '';
  if (body.ToFull?.length) {
    toAddress = body.ToFull[0].Email;
  } else if (body.To) {
    toAddress = body.To.split(',')[0].trim();
  } else if (body.to) {
    toAddress = body.to.split(',')[0].trim();
  }
  if (!toAddress) return null;

  // CC
  const ccRaw = body.Cc ?? body.cc ?? '';
  const ccAddresses = ccRaw ? ccRaw.split(',').map((s: string) => s.trim()) : null;

  // References / In-Reply-To
  const inReplyToRaw = body.InReplyTo ?? body.dkim ?? null; // dkim is a fallback field; InReplyTo is canonical
  const refsRaw = body.References ?? '';
  const referencesExternalIds = refsRaw
    ? refsRaw.split(/\s+/).map((s: string) => s.replace(/[<>]/g, '').trim()).filter(Boolean)
    : [];

  const sentAt = body.Date ? new Date(body.Date) : new Date();

  return {
    toAddress,
    msg: {
      externalMessageId: body.MessageID ?? body.messageId ?? body.message_id ?? null,
      fromAddress: from,
      toAddresses: [toAddress],
      ccAddresses,
      subject: body.Subject ?? body.subject ?? null,
      bodyText: body.TextBody ?? body.text ?? null,
      bodyHtml: body.HtmlBody ?? body.html ?? null,
      sentAt: isNaN(sentAt.getTime()) ? new Date() : sentAt,
      receivedAt: new Date(),
      inReplyToExternalId: inReplyToRaw ? inReplyToRaw.replace(/[<>]/g, '').trim() : null,
      referencesExternalIds,
      attachmentsCount: Array.isArray(body.Attachments) ? body.Attachments.length : 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

router.post(
  '/api/workspace/native/inbound',
  raw({ type: '*/*' }),
  async (req, res) => {
    const rawBody = req.body as Buffer;
    const signature = req.headers['x-webhook-signature'] as string | undefined;

    if (!verifySignature(rawBody, signature)) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    let payload: RawPayload;
    try {
      payload = JSON.parse(rawBody.toString('utf-8')) as RawPayload;
    } catch {
      res.status(400).json({ error: 'Invalid JSON' });
      return;
    }

    const normalised = normalise(payload);

    if (!normalised) {
      logger.warn('workspace.inbound_webhook.parse_failed', { keys: Object.keys(payload ?? {}) });
      // Return 200 so the provider doesn't retry — the payload is malformed.
      res.json({ ok: false, reason: 'parse_failed' });
      return;
    }

    const { msg, toAddress } = normalised;
    const emailLower = toAddress.toLowerCase();

    // Resolve identity by recipient address — cross-org bootstrap lookup.
    // No organisation_id is known yet, so this must bypass RLS via admin_role.
    const identityRows = await withAdminConnection(
      { source: 'inbound-webhook.identity-lookup', reason: 'bootstrap email-to-org resolution' },
      async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE admin_role`);
        return tx
          .select()
          .from(workspaceIdentities)
          .where(eq(workspaceIdentities.emailAddress, emailLower))
          .limit(1);
      },
    );
    const [identity] = identityRows;

    if (!identity) {
      logger.warn('workspace.inbound_webhook.identity_not_found', { toAddress: emailLower });
      // Return 200 — unknown recipient, nothing to do.
      res.json({ ok: false, reason: 'identity_not_found' });
      return;
    }

    const raw: InboundMessage = {
      ...msg,
      rawProviderId: msg.externalMessageId ?? `native-${Date.now()}`,
    };

    try {
      const result = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.organisation_id', ${identity.organisationId}, true)`);
        return withOrgTx(
          { tx, organisationId: identity.organisationId, source: 'inbound-webhook' },
          () => ingest(identity.organisationId, identity.id, raw, { adapter: nativeWorkspaceAdapter }),
        );
      });
      logger.info('workspace.inbound_webhook.ok', { messageId: result.messageId, deduplicated: result.deduplicated });
      res.json({ ok: true, messageId: result.messageId, deduplicated: result.deduplicated });
    } catch (err) {
      logger.error('workspace.inbound_webhook.error', { err });
      res.status(500).json({ error: 'Internal error' });
    }
  },
);

export default router;
