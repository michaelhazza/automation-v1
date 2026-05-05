import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { memoryBlocks } from '../db/schema/index.js';
import { writeVersionRow } from './memoryBlockVersionService.js';
import { check as checkConflicts } from './ruleConflictDetectorService.js';
import { shouldAutoPauseRulePure } from './ruleCapturePolicyPure.js';
import type {
  RuleCaptureRequest,
  RuleScope,
  SaveRuleResult,
} from '../../shared/types/briefRules.js';

function scopeToFields(scope: RuleScope): {
  subaccountId: string | null;
  ownerAgentId: string | null;
} {
  switch (scope.kind) {
    case 'subaccount':
      return { subaccountId: scope.subaccountId, ownerAgentId: null };
    case 'agent':
      return { subaccountId: null, ownerAgentId: scope.agentId };
    case 'org':
      return { subaccountId: null, ownerAgentId: null };
  }
}

/**
 * Phase 5 / W3a — saves a user-captured rule to memory_blocks.
 * Conflict detection is wired to a named no-op stub; Phase 6 replaces the
 * stub implementation without touching this call site.
 */
export async function saveRule(
  request: RuleCaptureRequest,
  ctx: { userId: string; organisationId: string },
  options: { allowConflicts?: boolean } = {},
): Promise<SaveRuleResult> {
  const conflicts = await checkConflicts(request);

  if (conflicts.conflicts.length > 0 && !options.allowConflicts) {
    return {
      ruleId: '',
      conflicts,
      saved: false,
    };
  }

  const { subaccountId, ownerAgentId } = scopeToFields(request.scope);

  const autoPause = shouldAutoPauseRulePure({
    originatingArtefactId: request.originatingArtefactId,
    confidence: request.confidence,
  });

  const [inserted] = await db
    .insert(memoryBlocks)
    .values({
      organisationId: ctx.organisationId,
      subaccountId,
      ownerAgentId,
      name: request.text.slice(0, 255),
      content: request.text,
      source: 'manual',
      capturedVia: request.originatingArtefactId ? 'approval_suggestion' : 'user_triggered',
      priority: request.priority ?? 'medium',
      isAuthoritative: request.isAuthoritative ?? false,
      // Policy-driven pause: approval-suggested rules or low-confidence captures
      // start in pending_review; everything else goes active immediately.
      status: autoPause ? 'pending_review' : 'active',
      isReadOnly: false,
    })
    .returning({ id: memoryBlocks.id, content: memoryBlocks.content });

  await writeVersionRow({
    blockId: inserted.id,
    content: inserted.content,
    changeSource: 'manual_edit',
    actorUserId: ctx.userId,
    notes: request.context,
  });

  return {
    ruleId: inserted.id,
    conflicts: { conflicts: [], checkedAt: new Date().toISOString() },
    saved: true,
  };
}
