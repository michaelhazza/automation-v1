# Skill Analyzer UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current card-per-skill layout with a compact list+expand design featuring four colour-coded section bands, a new page header, and an inline diff legend.

**Architecture:** Pure frontend change — no API or data model changes. `SkillAnalyzerResultsStep.tsx` gets a full layout rewrite (sections, rows, page header). `MergeReviewBlock.tsx` gets a diff legend prepended above the field list. All new styles are Tailwind utility classes; no new CSS files or component files.

**Tech Stack:** React, TypeScript, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-04-13-skill-analyzer-ux-redesign.md`

---

## Files

| File | Change |
|------|--------|
| `client/src/components/skill-analyzer/SkillAnalyzerResultsStep.tsx` | Full layout rewrite |
| `client/src/components/skill-analyzer/MergeReviewBlock.tsx` | Add diff legend above field list |

---

## Table of Contents

- [Task 1: Update SECTION_CONFIG and section order](#task-1)
- [Task 2: New page header](#task-2)
- [Task 3: Redesign ResultSection with coloured band header](#task-3)
- [Task 4: Replace ResultCard with ResultRow expand/collapse](#task-4)
- [Task 5: Add diff legend to MergeReviewBlock](#task-5)
- [Task 6: Smoke test checklist](#task-6)

---

## Task 1: Update SECTION_CONFIG and section order {#task-1}

**Files:**
- Modify: `client/src/components/skill-analyzer/SkillAnalyzerResultsStep.tsx:20-57` (SECTION_CONFIG)
- Modify: `client/src/components/skill-analyzer/SkillAnalyzerResultsStep.tsx:593` (CLASSIFICATIONS array)

- [ ] **Step 1: Replace the SECTION_CONFIG type and values**

Replace lines 20–57 in `SkillAnalyzerResultsStep.tsx` with:

```typescript
type Classification = 'DUPLICATE' | 'IMPROVEMENT' | 'PARTIAL_OVERLAP' | 'DISTINCT';

