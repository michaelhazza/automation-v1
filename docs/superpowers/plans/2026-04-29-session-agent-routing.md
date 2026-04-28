# Session Agent & Unified Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the GlobalAskBar's direct-to-brief flow with a session agent endpoint (`POST /api/session/message`) that resolves org/subaccount context via "change to X" prefix detection and ILIKE fuzzy matching, creates briefs in the correct context, and navigates to a brief viewer with a live delegation graph right panel.

**Architecture:** A new shared pure parser detects "change to [org/subaccount/client/company] X [, remainder]" prefix commands. A new `ScopeResolutionService` does ILIKE fuzzy search against orgs/subaccounts scoped to user permissions. `POST /api/session/message` handles the full state machine: detect command → fuzzy match → return disambiguation candidates (buttons) or resolve directly → create brief if there's a work request → client switches localStorage context and navigates to `/admin/briefs/:briefId`. The BriefDetailPage gains a right-hand live panel via the existing `DelegationGraphView` component.

**Tech Stack:** TypeScript, Express, Drizzle ORM (`ilike`, `eq`, `and`, `inArray`), React, `node:assert` + `npx tsx` for tests.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `shared/lib/parseContextSwitchCommand.ts` | Pure "change to X" parser — no deps, used by client and server |
| Create | `shared/lib/parseContextSwitchCommand.test.ts` | Unit tests for the parser |
| Create | `server/services/scopeResolutionService.ts` | ILIKE fuzzy search for orgs/subaccounts, permission-scoped |
| Create | `server/services/scopeResolutionService.test.ts` | Unit tests for pure helpers |
| Create | `server/routes/sessionMessage.ts` | `POST /api/session/message` handler |
| Modify | `server/routes/briefs.ts` | Add `GET /api/briefs/:briefId/active-run`; accept explicit title/description/priority on POST |
| Modify | `server/services/briefCreationService.ts` | Accept optional explicit `title`, `description`, `priority` |
| Modify | `server/index.ts` | Mount `sessionMessageRouter` |
| Modify | `client/src/components/global-ask-bar/GlobalAskBarPure.ts` | Add shared response types |
| Modify | `client/src/components/global-ask-bar/GlobalAskBar.tsx` | Call session/message, handle disambiguation state |
| Modify | `client/src/components/Layout.tsx` | New Brief modal: org/subaccount dropdowns, context switch on submit |
| Modify | `client/src/pages/BriefDetailPage.tsx` | Split-pane layout with live DelegationGraphView right panel |

---

## Task 1: Shared parser — `parseContextSwitchCommand`

**Files:**
- Create: `shared/lib/parseContextSwitchCommand.ts`
- Create: `shared/lib/parseContextSwitchCommand.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// shared/lib/parseContextSwitchCommand.test.ts
import { strict as assert } from 'node:assert';
import { parseContextSwitchCommand } from './parseContextSwitchCommand.js';

// positive — org synonyms
assert.deepStrictEqual(
  parseContextSwitchCommand('change to org Acme Pty Ltd'),
  { entityType: 'org', entityName: 'Acme Pty Ltd', remainder: null },
);
assert.deepStrictEqual(
  parseContextSwitchCommand('switch to organisation Acme, show me today\'s tasks'),
  { entityType: 'org', entityName: 'Acme', remainder: 'show me today\'s tasks' },
);
assert.deepStrictEqual(
  parseContextSwitchCommand('change to organization Acme'),
  { entityType: 'org', entityName: 'Acme', remainder: null },
);

// positive — subaccount synonyms
assert.deepStrictEqual(
  parseContextSwitchCommand('change to subaccount Sales Team, list all contacts'),
  { entityType: 'subaccount', entityName: 'Sales Team', remainder: 'list all contacts' },
);
assert.deepStrictEqual(
  parseContextSwitchCommand('change to sub-account Sales'),
  { entityType: 'subaccount', entityName: 'Sales', remainder: null },
);
assert.deepStrictEqual(
  parseContextSwitchCommand('change to client Breakout Solutions'),
  { entityType: 'subaccount', entityName: 'Breakout Solutions', remainder: null },
);
assert.deepStrictEqual(
  parseContextSwitchCommand('switch to company Acme'),
  { entityType: 'subaccount', entityName: 'Acme', remainder: null },
);

// positive — no type keyword (entityType: null)
assert.deepStrictEqual(
  parseContextSwitchCommand('change to Acme, show tasks'),
  { entityType: null, entityName: 'Acme', remainder: 'show tasks' },
);

// negative — not a switch command
assert.strictEqual(parseContextSwitchCommand('show me today\'s tasks'), null);
assert.strictEqual(parseContextSwitchCommand('what is the status of the global account?'), null);
assert.strictEqual(parseContextSwitchCommand('/remember do this'), null);

// case insensitive
assert.deepStrictEqual(
  parseContextSwitchCommand('CHANGE TO ORG Acme'),
  { entityType: 'org', entityName: 'Acme', remainder: null },
);

// "please" in the middle of the entity segment (before the comma) is stripped
assert.deepStrictEqual(
  parseContextSwitchCommand('change to Acme please, create a campaign'),
  { entityType: null, entityName: 'Acme', remainder: 'create a campaign' },
);

// filler prefix + trailing please
assert.deepStrictEqual(
  parseContextSwitchCommand('can you change to org Acme please'),
  { entityType: 'org', entityName: 'Acme', remainder: null },
);

console.log('All parseContextSwitchCommand tests passed.');
```

- [ ] **Step 2: Run — confirm it fails**

```
npx tsx shared/lib/parseContextSwitchCommand.test.ts
```
Expected: error — module not found.

- [ ] **Step 3: Implement the parser**

