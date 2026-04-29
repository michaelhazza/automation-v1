// server/routes/sessionMessage.ts

import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { logger } from '../lib/logger.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { parseContextSwitchCommand } from '../../shared/lib/parseContextSwitchCommand.js';
import { findEntitiesMatching, disambiguationQuestion, isTopCandidateDecisive, resolveCandidateScope } from '../services/scopeResolutionService.js';
import { createBrief } from '../services/briefCreationService.js';
import { check as rateLimitCheck, setRateLimitDeniedHeaders } from '../lib/inboundRateLimiter.js';
import { rateLimitKeys } from '../lib/rateLimitKeys.js';
import type { ScopeCandidate } from '../services/scopeResolutionService.js';
import type { BriefCreationEnvelope } from '../../shared/types/briefFastPath.js';
import type { Request } from 'express';

const router = Router();

interface SessionContext {
  activeOrganisationId: string | null;
  activeSubaccountId: string | null;
}

type SessionMessageResponse =
  | { type: 'disambiguation'; candidates: ScopeCandidate[]; question: string; remainder: string | null }
  | { type: 'context_switch'; organisationId: string | null; organisationName: string | null; subaccountId: string | null; subaccountName: string | null }
  | ({ type: 'brief_created' } & BriefCreationEnvelope)
  | { type: 'error'; message: string };

router.post(
  '/api/session/message',
  authenticate,
  // Rate-limit BEFORE permission check: 401 → 429 → 403 ordering invariant (spec §6.1)
  asyncHandler(async (req, res, next) => {
    const limitResult = await rateLimitCheck(rateLimitKeys.sessionMessage(req.user!.id), 30, 60);
    if (!limitResult.allowed) {
      setRateLimitDeniedHeaders(res, limitResult.resetAt);
      res.status(429).json({ type: 'error', message: 'Too many requests, please slow down.' });
      return;
    }
    next();
  }),
  // Path B (with remainder) and Path C both call createBrief; gate the route on the
  // same BRIEFS_WRITE permission /api/briefs enforces so read-only users cannot
  // create briefs through GlobalAskBar.
  requireOrgPermission(ORG_PERMISSIONS.BRIEFS_WRITE),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      text?: string;
      sessionContext?: SessionContext;
      selectedCandidateId?: string;
      selectedCandidateName?: string;
      selectedCandidateType?: 'org' | 'subaccount';
      pendingRemainder?: string | null;
    };

    const sessionContext: SessionContext = body.sessionContext ?? {
      activeOrganisationId: null,
      activeSubaccountId: null,
    };

    // ── Path A: user clicked a disambiguation button ──────────────────────
    if (body.selectedCandidateId && body.selectedCandidateName && body.selectedCandidateType) {
      // Reject malformed enum values before they reach the resolver — keeps
      // the candidateType branch in resolveCandidateScope total.
      if (body.selectedCandidateType !== 'org' && body.selectedCandidateType !== 'subaccount') {
        res.status(400).json({ type: 'error', message: 'invalid selectedCandidateType' });
        return;
      }
      const result = await resolveAndCreate({
        candidateId: body.selectedCandidateId,
        candidateName: body.selectedCandidateName,
        candidateType: body.selectedCandidateType,
        remainder: body.pendingRemainder ?? null,
        req,
      });
      res.json(result);
      return;
    }

    const text = body.text?.trim();
    if (!text) {
      res.status(400).json({ type: 'error', message: 'text is required' });
      return;
    }

    // ── Path B: "change to X [, remainder]" command ───────────────────────
    const command = parseContextSwitchCommand(text);
    logger.info('session.message', {
      userId: req.user!.id,
      commandDetected: !!command,
      entityType: command?.entityType ?? null,
      entityName: command?.entityName ?? null,
    });
    if (command) {
      if (!command.entityName || command.entityName.length < 2) {
        res.json({
          type: 'error',
          message: 'Please specify a valid organisation or subaccount name.',
        });
        return;
      }

      const candidates = await findEntitiesMatching({
        hint: command.entityName,
        entityType: command.entityType,
        userRole: req.user!.role,
        organisationId: req.orgId ?? req.user!.organisationId ?? null,
      });

      if (candidates.length === 0) {
        res.json({
          type: 'error',
          message: `No matching organisation or subaccount found for "${command.entityName}".`,
        } satisfies SessionMessageResponse);
        return;
      }

      // Auto-resolve when the top candidate decisively beats the second (single
      // result, strictly higher score, or tied score with a different type).
      // Routed through isTopCandidateDecisive so ranking and auto-resolve share a
      // primitive — previously the auto-resolve check considered score only, while
      // ranking used score+typeWeight, leaving disambiguation UI surfaced for cases
      // ranking would have decided deterministically.
      const shouldAutoResolve = isTopCandidateDecisive(candidates, command.entityName);
      logger.info('session.message.resolved', {
        candidatesCount: candidates.length,
        autoResolved: shouldAutoResolve,
        topCandidate: candidates[0] ? { id: candidates[0].id, type: candidates[0].type } : null,
      });

      if (shouldAutoResolve) {
        const result = await resolveAndCreate({
          candidateId: candidates[0]!.id,
          candidateName: candidates[0]!.name,
          candidateType: candidates[0]!.type,
          remainder: command.remainder,
          req,
        });
        res.json(result);
        return;
      }

      res.json({
        type: 'disambiguation',
        candidates,
        question: disambiguationQuestion(candidates),
        remainder: command.remainder,
      } satisfies SessionMessageResponse);
      return;
    }

    // ── Path C: plain brief submission ────────────────────────────────────
    // Use req.orgId (set by authenticate middleware from the user's auth or
    // the X-Organisation-Id header for admins) as the canonical org. Never
    // trust sessionContext.activeOrganisationId from the body — it would
    // bypass the cross-org audit log and let any client write into any org.
    const organisationId = req.orgId!;
    // Cross-entity verification (DEVELOPMENT_GUIDELINES §9): a body-supplied
    // subaccount id must belong to the resolved org before we write tasks.
    // After an org-only context switch the GlobalAskBar can retain a stale
    // activeSubaccountId in localStorage — silently drop it (and log for
    // observability) instead of returning 404, so the user can still submit
    // an org-scoped brief.
    let subaccountId: string | undefined = sessionContext.activeSubaccountId ?? undefined;
    if (subaccountId) {
      try {
        await resolveSubaccount(subaccountId, organisationId);
      } catch (err) {
        const statusCode = (err as { statusCode?: number } | null)?.statusCode;
        if (statusCode !== 404) throw err;
        logger.warn('session.message.stale_subaccount_dropped', {
          userId: req.user!.id,
          organisationId,
          suppliedSubaccountId: subaccountId,
        });
        subaccountId = undefined;
      }
    }

    const result = await createBrief({
      organisationId,
      subaccountId,
      submittedByUserId: req.user!.id,
      text,
      source: 'global_ask_bar',
      uiContext: {
        surface: 'global_ask_bar',
        currentOrgId: organisationId,
        currentSubaccountId: subaccountId,
        userPermissions: new Set<string>(),
      },
    });

    res.status(201).json({
      type: 'brief_created',
      briefId: result.briefId,
      conversationId: result.conversationId,
      fastPathDecision: result.fastPathDecision,
      organisationId,
      organisationName: null,
      subaccountId: subaccountId ?? null,
      subaccountName: null,
    } satisfies SessionMessageResponse);
  }),
);