const SECTION_CONFIG: Record<Classification, {
  label: string;
  dot: string;         // Tailwind bg-* class for the section dot
  bandBg: string;      // hex colour for header band background
  bandBorder: string;  // hex colour for header band bottom border
  badgeBg: string;     // hex colour for count badge background
  badgeText: string;   // hex colour for count badge text
  defaultOpen: boolean;
}> = {
  PARTIAL_OVERLAP: {
    label: 'Partial Overlaps',
    dot: 'bg-amber-400',
    bandBg: '#fffbeb',
    bandBorder: '#fcd34d',
    badgeBg: '#fef3c7',
    badgeText: '#92400e',
    defaultOpen: true,
  },
  IMPROVEMENT: {
    label: 'Replacements — incoming is strictly better',
    dot: 'bg-blue-400',
    bandBg: '#eff6ff',
    bandBorder: '#93c5fd',
    badgeBg: '#dbeafe',
    badgeText: '#1e40af',
    defaultOpen: true,
  },
  DISTINCT: {
    label: 'New Skills',
    dot: 'bg-green-400',
    bandBg: '#f0fdf4',
    bandBorder: '#86efac',
    badgeBg: '#dcfce7',
    badgeText: '#166534',
    defaultOpen: true,
  },
  DUPLICATE: {
    label: 'Duplicates — already in library',
    dot: 'bg-red-400',
    bandBg: '#fef2f2',
    bandBorder: '#fca5a5',
    badgeBg: '#fee2e2',
    badgeText: '#991b1b',
    defaultOpen: false,
  },
};
```

- [ ] **Step 2: Update the CLASSIFICATIONS order**

In `SkillAnalyzerResultsStep.tsx:593`, change:

```typescript
// before
const CLASSIFICATIONS: Classification[] = ['IMPROVEMENT', 'DISTINCT', 'PARTIAL_OVERLAP', 'DUPLICATE'];
```

```typescript
// after
const CLASSIFICATIONS: Classification[] = ['PARTIAL_OVERLAP', 'IMPROVEMENT', 'DISTINCT', 'DUPLICATE'];
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: errors only on the now-stale `cfg.colour` / `cfg.headerColour` reads in `ResultSection` and the summary bar — those will be removed in Tasks 2–3, so note the line numbers if any appear and proceed.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/skill-analyzer/SkillAnalyzerResultsStep.tsx
git commit -m "refactor(skill-analyzer): update SECTION_CONFIG shape and section order for UX redesign"
```

---

## Task 2: New page header {#task-2}

**Files:**
- Modify: `client/src/components/skill-analyzer/SkillAnalyzerResultsStep.tsx:669-694` (summary bar → new header)

The current summary bar (lines 673–694) is a single flex row with counts and the Continue button. Replace it with a two-column header: left side has title, subtitle, coloured pills, progress bar; right side has the Continue button.

- [ ] **Step 1: Add `reviewedCount` derived value**

After line 669 (`const approvedCount = ...`), add:

```typescript
const reviewedCount = results.filter((r) => r.actionTaken != null).length;
```

- [ ] **Step 2: Replace the summary bar JSX**

Replace the block from `{/* Summary bar */}` through the closing `</div>` of that block (lines 673–694) with:

```tsx
{/* Page header */}
<div className="flex items-start justify-between gap-4">
  <div>
    <h1 className="text-xl font-semibold text-slate-900 mb-0.5">Review Skills</h1>
    <p className="text-xs text-slate-400">
      {results.length} candidates · approve, reject, or skip each skill
    </p>
    <div className="flex gap-2 flex-wrap mt-2">
      {CLASSIFICATIONS.map((c) => {
        const count = results.filter((r) => r.classification === c).length;
        if (count === 0) return null;
        const cfg = SECTION_CONFIG[c];
        return (
          <span
            key={c}
            className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full"
            style={{ backgroundColor: cfg.badgeBg, color: cfg.badgeText }}
          >
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
            {count} {cfg.label}
          </span>
        );
      })}
    </div>
    <div className="mt-2 flex items-center gap-2">
      <div className="h-1.5 w-48 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-slate-400 rounded-full transition-all"
          style={{ width: results.length > 0 ? `${(reviewedCount / results.length) * 100}%` : '0%' }}
        />
      </div>
      <span className="text-xs text-slate-400">{reviewedCount} of {results.length} reviewed</span>
    </div>
  </div>
  <button
    onClick={onContinue}
    className="shrink-0 px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition-colors"
  >
    Continue to Execute →{approvedCount > 0 && ` (${approvedCount})`}
  </button>
