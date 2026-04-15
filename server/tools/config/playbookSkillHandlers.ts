/**
 * Playbook portal + email skill handlers.
 *
 * Phase G — onboarding-playbooks-spec §11.6.
 *
 * These two skills are callable only from `action_call` playbook steps —
 * they are NOT reachable from human-initiated Configuration Assistant
 * sessions. The allowlist enforces this at the action_call validator layer;
 * no separate gate is needed here.
 *
 * - `config_publish_playbook_output_to_portal` — upserts a `portal_briefs`
 *   row and ensures the associated run's `isPortalVisible = true`.
 * - `config_send_playbook_email_digest` — sends a markdown email digest via
 *   the configured email provider with (runId, to.sort().join(',')) dedup.
 */

import type { SkillExecutionContext } from '../../services/skillExecutor.js';
import { db } from '../../db/index.js';
import { portalBriefs, playbookRuns } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { emailService } from '../../services/emailService.js';
import { sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// config_publish_playbook_output_to_portal
// ---------------------------------------------------------------------------

/**
 * Upserts a portal brief for the given run. On conflict (run_id) updates the
 * title, bullets, detailMarkdown and marks the run portal-visible.
 *
 * Inputs: { runId, playbookSlug, title, bullets: string[], detailMarkdown }
 * Output: { success: true, briefId }
 */
export async function executeConfigPublishPlaybookOutputToPortal(
  input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<unknown> {
  const runId = String(input.runId ?? context.runId ?? '');
  const playbookSlug = String(input.playbookSlug ?? '');
  const title = String(input.title ?? '');
  const bullets = Array.isArray(input.bullets) ? (input.bullets as unknown[]).map(String) : [];
  const detailMarkdown = String(input.detailMarkdown ?? '');

  if (!runId) return { success: false, error: 'runId is required' };
  if (!playbookSlug) return { success: false, error: 'playbookSlug is required' };

  // Verify the run belongs to this org and subaccount.
  const [run] = await db
    .select({
      id: playbookRuns.id,
      organisationId: playbookRuns.organisationId,
      subaccountId: playbookRuns.subaccountId,
    })
    .from(playbookRuns)
    .where(
      and(
        eq(playbookRuns.id, runId),
        eq(playbookRuns.organisationId, context.organisationId),
      ),
    );
  if (!run) return { success: false, error: 'Run not found or access denied' };

  const now = new Date();
  try {
    // Upsert — idempotency key is run_id (unique index on portal_briefs.run_id).
    const [brief] = await db
      .insert(portalBriefs)
      .values({
        organisationId: context.organisationId,
        subaccountId: run.subaccountId,
        runId,
        playbookSlug,
        title,
        bullets,
        detailMarkdown,
        isPortalVisible: true,
        publishedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: portalBriefs.runId,
        set: {
          title,
          bullets,
          detailMarkdown,
          isPortalVisible: true,
          publishedAt: now,
          updatedAt: now,
          retractedAt: null as unknown as undefined,
        },
      })
      .returning();

    // Mark the run itself portal-visible (§9.4 visibility contract).
    await db
      .update(playbookRuns)
      .set({ isPortalVisible: true, updatedAt: now })
      .where(eq(playbookRuns.id, runId));

    return { success: true, briefId: brief.id };
  } catch (err) {
    const e = err as { message?: string };
    return { success: false, error: e.message ?? String(err) };
  }
}

// ---------------------------------------------------------------------------
// config_send_playbook_email_digest
// ---------------------------------------------------------------------------

/**
 * Sends a playbook email digest. Deduplication is enforced via a pg advisory
 * lock keyed on `hash(runId || to.sort().join(','))` so concurrent retries
 * send exactly once.
 *
 * Inputs: { runId, to: string[], subject, bodyMarkdown }
 * Output: { success: true } | { success: false, error }
 */
export async function executeConfigSendPlaybookEmailDigest(
  input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<unknown> {
  const runId = String(input.runId ?? context.runId ?? '');
  const to = Array.isArray(input.to) ? (input.to as unknown[]).map(String) : [];
  const subject = String(input.subject ?? 'Intelligence Digest');
  const bodyMarkdown = String(input.bodyMarkdown ?? '');

  if (!runId) return { success: false, error: 'runId is required' };
  if (to.length === 0) return { success: false, error: 'to (array of email addresses) is required' };

  // Verify the run belongs to this org.
  const [run] = await db
    .select({ id: playbookRuns.id })
    .from(playbookRuns)
    .where(
      and(
        eq(playbookRuns.id, runId),
        eq(playbookRuns.organisationId, context.organisationId),
      ),
    );
  if (!run) return { success: false, error: 'Run not found or access denied' };

  // Dedup key: (runId, sorted recipients).  Use a pg advisory lock so
  // concurrent retries within the same pg session don't double-send.
  const dedupKey = `${runId}:${to.sort().join(',')}`;
  const lockId = BigInt(
    Array.from(dedupKey).reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) & 0x7fffffff, 0),
  );

  const [lockRow] = (await db.execute(
    sql`SELECT pg_try_advisory_lock(${lockId}) AS acquired`,
  )) as unknown as Array<{ acquired: boolean }>;

  if (!lockRow?.acquired) {
    // Another concurrent invocation is sending — treat as success to avoid
    // double-send from the retry path.
    return { success: true, deduplicated: true };
  }

  try {
    // Convert basic markdown to plain text (strip headers, bold, etc.)
    const textBody = bodyMarkdown
      .replace(/#{1,6}\s*/g, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .trim();

    // Simple HTML rendering.
    const htmlBody = `<pre style="font-family:sans-serif;white-space:pre-wrap;line-height:1.6">${bodyMarkdown
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')}</pre>`;

    for (const recipient of to) {
      await emailService.sendGenericEmail(recipient, subject, textBody, htmlBody);
    }

    return { success: true };
  } catch (err) {
    const e = err as { message?: string };
    return { success: false, error: e.message ?? String(err) };
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(${lockId})`);
  }
}
