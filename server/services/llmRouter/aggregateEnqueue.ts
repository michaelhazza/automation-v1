import { db } from '../../db/index.js';
import { llmRequests } from '../../db/schema/index.js';
import { eq } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Enqueue aggregate update via pg-boss (or in-memory fallback)
// ---------------------------------------------------------------------------

export async function enqueueAggregateUpdate(idempotencyKey: string): Promise<void> {
  try {
    const { routerJobService } = await import('../routerJobService.js');
    await routerJobService.enqueueAggregateUpdate(idempotencyKey);
  } catch {
    // Fallback: run synchronously if queue service unavailable
    // guard-ignore: with-org-tx-or-scoped-db reason="cross-tenant/admin operation — fallback aggregate enqueue runs outside request context"
    const [request] = await db
      .select()
      .from(llmRequests)
      .where(eq(llmRequests.idempotencyKey, idempotencyKey))
      .limit(1);

    if (request) {
      const { costAggregateService } = await import('../costAggregateService.js');
      await costAggregateService.upsertAggregates(request);
    }
  }
}