</div>
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: 0 errors (or only errors from Task 1's stale field reads, which will be cleaned up in Task 3).

- [ ] **Step 4: Commit**

```bash
git add client/src/components/skill-analyzer/SkillAnalyzerResultsStep.tsx
git commit -m "feat(skill-analyzer): replace summary bar with new page header and progress bar"
```

---

## Task 3: Redesign ResultSection with coloured band header {#task-3}

**Files:**
- Modify: `client/src/components/skill-analyzer/SkillAnalyzerResultsStep.tsx:450-590` (ResultSection component)

The current section wraps everything in a coloured border/background. The new design uses a white card with a thin coloured header band (bg + bottom border from SECTION_CONFIG), bulk actions in the header, and a white list body with no internal padding — rows sit flush edge-to-edge.

- [ ] **Step 1: Rewrite the ResultSection return JSX**

Replace the `return (` block of `ResultSection` (lines 505–589) with:

```tsx
if (results.length === 0) return null;

const approvedInSection = results.filter((r) => r.actionTaken != null).length;

return (
  <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
    {/* Coloured band header */}
    <div
      className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
      style={{ backgroundColor: cfg.bandBg, borderBottom: `2px solid ${cfg.bandBorder}` }}
      onClick={() => setOpen((v) => !v)}
    >
      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-700">{cfg.label}</span>
      <span
        className="text-xs font-medium px-2 py-0.5 rounded-full"
        style={{ backgroundColor: cfg.badgeBg, color: cfg.badgeText }}
      >
        {results.length}
      </span>
      <span className="text-xs text-slate-400">{approvedInSection} reviewed</span>
      <div className="ml-auto flex items-center gap-2">
        {(classification === 'IMPROVEMENT' || classification === 'DISTINCT' || classification === 'PARTIAL_OVERLAP') && (
          <button
            className="text-xs px-2.5 py-1 rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors"
            onClick={(e) => { e.stopPropagation(); onBulkAction(classification, 'approved'); }}
          >
            Approve all
          </button>
        )}
        {classification === 'DUPLICATE' && (
          <button
            className="text-xs px-2.5 py-1 rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors"
            onClick={(e) => { e.stopPropagation(); onBulkAction(classification, 'rejected'); }}
          >
            Reject all
          </button>
        )}
        {classification === 'PARTIAL_OVERLAP' && failedResults.length > 0 && (
          <button
            type="button"
            disabled={bulkRetrying}
            className="text-xs px-2.5 py-1 rounded-md border border-amber-300 bg-white text-amber-700 hover:bg-amber-50 disabled:opacity-50 transition-colors"
            onClick={(e) => { e.stopPropagation(); handleBulkRetry(); }}
          >
            {bulkRetrying ? 'Retrying…' : `Retry failed (${failedResults.length})`}
          </button>
        )}
        <span className="text-xs text-slate-400">{open ? '▲' : '▼'}</span>
      </div>
    </div>

    {open && (
      <div className="divide-y divide-slate-50">
        {results.map((r) => (
          <ResultRow
            key={r.id}
            result={r}
            jobId={jobId}
            availableSystemAgents={availableSystemAgents}
            candidate={parsedCandidates[r.candidateIndex]}
            onActionChange={onActionChange}
            onProposalsUpdated={onProposalsUpdated}
            onResultPatched={onResultPatched}
          />
        ))}
      </div>
    )}

    {classification === 'PARTIAL_OVERLAP' && bulkRetryStatus && !bulkRetrying && open && (
      <div className="px-4 py-2 text-xs text-slate-600 border-t border-slate-100">{bulkRetryStatus}</div>
    )}
  </div>
);
```

Note: `ResultRow` is defined in Task 4. TypeScript will complain about the unknown name until that task is done — that's expected.

- [ ] **Step 2: Run typecheck (expect one error for ResultRow)**

```bash
npm run typecheck
```

Expected: one error referencing `ResultRow` not defined. All other errors should be gone.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/skill-analyzer/SkillAnalyzerResultsStep.tsx
git commit -m "feat(skill-analyzer): redesign ResultSection with coloured band header and flush row list"
```

---

## Task 4: Replace ResultCard with ResultRow expand/collapse {#task-4}

**Files:**
- Modify: `client/src/components/skill-analyzer/SkillAnalyzerResultsStep.tsx` — replace the entire `ResultCard` function with `ResultRow`

`ResultCard` currently starts at line 230 (the `function ResultCard(` declaration) and ends at line 448 (`}`). Replace it entirely.

Key behaviour changes from `ResultCard`:
- No card border/padding — row is flush in the list
- Collapsed state shows: skill name, sub-line ("vs. X" or "replaces X"), confidence%, chevron
- Decided rows (actionTaken != null): 40% opacity, name struck through, status badge, chevron hidden
- Expanded panel: reasoning block, classification-failed banner, MergeReviewBlock or AgentChipBlock, action bar with View button right-aligned
- `setAction` / `handleRetry` logic preserved verbatim from ResultCard

- [ ] **Step 1: Replace ResultCard with ResultRow**

Remove the `function ResultCard(...)` block and replace with:

```tsx
function ResultRow({
  result,
  jobId,
  availableSystemAgents,
  candidate,
  onActionChange,
  onProposalsUpdated,
  onResultPatched,
}: {
  result: AnalysisResult;
  jobId: string;
  availableSystemAgents: AvailableSystemAgent[];
  candidate: ParsedCandidate | undefined;
  onActionChange: (resultId: string, action: 'approved' | 'rejected' | 'skipped' | null) => void;
  onProposalsUpdated: (resultId: string, proposals: AgentProposal[]) => void;
  onResultPatched: (next: AnalysisResult) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [showSkill, setShowSkill] = useState(false);

  const confidence = Math.round(result.confidence * 100);
  const similarity = result.similarityScore != null ? Math.round(result.similarityScore * 100) : null;
  const isDistinct = result.classification === 'DISTINCT';
  const isDecided = result.actionTaken != null;

  async function setAction(action: 'approved' | 'rejected' | 'skipped') {
    setActionError(null);
    try {
      await api.patch(
        `/api/system/skill-analyser/jobs/${jobId}/results/${result.id}`,
        { actionTaken: action },
      );
      onActionChange(result.id, action);
      setExpanded(false);
    } catch (err) {
      const e = err as { response?: { data?: { error?: unknown } }; message?: string };
      const errBody = e?.response?.data?.error;
      const msg = (typeof errBody === 'string' ? errBody : (errBody as { message?: string } | null)?.message) ?? e?.message ?? 'Action failed.';
      setActionError(msg);
    }
  }

  async function handleRetry() {
    setRetrying(true);
    try {
      await api.post(
        `/api/system/skill-analyser/jobs/${jobId}/results/${result.id}/retry-classification`,
      );
      const { data } = await api.get<{ results: AnalysisResult[] }>(
        `/api/system/skill-analyser/jobs/${jobId}`,
      );
      const updated = data.results.find((r) => r.id === result.id);
      if (updated) onResultPatched(updated);
    } catch (err) {
      console.error('[SkillAnalyzer] Retry classification failed:', err);
    } finally {
      setRetrying(false);
    }
  }

  // "replaces X" on IMPROVEMENT rows; "vs. X" on all others
  const matchLine = result.matchedSkillContent
    ? `${result.classification === 'IMPROVEMENT' ? 'replaces' : 'vs.'} ${result.matchedSkillContent.name}${similarity != null ? ` · ${similarity}% similar` : ''}`
    : null;

  const statusBadge =
    result.actionTaken === 'approved' ? (
      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">approved</span>
    ) : result.actionTaken === 'rejected' ? (
      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">rejected</span>
    ) : result.actionTaken === 'skipped' ? (
      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">skipped</span>
    ) : null;

  return (
    <div style={isDecided ? { opacity: 0.4 } : undefined}>
      {/* Collapsed row header */}
      <div
        className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-slate-50 transition-colors"
        onClick={() => { if (!isDecided) setExpanded((v) => !v); }}
      >
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium text-slate-800 leading-snug${isDecided ? ' line-through' : ''}`}>
            {result.candidateName}
          </p>
          {matchLine && <p className="text-xs text-slate-400 mt-0.5">{matchLine}</p>}
        </div>
        {isDecided && statusBadge}
        {!isDecided && <span className="text-xs text-slate-300 flex-shrink-0">{confidence}%</span>}
        {!isDecided && (
          <span
            className="text-slate-300 text-sm flex-shrink-0 transition-transform duration-150"
            style={expanded ? { transform: 'rotate(90deg)' } : undefined}
          >›</span>
        )}
      </div>

      {/* Expanded panel */}
      {expanded && !isDecided && (
        <div className="bg-slate-50 border-t border-slate-200 px-4 py-4 space-y-3">
          {/* Reasoning block */}
          {result.classificationReasoning && (
            <p className="text-xs text-slate-500 italic leading-relaxed pl-3 py-2 pr-3 bg-white rounded border-l-2 border-slate-200">
              {result.classificationReasoning}
            </p>
          )}

          {/* Classification failed banner */}
          {result.classificationFailed && (
            <div className="flex items-center gap-3 p-3 rounded-lg text-xs bg-amber-50 border border-amber-200 text-amber-800">
              <span className="flex-1">
                Couldn't classify this skill
                {result.classificationFailureReason === 'rate_limit' && ' · Rate limit'}
                {result.classificationFailureReason === 'parse_error' && ' · Parse error'}
              </span>
              <button
                type="button"
                onClick={handleRetry}
                disabled={retrying}
                className="px-2 py-1 rounded border border-amber-300 bg-white text-amber-700 hover:bg-amber-50 disabled:opacity-50"
              >
                {retrying ? 'Retrying…' : 'Retry'}
              </button>
            </div>
          )}

          {/* Three-column merge view (PARTIAL_OVERLAP / IMPROVEMENT) */}
          {(result.classification === 'PARTIAL_OVERLAP' || result.classification === 'IMPROVEMENT') && candidate && (
            <MergeReviewBlock
              result={result}
              candidate={candidate}
              jobId={jobId}
              onResultUpdated={onResultPatched}
            />
          )}

          {/* Legacy diff pills — shown when no merge proposal exists */}
          {result.diffSummary && !result.proposedMergedContent && (
            <DiffView result={result} />
          )}

          {/* Agent chips (DISTINCT rows only) */}
          {isDistinct && (
            <AgentChipBlock
              result={result}
              jobId={jobId}
              availableSystemAgents={availableSystemAgents}
              onProposalsUpdated={onProposalsUpdated}
            />
          )}

          {/* Action bar */}
          <div className="flex items-center gap-2 pt-2 border-t border-slate-200">
            <button
              onClick={() => setAction('approved')}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors"
            >
              Approve
            </button>
            <button
              onClick={() => setAction('rejected')}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-red-300 hover:text-red-600 transition-colors"
            >
              Reject
            </button>
            <button
              onClick={() => setAction('skipped')}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-500 hover:border-slate-400 transition-colors"
            >
              Skip
            </button>
            {candidate && (
              <button
                onClick={() => setShowSkill(true)}
                className="ml-auto px-3 py-1.5 text-xs font-medium rounded-lg border border-indigo-200 bg-white text-indigo-600 hover:bg-indigo-50 transition-colors"
              >
                View skill
              </button>
            )}
          </div>

          {actionError && <p className="text-xs text-red-600 -mt-1">{actionError}</p>}
        </div>
      )}

      {/* View skill modal */}
      {showSkill && candidate && (
        <Modal title={candidate.name || result.candidateName} onClose={() => setShowSkill(false)} maxWidth={700}>
          <div className="space-y-4 text-sm">
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Slug</p>
              <code className="text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1 text-slate-700">{result.candidateSlug}</code>
            </div>
            {candidate.description && (
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Description</p>
                <p className="text-slate-700 text-sm">{candidate.description}</p>
              </div>
            )}
            {candidate.instructions && (
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Instructions</p>
                <pre className="text-xs bg-slate-50 border border-slate-200 rounded p-3 overflow-auto max-h-64 whitespace-pre-wrap text-slate-700">{candidate.instructions}</pre>
              </div>
            )}
            {candidate.definition && (
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Definition</p>
                <pre className="text-xs bg-slate-50 border border-slate-200 rounded p-3 overflow-auto max-h-48 text-slate-700">{JSON.stringify(candidate.definition, null, 2)}</pre>
              </div>
            )}
            {candidate.rawSource && (
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Raw source</p>
                <pre className="text-xs bg-slate-50 border border-slate-200 rounded p-3 overflow-auto max-h-64 whitespace-pre-wrap text-slate-700">{candidate.rawSource}</pre>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/skill-analyzer/SkillAnalyzerResultsStep.tsx
git commit -m "feat(skill-analyzer): replace ResultCard with ResultRow expand/collapse layout"
```

---

## Task 5: Add diff legend to MergeReviewBlock and remove duplicated reasoning {#task-5}

**Files:**
- Modify: `client/src/components/skill-analyzer/MergeReviewBlock.tsx:377-401`

Two changes:
1. Remove the reasoning `<p>` at lines 379–381 — reasoning is now rendered in `ResultRow`'s expanded panel before MergeReviewBlock is called, so showing it again inside MergeReviewBlock would double it.
2. Add a diff colour legend above the first `<FieldRow>` so reviewers know what green/red highlights mean.

- [ ] **Step 1: Remove the reasoning line from MergeReviewBlock**

In `MergeReviewBlock.tsx`, find and remove these lines (around line 379–381):

```tsx
// remove this block:
{reasoning && (
  <p className="text-xs text-slate-600 italic mb-2">{reasoning}</p>
)}
```

Also remove the `const reasoning = result.classificationReasoning;` line at ~line 375 if it's now unused (it is).

- [ ] **Step 2: Add diff legend between patchError and the first FieldRow**

Find the block starting at `{patchError && ...}` and add the legend immediately after it:

```tsx
{patchError && <p className="mb-2 text-xs text-red-600">{patchError}</p>}

{/* Diff legend */}
<div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 text-xs text-slate-400">
  <span className="flex items-center gap-1.5">
    <span className="w-3 h-3 rounded-sm bg-emerald-100 border border-emerald-300 inline-block" />
    Added from incoming
  </span>
  <span className="flex items-center gap-1.5">
    <span className="w-3 h-3 rounded-sm bg-red-50 border border-red-300 inline-block" />
    Removed from current
  </span>
  <span className="italic">Rewritten passages appear fully highlighted — review content carefully</span>
</div>

<FieldRow ...
```

- [ ] **Step 3: Run typecheck and lint**

```bash
npm run typecheck && npm run lint
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/skill-analyzer/MergeReviewBlock.tsx
git commit -m "feat(skill-analyzer): add diff legend to MergeReviewBlock, remove duplicated reasoning"
```

---

## Task 6: Smoke test {#task-6}

No automated tests exist for the skill-analyzer UI (it requires a live job). Manual smoke test against a real or seeded job.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Navigate to an analysis job results page**

Go to a job that has results in multiple classifications (or use the dev seed).

- [ ] **Step 3: Verify page header**

- [ ] Title "Review Skills" visible at top-left
- [ ] Coloured pills show correct counts for each section (amber = Partial Overlaps, blue = Replacements, green = New Skills, red = Duplicates)
- [ ] Progress bar updates as you approve/reject rows
- [ ] Continue button top-right, dark background

- [ ] **Step 4: Verify section band colours**

- [ ] Partial Overlaps section: amber band header, white list body
- [ ] Replacements section: blue band header
- [ ] New Skills section: green band header
- [ ] Duplicates section: red band header, collapsed by default
- [ ] Section count badge uses matching colour
- [ ] Section "N reviewed" counter increments when you action a row

- [ ] **Step 5: Verify row expand/collapse**

- [ ] Clicking a row expands it; chevron rotates 90°
- [ ] Clicking again collapses it
- [ ] Approved/rejected/skipped rows show at 40% opacity with strikethrough name and status badge
- [ ] Decided rows cannot be expanded (click does nothing)

- [ ] **Step 6: Verify expanded panel content**

- [ ] Reasoning shown in italic left-border block (when present)
- [ ] Classification-failed amber banner shows with Retry button (on a failed row)
- [ ] MergeReviewBlock three-column grid shown for PARTIAL_OVERLAP and IMPROVEMENT rows
- [ ] Diff legend shown above the field rows: green swatch "Added from incoming", red swatch "Removed from current"
- [ ] Agent chip block shown for DISTINCT rows
- [ ] Action bar: Approve (dark), Reject (white/hover-red), Skip (white/muted), View skill (indigo, right-aligned)
- [ ] Approving a row collapses the panel and dims the row

- [ ] **Step 7: Verify "replaces" label on IMPROVEMENT rows**

- [ ] Collapsed IMPROVEMENT rows show "replaces [SkillName] · XX% similar" (not "vs.")
- [ ] All other classifications show "vs. [SkillName]"

- [ ] **Step 8: Final typecheck and lint**

```bash
npm run typecheck && npm run lint
```

Expected: 0 errors.