```typescript
// shared/lib/parseContextSwitchCommand.ts

export interface ContextSwitchCommand {
  entityType: 'org' | 'subaccount' | null; // null = ambiguous, let server decide
  entityName: string;
  remainder: string | null;
}

const SWITCH_VERBS = ['change to', 'switch to', 'go to', 'move to'];
// Longest synonyms first — prevents 'org' matching inside 'organisation'
const ORG_SYNONYMS = ['organisation', 'organization', 'org'];
const SUBACCOUNT_SYNONYMS = ['sub-account', 'subaccount', 'client', 'company'];

export function parseContextSwitchCommand(text: string): ContextSwitchCommand | null {
  // Strip trailing politeness and leading filler words so "can you change to Acme please" works
  const trimmed = text.trim()
    .replace(/\s+(please|thanks)\.?$/i, '')
    .replace(/^(can you|please|hey)\s+/i, '');
  const lower = trimmed.toLowerCase();

  for (const verb of SWITCH_VERBS) {
    if (!lower.startsWith(verb)) continue;

    const afterVerb = trimmed.slice(verb.length).trim();
    const afterVerbLower = afterVerb.toLowerCase();

    for (const synonym of ORG_SYNONYMS) {
      if (afterVerbLower.startsWith(synonym)) {
        const afterType = afterVerb.slice(synonym.length).trim();
        return splitEntityAndRemainder(afterType, 'org');
      }
    }

    for (const synonym of SUBACCOUNT_SYNONYMS) {
      if (afterVerbLower.startsWith(synonym)) {
        const afterType = afterVerb.slice(synonym.length).trim();
        return splitEntityAndRemainder(afterType, 'subaccount');
      }
    }

    // No type keyword — entityType null, server searches both
    return splitEntityAndRemainder(afterVerb, null);
  }

  return null;
}

function splitEntityAndRemainder(
  text: string,
  entityType: 'org' | 'subaccount' | null,
): ContextSwitchCommand {
  const commaIdx = text.indexOf(',');
  // Strip "please" from the entity segment only — handles "change to Acme please, do X"
  // where "please" sits between the name and the comma rather than at the end of the string.
  const rawEntity = commaIdx === -1 ? text : text.slice(0, commaIdx);
  const entityName = rawEntity.replace(/\bplease\b/gi, '').trim();
  if (commaIdx === -1) {
    return { entityType, entityName, remainder: null };
  }
  return {
    entityType,
    entityName,
    remainder: text.slice(commaIdx + 1).trim() || null,
  };
}
```

- [ ] **Step 4: Run tests — confirm pass**

```
npx tsx shared/lib/parseContextSwitchCommand.test.ts
```
Expected: `All parseContextSwitchCommand tests passed.`

- [ ] **Step 5: Commit**

```bash
git add shared/lib/parseContextSwitchCommand.ts shared/lib/parseContextSwitchCommand.test.ts
git commit -m "feat(routing): add parseContextSwitchCommand pure parser"
```

## Task 2: `ScopeResolutionService` — permission-scoped ILIKE fuzzy search

**Files:**
- Create: `server/services/scopeResolutionService.ts`
- Create: `server/services/scopeResolutionService.test.ts`

- [ ] **Step 1: Write the unit test (pure helpers only — no DB)**

```typescript
// server/services/scopeResolutionService.test.ts
import { strict as assert } from 'node:assert';
import { disambiguationQuestion, deduplicateCandidates, rankCandidates } from './scopeResolutionService.js';
import type { ScopeCandidate } from './scopeResolutionService.js';

// disambiguationQuestion
assert.strictEqual(
  disambiguationQuestion([
    { id: '1', name: 'Acme Pty Ltd', type: 'org' },
    { id: '2', name: 'Acme Holdings', type: 'org' },
  ]),
  'Which organisation did you mean?',
);
assert.strictEqual(
  disambiguationQuestion([
    { id: '1', name: 'Sales Team', type: 'subaccount' },
    { id: '2', name: 'Sales East', type: 'subaccount' },
  ]),
  'Which subaccount did you mean?',
);
assert.strictEqual(
  disambiguationQuestion([
    { id: '1', name: 'Acme', type: 'org' },
    { id: '2', name: 'Acme Sales', type: 'subaccount' },
  ]),
  'Which organisation or subaccount did you mean?',
);

// deduplicateCandidates
const dupes: ScopeCandidate[] = [
  { id: '1', name: 'Acme', type: 'org' },
  { id: '1', name: 'Acme', type: 'org' },
  { id: '2', name: 'Sales', type: 'subaccount' },
];
assert.deepStrictEqual(deduplicateCandidates(dupes), [
  { id: '1', name: 'Acme', type: 'org' },
  { id: '2', name: 'Sales', type: 'subaccount' },
]);

// rankCandidates — exact match floats to top; shorter name wins on tie
const unranked: ScopeCandidate[] = [
  { id: '3', name: 'Acme Holdings', type: 'org' },
  { id: '1', name: 'Acme', type: 'org' },
  { id: '2', name: 'Acme Pty Ltd', type: 'org' },
];
const ranked = rankCandidates(unranked, 'acme');
assert.strictEqual(ranked[0]!.name, 'Acme'); // exact match
assert.strictEqual(ranked[1]!.name, 'Acme Holdings'); // prefix, shorter
assert.strictEqual(ranked[2]!.name, 'Acme Pty Ltd'); // prefix, longer

// type bias — org wins over subaccount on equal score
const mixed: ScopeCandidate[] = [
  { id: '10', name: 'Acme', type: 'subaccount', orgName: 'Parent Co' },
  { id: '11', name: 'Acme', type: 'org' },
];
const mixedRanked = rankCandidates(mixed, 'acme');
assert.strictEqual(mixedRanked[0]!.type, 'org'); // org wins on score tie

console.log('All scopeResolutionService tests passed.');
```