async function resolveAndCreate(opts: {
  candidateId: string;
  candidateName: string;
  candidateType: 'org' | 'subaccount';
  remainder: string | null;
  req: Request;
}): Promise<SessionMessageResponse> {
  const { candidateId, candidateName, candidateType, remainder, req } = opts;

  // Re-validate authorisation server-side. The disambiguation UI presents only
  // candidates the user can see, but the client controls the POST payload —
  // without this check, a non-admin could submit any orgId/subaccountId UUID
  // and create a brief in another tenant.
  const resolved = await resolveCandidateScope({
    candidateId,
    candidateType,
    userRole: req.user!.role,
    userOrganisationId: req.user!.organisationId ?? req.orgId ?? null,
  });
  if (!resolved) {
    return { type: 'error', message: 'Invalid selection — organisation or subaccount not accessible.' };
  }
  const resolvedOrgId = resolved.resolvedOrgId;
  const resolvedSubaccountId = resolved.resolvedSubaccountId;
  // For an org candidate, the candidate name IS the org name. For a
  // subaccount candidate, the parent org name comes from the resolver join.
  const resolvedOrgName = candidateType === 'org' ? candidateName : resolved.resolvedOrgName;

  if (!remainder) {
    return {
      type: 'context_switch',
      organisationId: resolvedOrgId,
      organisationName: resolvedOrgName,
      subaccountId: resolvedSubaccountId,
      subaccountName: candidateType === 'subaccount' ? candidateName : null,
    };
  }

  const result = await createBrief({
    organisationId: resolvedOrgId,
    subaccountId: resolvedSubaccountId ?? undefined,
    submittedByUserId: req.user!.id,
    text: remainder,
    source: 'global_ask_bar',
    uiContext: {
      surface: 'global_ask_bar',
      currentOrgId: resolvedOrgId,
      currentSubaccountId: resolvedSubaccountId ?? undefined,
      userPermissions: new Set<string>(),
    },
  });

  return {
    type: 'brief_created',
    briefId: result.briefId,
    conversationId: result.conversationId,
    fastPathDecision: result.fastPathDecision,
    organisationId: resolvedOrgId,
    organisationName: resolvedOrgName,
    subaccountId: resolvedSubaccountId,
    subaccountName: candidateType === 'subaccount' ? candidateName : null,
  };
}

export default router;