- [ ] **Step 2: Run — confirm it fails**

```
npx tsx server/services/scopeResolutionService.test.ts
```
Expected: module not found.

- [ ] **Step 3: Implement the service**

```typescript
// server/services/scopeResolutionService.ts

import { ilike, eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { organisations, subaccounts } from '../db/schema/index.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';

export interface ScopeCandidate {
  id: string;
  name: string;
  type: 'org' | 'subaccount';
  orgName?: string; // parent org name for subaccounts — shown in disambiguation UI
}

export interface EntitySearchInput {
  hint: string;
  entityType: 'org' | 'subaccount' | null; // null = search both
  userRole: string;
  organisationId: string | null;
}

/**
 * ILIKE search for orgs/subaccounts matching `hint`, scoped to what the user
 * can see. system_admin sees all; others see only their own org and its subaccounts.
 *
 * NOTE: uses ILIKE %hint% for flexibility. At scale, switch to trigram index
 * (pg_trgm) or prefix-only search for index-backed performance.
 */
export async function findEntitiesMatching(input: EntitySearchInput): Promise<ScopeCandidate[]> {
  const { hint, entityType, userRole, organisationId } = input;
  // Escape ILIKE special chars to prevent pattern injection
  const pattern = `%${hint.trim().replace(/[%_\\]/g, '\\$&')}%`;
  const results: ScopeCandidate[] = [];
  const isSystemAdmin = userRole === 'system_admin';

  const searchOrgs = entityType === 'org' || entityType === null;
  const searchSubaccounts = entityType === 'subaccount' || entityType === null;

  if (searchOrgs) {
    const rows = isSystemAdmin
      ? await db
          .select({ id: organisations.id, name: organisations.name })
          .from(organisations)
          .where(ilike(organisations.name, pattern))
          .limit(10)
      : organisationId
      ? await db
          .select({ id: organisations.id, name: organisations.name })
          .from(organisations)
          .where(and(eq(organisations.id, organisationId), ilike(organisations.name, pattern)))
          .limit(1)
      : [];
    results.push(...rows.map((r) => ({ id: r.id, name: r.name, type: 'org' as const })));
  }

  if (searchSubaccounts) {
    // Join organisations to get parent org name for disambiguation display.
    // RLS via getOrgScopedDb restricts non-system-admin to their org's subaccounts.
    const subQuery = isSystemAdmin
      ? db
          .select({ id: subaccounts.id, name: subaccounts.name, orgName: organisations.name })
          .from(subaccounts)
          .innerJoin(organisations, eq(subaccounts.organisationId, organisations.id))
          .where(ilike(subaccounts.name, pattern))
          .limit(10)
      : getOrgScopedDb('scope_resolution')
          .select({ id: subaccounts.id, name: subaccounts.name, orgName: organisations.name })
          .from(subaccounts)
          .innerJoin(organisations, eq(subaccounts.organisationId, organisations.id))
          .where(ilike(subaccounts.name, pattern))
          .limit(10);
    const rows = await subQuery;
    results.push(...rows.map((r) => ({ id: r.id, name: r.name, type: 'subaccount' as const, orgName: r.orgName })));
  }

  return rankCandidates(deduplicateCandidates(results), hint);
}

// ── Pure helpers (exported for tests) ──────────────────────────────────────

// Single source of truth for candidate scoring — used by both rankCandidates and the route's
// auto-resolve logic. Exporting prevents the two from drifting independently.
export function scoreCandidate(c: ScopeCandidate, hint: string): number {
  const h = hint.toLowerCase();
  const n = c.name.toLowerCase();
  if (n === h) return 3;
  if (n.startsWith(h)) return 2;
  if (n.includes(h)) return 1;
  return 0;
}

export function rankCandidates(candidates: ScopeCandidate[], hint: string): ScopeCandidate[] {
  // Org wins over subaccount on equal score — matches user expectation for ambiguous input
  const typeWeight = (c: ScopeCandidate) => (c.type === 'org' ? 1 : 0);
  return [...candidates].sort(
    (a, b) =>
      scoreCandidate(b, hint) - scoreCandidate(a, hint) ||
      typeWeight(b) - typeWeight(a) ||
      a.name.length - b.name.length,
  );
}

export function deduplicateCandidates(candidates: ScopeCandidate[]): ScopeCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((c) => {
    const key = `${c.type}:${c.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function disambiguationQuestion(candidates: ScopeCandidate[]): string {
  const hasOrg = candidates.some((c) => c.type === 'org');
  const hasSub = candidates.some((c) => c.type === 'subaccount');
  if (hasOrg && hasSub) return 'Which organisation or subaccount did you mean?';
  if (hasOrg) return 'Which organisation did you mean?';
  return 'Which subaccount did you mean?';
}
```

- [ ] **Step 4: Run tests — confirm pass**

```
npx tsx server/services/scopeResolutionService.test.ts
```
Expected: `All scopeResolutionService tests passed.`

- [ ] **Step 5: Commit**

```bash
git add server/services/scopeResolutionService.ts server/services/scopeResolutionService.test.ts
git commit -m "feat(routing): add ScopeResolutionService with ILIKE fuzzy search"
```

## Task 3: Update `createBrief` — accept explicit title, description, priority

**Files:**
- Modify: `server/services/briefCreationService.ts`
- Modify: `server/routes/briefs.ts`

The New Brief modal has explicit title, description, and priority fields. `createBrief` currently derives everything from `text`. This task adds optional overrides and threads them through the route.

- [ ] **Step 1: Update `createBrief` in `briefCreationService.ts`**

Update the function signature (currently at line 14) to add three optional fields:

```typescript
export async function createBrief(input: {
  organisationId: string;
  subaccountId?: string;
  submittedByUserId: string;
  text: string;
  source: 'global_ask_bar' | 'slash_remember' | 'programmatic' | 'new_brief_modal';
  uiContext: BriefUiContext;
  explicitTitle?: string;
  explicitDescription?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
})
```

Replace the title derivation and task insert (lines ~33–46) with:

```typescript
  // When an explicit title is supplied (New Brief modal), use it as-is.
  // Otherwise derive from text with truncation.
  const title = input.explicitTitle
    ? input.explicitTitle
    : input.text.length > 100
    ? input.text.slice(0, 97) + '…'
    : input.text;

  // classifyChatIntent always receives the full free-text prompt.
  // For modal submissions combine title + description so the classifier
  // sees complete intent, not just the short title.
  const classifyText = input.explicitTitle
    ? [input.explicitTitle, input.explicitDescription].filter(Boolean).join('\n\n')
    : input.text;

  const fastPathDecision = await classifyChatIntent({
    text: classifyText,
    uiContext: input.uiContext,
    config: DEFAULT_CHAT_TRIAGE_CONFIG,
  });

  const [task] = await db
    .insert(tasks)
    .values({
      organisationId: input.organisationId,
      subaccountId: input.subaccountId ?? null,
      title,
      description: input.explicitDescription ?? input.text,
      status: 'inbox',
      priority: (input.priority ?? 'normal') as 'low' | 'normal' | 'high' | 'urgent',
      position: 0,
    })
    .returning();
```

Also update the `handleBriefMessage` call to pass `classifyText`:

```typescript
  await handleBriefMessage({
    conversationId: conversation.id,
    briefId,
    organisationId: input.organisationId,
    subaccountId: input.subaccountId,
    text: classifyText,          // ← was input.text
    uiContext: input.uiContext,
    isFollowUp: false,
    prefetchedDecision: fastPathDecision,
  });
```

- [ ] **Step 2: Update `POST /api/briefs` in `briefs.ts` to pass through the new fields**

Update the body destructure and validation in the `POST /api/briefs` handler:

```typescript
const {
  text, source, uiContext, subaccountId,
  explicitTitle, explicitDescription, priority,
} = req.body as {
  text?: string;
  source?: 'global_ask_bar' | 'slash_remember' | 'programmatic' | 'new_brief_modal';
  uiContext?: Partial<BriefUiContext>;
  subaccountId?: string;
  explicitTitle?: string;
  explicitDescription?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
};

// text is required unless an explicit title is provided
if (!text?.trim() && !explicitTitle?.trim()) {
  res.status(400).json({ message: 'text or explicitTitle is required' });
  return;
}
```

Update the `createBrief` call to pass the new fields:

```typescript
    const result = await createBrief({
      organisationId: req.orgId!,
      subaccountId: subaccountId ?? uiContext?.currentSubaccountId,
      submittedByUserId: req.user!.id,
      text: text?.trim() ?? explicitTitle!.trim(),
      source: source ?? 'global_ask_bar',
      uiContext: context,
      explicitTitle: explicitTitle?.trim(),
      explicitDescription: explicitDescription?.trim(),
      priority,
    });
```

- [ ] **Step 3: Typecheck**

```
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add server/services/briefCreationService.ts server/routes/briefs.ts
git commit -m "feat(routing): createBrief accepts explicit title/description/priority"
```

## Task 4: `POST /api/session/message` route + `GET /api/briefs/:briefId/active-run`

**Files:**
- Create: `server/routes/sessionMessage.ts`
- Modify: `server/index.ts` (mount router)
- Modify: `server/routes/briefs.ts` (add active-run endpoint)

### 4a — Session message route

- [ ] **Step 1: Create `server/routes/sessionMessage.ts`**

```typescript
// server/routes/sessionMessage.ts

import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { db } from '../db/index.js';
import { subaccounts } from '../db/schema/index.js';
import { parseContextSwitchCommand } from '../../shared/lib/parseContextSwitchCommand.js';
import { findEntitiesMatching, disambiguationQuestion, scoreCandidate } from '../services/scopeResolutionService.js';
import { createBrief } from '../services/briefCreationService.js';
import type { ScopeCandidate } from '../services/scopeResolutionService.js';
import type { Request } from 'express';

const router = Router();

interface SessionContext {
  activeOrganisationId: string | null;
  activeSubaccountId: string | null;
}

type SessionMessageResponse =
  | { type: 'disambiguation'; candidates: ScopeCandidate[]; question: string; remainder: string | null }
  | { type: 'context_switch'; organisationId: string | null; organisationName: string | null; subaccountId: string | null; subaccountName: string | null }
  | { type: 'brief_created'; briefId: string; conversationId: string; organisationId: string | null; organisationName: string | null; subaccountId: string | null; subaccountName: string | null }
  | { type: 'error'; message: string };

router.post(
  '/api/session/message',
  authenticate,
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
    console.info('session.message', {
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

      // Auto-resolve if only one candidate, or if the top-ranked candidate scores
      // strictly higher than the second (decisive match — no need to show disambiguation UI).
      // Uses the same scoreCandidate from the service so ranking and auto-resolve never drift.
      const shouldAutoResolve =
        candidates.length === 1 ||
        (candidates.length > 1 &&
          scoreCandidate(candidates[0]!, command.entityName) >
          scoreCandidate(candidates[1]!, command.entityName));
      console.info('session.message:resolved', {
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
    const organisationId = sessionContext.activeOrganisationId ?? req.orgId!;
    const subaccountId = sessionContext.activeSubaccountId ?? undefined;

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

  let resolvedOrgId: string | null;
  if (candidateType === 'org') {
    resolvedOrgId = candidateId;
  } else {
    // Do NOT assume req.orgId — the selected subaccount may belong to a different org
    const [sub] = await db
      .select({ organisationId: subaccounts.organisationId })
      .from(subaccounts)
      .where(eq(subaccounts.id, candidateId))
      .limit(1);
    // Hard fail — falling back to the wrong org would be a multi-tenant data integrity violation
    if (!sub?.organisationId) {
      return { type: 'error', message: 'Invalid subaccount selection — organisation not found.' };
    }
    resolvedOrgId = sub.organisationId;
  }
  const resolvedSubaccountId = candidateType === 'subaccount' ? candidateId : null;

  if (!remainder) {
    return {
      type: 'context_switch',
      organisationId: resolvedOrgId,
      organisationName: candidateType === 'org' ? candidateName : null,
      subaccountId: resolvedSubaccountId,
      subaccountName: candidateType === 'subaccount' ? candidateName : null,
    };
  }

  const result = await createBrief({
    organisationId: resolvedOrgId!,
    subaccountId: resolvedSubaccountId ?? undefined,
    submittedByUserId: req.user!.id,
    text: remainder,
    source: 'global_ask_bar',
    uiContext: {
      surface: 'global_ask_bar',
      currentOrgId: resolvedOrgId!,
      currentSubaccountId: resolvedSubaccountId ?? undefined,
      userPermissions: new Set<string>(),
    },
  });

  return {
    type: 'brief_created',
    briefId: result.briefId,
    conversationId: result.conversationId,
    organisationId: resolvedOrgId,
    organisationName: candidateType === 'org' ? candidateName : null,
    subaccountId: resolvedSubaccountId,
    subaccountName: candidateType === 'subaccount' ? candidateName : null,
  };
}

export default router;
```

- [ ] **Step 2: Mount the router in `server/index.ts`**

Find the line `import briefsRouter from './routes/briefs.js';` and add immediately after:

```typescript
import sessionMessageRouter from './routes/sessionMessage.js';
```

Find `app.use(briefsRouter);` and add immediately after:

```typescript
app.use(sessionMessageRouter);
```

### 4b — Active run endpoint

- [ ] **Step 3: Add `GET /api/briefs/:briefId/active-run` to `server/routes/briefs.ts`**

First check the existing imports at the top of `briefs.ts`. Add `agentRuns` and `inArray` if not already present:

```typescript
import { agentRuns } from '../db/schema/index.js';
import { eq, and, inArray } from 'drizzle-orm';
```

Then add the route after the existing `GET /api/briefs/:briefId` handler:

```typescript
// GET /api/briefs/:briefId/active-run — runId of the current in-flight agent
// run for this brief. BriefDetailPage polls this to wire the live graph panel.
router.get(
  '/api/briefs/:briefId/active-run',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.BRIEFS_READ),
  asyncHandler(async (req, res) => {
    const { briefId } = req.params;
    const tx = getOrgScopedDb('briefs.active_run');

    const [run] = await tx
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.taskId, briefId),
          eq(agentRuns.organisationId, req.orgId!),
          inArray(agentRuns.status, ['running', 'delegated', 'cancelling']),
        ),
      )
      .orderBy(agentRuns.createdAt)
      .limit(1);

    res.json({ runId: run?.id ?? null });
  }),
);
```

- [ ] **Step 4: Typecheck**

```
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add server/routes/sessionMessage.ts server/routes/briefs.ts server/index.ts
git commit -m "feat(routing): add POST /api/session/message and GET /api/briefs/:id/active-run"
```

## Task 5: GlobalAskBar — session/message flow + disambiguation UI

**Files:**
- Modify: `client/src/components/global-ask-bar/GlobalAskBarPure.ts`
- Modify: `client/src/components/global-ask-bar/GlobalAskBar.tsx`

- [ ] **Step 1: Add shared types to `GlobalAskBarPure.ts`**

Append to the end of `GlobalAskBarPure.ts`:

```typescript
export interface ScopeCandidate {
  id: string;
  name: string;
  type: 'org' | 'subaccount';
  orgName?: string; // parent org name for subaccounts — shown in disambiguation buttons
}

export type SessionMessageResponse =
  | { type: 'disambiguation'; candidates: ScopeCandidate[]; question: string; remainder: string | null }
  | { type: 'context_switch'; organisationId: string | null; organisationName: string | null; subaccountId: string | null; subaccountName: string | null }
  | { type: 'brief_created'; briefId: string; conversationId: string; organisationId: string | null; organisationName: string | null; subaccountId: string | null; subaccountName: string | null }
  | { type: 'error'; message: string };
```

- [ ] **Step 2: Rewrite `GlobalAskBar.tsx`**

Replace the full file content with:

```tsx
// client/src/components/global-ask-bar/GlobalAskBar.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api.js';
import { isValidBriefText, type ScopeCandidate, type SessionMessageResponse } from './GlobalAskBarPure.js';
import { getActiveOrgId, getActiveClientId, setActiveOrg, setActiveClient } from '../../lib/auth.js';

type DisambiguationState = {
  candidates: ScopeCandidate[];
  question: string;
  remainder: string | null;
};

interface GlobalAskBarProps {
  placeholder?: string;
}

export default function GlobalAskBar({ placeholder }: GlobalAskBarProps) {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [disambiguation, setDisambiguation] = useState<DisambiguationState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleResponse = (data: SessionMessageResponse) => {
    if (data.type === 'error') {
      setError(data.message);
      return;
    }
    if (data.type === 'disambiguation') {
      setDisambiguation({ candidates: data.candidates, question: data.question, remainder: data.remainder });
      return;
    }
    // context_switch and brief_created both carry resolved context — apply it
    if (data.organisationId && data.organisationName) {
      setActiveOrg(data.organisationId, data.organisationName);
    }
    if (data.subaccountId && data.subaccountName) {
      setActiveClient(data.subaccountId, data.subaccountName);
    }
    setText('');
    setDisambiguation(null);
    setError(null);
    if (data.type === 'brief_created') {
      navigate(`/admin/briefs/${data.briefId}`);
    }
  };

  const post = async (payload: Record<string, unknown>) => {
    setIsSubmitting(true);
    setError(null);
    try {
      const { data } = await api.post<SessionMessageResponse>('/api/session/message', {
        sessionContext: {
          activeOrganisationId: getActiveOrgId(),
          activeSubaccountId: getActiveClientId(),
        },
        ...payload,
      });
      handleResponse(data);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidBriefText(text) || isSubmitting) return;
    void post({ text: text.trim() });
  };

  const handleCandidateSelect = (candidate: ScopeCandidate) => {
    void post({
      selectedCandidateId: candidate.id,
      selectedCandidateName: candidate.name,
      selectedCandidateType: candidate.type,
      pendingRemainder: disambiguation?.remainder ?? null,
    });
  };

  return (
    <div className="w-full">
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => { setText(e.target.value); setDisambiguation(null); setError(null); }}
          placeholder={placeholder ?? 'Ask anything…'}
          disabled={isSubmitting}
          className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!isValidBriefText(text) || isSubmitting}
          className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-40"
        >
          {isSubmitting ? '…' : 'Send'}
        </button>
      </form>

      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

      {disambiguation && (
        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="text-sm text-gray-700 mb-2">{disambiguation.question}</p>
          <div className="flex flex-wrap gap-2">
            {disambiguation.candidates.map((c) => (
              <button
                key={`${c.type}:${c.id}`}
                onClick={() => handleCandidateSelect(c)}
                disabled={isSubmitting}
                className="px-3 py-1.5 text-sm rounded-md border border-indigo-300 text-indigo-700 bg-white hover:bg-indigo-50 disabled:opacity-40"
              >
                {c.name}
                <span className="ml-1.5 text-xs text-gray-400">
                  ({c.type === 'org' ? 'org' : `subaccount${c.orgName ? ` — ${c.orgName}` : ''}`})
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + build client**

```
npx tsc --noEmit
npm run build:client
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/global-ask-bar/GlobalAskBar.tsx client/src/components/global-ask-bar/GlobalAskBarPure.ts
git commit -m "feat(routing): GlobalAskBar uses session/message with inline disambiguation"
```

## Task 6: New Brief modal — org/subaccount dropdowns + context switch on submit

**Files:**
- Modify: `client/src/components/Layout.tsx`

The New Brief modal lives around lines 1189–1243. It currently POSTs to `/api/subaccounts/{activeClientId}/tasks`. We replace that with `POST /api/briefs` using explicit fields, and add optional org/subaccount dropdowns.

> **Before implementing:** Read the Layout.tsx modal section (lines 1189–1243) and the submit handler. Confirm: (a) variable names for the org list and client list (may be `orgs`/`clients`, `organisations`/`subaccounts`, etc.); (b) that `handleSelectOrg` and `handleSelectClient` exist and their signatures; (c) that `navigate` from react-router-dom is in scope. Match what you find exactly.

- [ ] **Step 1: Add state for override org/subaccount**

Inside `Layout`, alongside the `showNewBrief` state declaration, add:

```typescript
const [briefOrgId, setBriefOrgId] = useState<string | null>(null);
const [briefOrgName, setBriefOrgName] = useState<string | null>(null);
const [briefSubaccountId, setBriefSubaccountId] = useState<string | null>(null);
const [briefSubaccountName, setBriefSubaccountName] = useState<string | null>(null);
```

- [ ] **Step 2: Pre-fill overrides when the modal opens**

Replace the call to `setShowNewBrief(true)` (wherever the New Brief button is clicked) with a handler that pre-fills from the current session:

```typescript
const handleOpenNewBrief = () => {
  setBriefOrgId(activeOrgId);
  setBriefOrgName(activeOrgName);
  setBriefSubaccountId(activeClientId);
  setBriefSubaccountName(activeClientName);
  setShowNewBrief(true);
};
```

Update the button's `onClick` to call `handleOpenNewBrief`.

- [ ] **Step 3: Replace the modal submit handler**

Replace the existing submit handler in the New Brief modal with:

```typescript
const handleNewBriefSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  const form = e.currentTarget;
  const titleEl = form.elements.namedItem('title') as HTMLInputElement;
  const descriptionEl = form.elements.namedItem('description') as HTMLTextAreaElement;
  const priorityEl = form.elements.namedItem('priority') as HTMLSelectElement;

  const title = titleEl.value.trim();
  const description = descriptionEl.value.trim();
  const priority = priorityEl.value as 'low' | 'normal' | 'high' | 'urgent';
  if (!title) return;

  const targetOrgId = briefOrgId ?? activeOrgId;
  const targetSubaccountId = briefSubaccountId ?? activeClientId ?? undefined;

  try {
    const res = await api.post<{ briefId: string; conversationId: string }>(
      '/api/briefs',
      {
        text: [title, description].filter(Boolean).join('\n\n'),
        explicitTitle: title,
        explicitDescription: description || undefined,
        priority,
        source: 'new_brief_modal',
        subaccountId: targetSubaccountId,
        uiContext: { surface: 'new_brief_modal', currentSubaccountId: targetSubaccountId },
      },
      targetOrgId && targetOrgId !== activeOrgId
        ? { headers: { 'X-Organisation-Id': targetOrgId } }
        : undefined,
    );

    // Switch context if user chose a different org or subaccount
    if (briefOrgId && briefOrgId !== activeOrgId && briefOrgName) {
      handleSelectOrg(briefOrgId, briefOrgName);
    }
    if (briefSubaccountId && briefSubaccountId !== activeClientId && briefSubaccountName) {
      handleSelectClient(briefSubaccountId, briefSubaccountName);
    }

    setShowNewBrief(false);
    navigate(`/admin/briefs/${res.data.briefId}`);
  } catch {
    // Add a brief error state near the modal if one doesn't exist — console.error for now
    console.error('Failed to create brief');
  }
};
```

Update the form's `onSubmit`:
```tsx
<form onSubmit={(e) => { void handleNewBriefSubmit(e); }}>
```

- [ ] **Step 4: Add org/subaccount dropdowns to the modal JSX**

Inside the modal form, after the Priority `<select>` and before the Cancel/Create buttons, add:

```tsx
{/* Org override — system admins only, when multiple orgs exist */}
{user.role === 'system_admin' && orgs.length > 1 && (
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-1">
      Organisation <span className="text-gray-400 font-normal">(optional)</span>
    </label>
    <select
      value={briefOrgId ?? ''}
      onChange={(e) => {
        const selected = orgs.find((o: { id: string }) => o.id === e.target.value);
        setBriefOrgId(selected?.id ?? null);
        setBriefOrgName(selected?.name ?? null);
        setBriefSubaccountId(null);
        setBriefSubaccountName(null);
      }}
      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
    >
      <option value="">Use current organisation</option>
      {orgs.map((o: { id: string; name: string }) => (
        <option key={o.id} value={o.id}>{o.name}</option>
      ))}
    </select>
  </div>
)}

{/* Subaccount override */}
{clients.length > 0 && (
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-1">
      Subaccount <span className="text-gray-400 font-normal">(optional)</span>
    </label>
    <select
      value={briefSubaccountId ?? ''}
      onChange={(e) => {
        const selected = clients.find((c: { id: string }) => c.id === e.target.value);
        setBriefSubaccountId(selected?.id ?? null);
        setBriefSubaccountName(selected?.name ?? null);
      }}
      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
    >
      <option value="">Use current subaccount</option>
      {clients.map((c: { id: string; name: string }) => (
        <option key={c.id} value={c.id}>{c.name}</option>
      ))}
    </select>
  </div>
)}
```

> **Note:** Replace `orgs` / `clients` with whatever variable names Layout.tsx actually uses for the org list and client/subaccount list. Also replace the inline `{ id: string; name: string }` type annotations with the actual types if they are already defined.

- [ ] **Step 5: Typecheck + build**

```
npx tsc --noEmit
npm run build:client
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/Layout.tsx
git commit -m "feat(routing): New Brief modal adds org/subaccount dropdowns + context switch on submit"
```

## Task 7: BriefDetailPage — live delegation graph right panel

**Files:**
- Modify: `client/src/pages/BriefDetailPage.tsx`

`DelegationGraphView` already accepts `runId` as a prop (`interface DelegationGraphViewProps { runId: string }`). It uses `useParams` only to resolve navigation targets on node click — when `subaccountId` is undefined it falls back to `/run-trace/:runId`, which is fine when embedded in BriefDetailPage.

- [ ] **Step 1: Add import and state**

Add to imports at the top of `BriefDetailPage.tsx`:

```typescript
import { useState, useEffect, useRef } from 'react';
import DelegationGraphView from '../components/run-trace/DelegationGraphView.js';
```

Add state and ref after existing state declarations inside the component:

```typescript
const [activeRunId, setActiveRunId] = useState<string | null>(null);
const [showGraph, setShowGraph] = useState(true);
// Ref avoids stale closure inside the polling timer callbacks
const activeRunIdRef = useRef<string | null>(null);
```

Add a sync effect to keep the ref current:

```typescript
useEffect(() => {
  activeRunIdRef.current = activeRunId;
}, [activeRunId]);
```

- [ ] **Step 2: Add active-run fetch + polling effect**

Add a `useEffect` after the existing `useEffect(() => { void load(); }, [load]);` line:

```typescript
useEffect(() => {
  if (!briefId) return;
  let cancelled = false;

  const fetchActiveRun = async () => {
    try {
      const { data } = await api.get<{ runId: string | null }>(
        `/api/briefs/${briefId}/active-run`,
      );
      if (!cancelled) setActiveRunId(data.runId);
    } catch {
      // non-fatal — graph panel stays hidden
    }
  };

  // Exponential backoff: first check at 500 ms, doubles each time up to 4 s max.
  // Gives fast perceived responsiveness without hammering the server.
  let delay = 500;
  let timer: ReturnType<typeof setTimeout>;
  const schedule = () => {
    timer = setTimeout(async () => {
      if (cancelled || activeRunIdRef.current) return;
      await fetchActiveRun();
      delay = Math.min(delay * 2, 4000);
      schedule();
    }, delay);
  };
  void fetchActiveRun();
  schedule();

  return () => { cancelled = true; clearTimeout(timer); };
}, [briefId]); // activeRunId intentionally omitted — read via ref to avoid timer restart
```

- [ ] **Step 3: Replace the return JSX with a split-pane layout**

Replace the entire return block (from `return (` to the final `);`) with:

```tsx
  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading…</div>;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumb */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 text-sm">
        <Link to="/" className="text-gray-400 hover:text-gray-600">Briefs</Link>
        {brief?.title && <><span className="text-gray-300">/</span><span className="text-gray-600 truncate">{brief.title}</span></>}
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Left — chat panel */}
        <div className={`flex flex-col min-h-0 transition-all ${activeRunId && showGraph ? 'w-1/2 border-r border-gray-100' : 'w-full max-w-3xl mx-auto'}`}>
          <div className="px-4 pt-4 pb-2 shrink-0">
            <h1 className="text-lg font-semibold text-gray-900">{brief?.title ?? 'Brief'}</h1>
            {brief?.status && <span className="text-xs text-gray-500">{briefStatusLabel(brief.status)}</span>}
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">
            {messages.map((msg: ConversationMessage) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-xl rounded-lg px-4 py-2 text-sm ${msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-900'}`}>
                  {msg.content}
                </div>
              </div>
            ))}

            {artefacts.length > 0 && (
              <div className="space-y-3">
                {nextCursor !== null && (
                  <div className="text-center py-2">
                    <button
                      onClick={() => { void handleLoadOlder(); }}
                      disabled={isLoadingOlder}
                      className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-40"
                    >
                      {isLoadingOlder ? 'Loading…' : 'Load older artefacts'}
                    </button>
                  </div>
                )}
                {artefacts.map((a: BriefChatArtefact) => (
                  <ArtefactItem
                    key={a.artefactId}
                    artefact={a}
                    isSuperseded={supersededIds.has(a.artefactId)}
                    onSuggestionClick={handleSuggestionClick}
                    onApprove={handleApprove}
                    onReject={handleReject}
                  />
                ))}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form onSubmit={handleSendReply} className="px-4 py-3 border-t border-gray-100 flex items-center gap-2 shrink-0">
            <input
              type="text"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Follow up…"
              disabled={isSending}
              className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={!reply.trim() || isSending}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-40"
            >
              Send
            </button>
          </form>
        </div>

        {/* Right — live delegation graph */}
        {activeRunId && showGraph && (
          <div className="w-1/2 flex flex-col min-h-0 bg-gray-50">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Live View</span>
                <span className="flex items-center gap-1 text-xs text-indigo-500">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse inline-block" />
                  updating
                </span>
              </div>
              <button
                onClick={() => setShowGraph(false)}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none"
                aria-label="Close graph"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <DelegationGraphView runId={activeRunId} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
```

> **Note:** The existing `isLoading` early return guard is already in the file — move it above the new return block rather than duplicating it.

- [ ] **Step 4: Typecheck + build**

```
npx tsc --noEmit
npm run build:client
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/BriefDetailPage.tsx
git commit -m "feat(routing): BriefDetailPage split-pane with live DelegationGraphView"
```

## Self-Review

### Spec coverage

| Requirement | Task |
|---|---|
| "change to org/organisation/organization X" detection | Task 1 |
| "change to subaccount/sub-account/client/company X" | Task 1 |
| Remainder text ("change to X, do Y") split correctly | Task 1 |
| ILIKE fuzzy search scoped to user permissions | Task 2 |
| `disambiguationQuestion` returns correct label | Task 2 |
| `createBrief` accepts explicit title/description/priority | Task 3 |
| `POST /api/briefs` passes new fields through | Task 3 |
| `POST /api/session/message` — Path A (button resolution) | Task 4 |
| `POST /api/session/message` — Path B ("change to" command) | Task 4 |
| `POST /api/session/message` — Path C (plain brief) | Task 4 |
| `GET /api/briefs/:briefId/active-run` endpoint | Task 4 |
| Route mounted in `server/index.ts` | Task 4 |
| GlobalAskBar calls session/message (not /api/briefs directly) | Task 5 |
| Inline disambiguation UI with candidate buttons | Task 5 |
| `setActiveOrg`/`setActiveClient` called before navigate | Task 5 |
| New Brief modal org dropdown (system admin only) | Task 6 |
| New Brief modal subaccount dropdown | Task 6 |
| New Brief modal context switch before navigate | Task 6 |
| BriefDetailPage split-pane layout | Task 7 |
| DelegationGraphView wired with runId prop | Task 7 |
| 4 s polling until runId is available | Task 7 |
| Graph panel closeable via × button | Task 7 |

### Placeholder scan

No TBDs, TODOs, or "similar to Task N" references. All steps contain complete code.

### Type consistency

- `ScopeCandidate` defined in `scopeResolutionService.ts`; re-declared in `GlobalAskBarPure.ts` with identical shape — both have `{ id: string; name: string; type: 'org' | 'subaccount' }`.
- `SessionMessageResponse` in `GlobalAskBar.tsx` matches the union returned by `sessionMessage.ts`.
- `explicitTitle`/`explicitDescription`/`priority` added to `createBrief` input type in Task 3 and passed through `briefs.ts` route — consistent across Tasks 3 and 6.
- `activeRunId: string | null` in BriefDetailPage; `DelegationGraphView` receives `runId={activeRunId}` only when `activeRunId` is non-null — type safe.

### Known implementation notes

1. **Layout.tsx variable names:** The modal dropdowns reference `orgs` and `clients`. Confirm the actual variable names in Layout.tsx before implementing Task 6 — they may differ.
2. **`agentRuns` import in `briefs.ts`:** Check whether `agentRuns` is already imported from `../db/schema/index.js` before adding it in Task 4.
3. **`isLoading` guard in BriefDetailPage:** The existing early return for `isLoading` must be moved above the new split-pane return, not duplicated.
4. **`DelegationGraphView` node navigation:** When embedded in BriefDetailPage, `useParams` returns `undefined` for `subaccountId`, so node clicks navigate to `/run-trace/:runId`. This is correct fallback behaviour — no change needed.
