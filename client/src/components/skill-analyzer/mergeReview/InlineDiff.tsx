import { useMemo } from 'react';
import { diffWordsWithSpace } from 'diff';

/** Render a string with inline diff highlighting against a baseline.
 *  Words present in the baseline but missing from the value are shown as
 *  red strikethrough; words new in the value are shown as green
 *  insertions; unchanged words are plain. */
export function InlineDiff({ baseline, value }: { baseline: string; value: string }) {
  const tokens = useMemo(() => {
    if (baseline === value) {
      return [{ kind: 'unchanged' as const, value }];
    }
    // Explicit empty-string handling so an empty side renders as a pure
    // addition or removal rather than tripping the "no shared tokens"
    // fallback below with a misleading strikethrough of "". See ChatGPT
    // PR review Round 1 Finding 5.
    if (!baseline) {
      return [{ kind: 'added' as const, value }];
    }
    if (!value) {
      return [{ kind: 'removed' as const, value: baseline }];
    }
    const parts = diffWordsWithSpace(baseline, value);
    // When the two strings share no unchanged tokens the word diff produces a
    // garbled concatenation (e.g. "Draft Ad Copyad-creative"). Fall back to a
    // simple two-token display: old value struck-through, new value highlighted.
    const hasUnchanged = parts.some((p) => !p.added && !p.removed);
    if (!hasUnchanged) {
      return [
        { kind: 'removed' as const, value: baseline },
        { kind: 'added' as const, value: value },
      ];
    }
    return parts.map((part) => ({
      kind: part.added ? ('added' as const) : part.removed ? ('removed' as const) : ('unchanged' as const),
      value: part.value,
    }));
  }, [baseline, value]);

  return (
    <span className="whitespace-pre-wrap">
      {tokens.map((t, i) => {
        if (t.kind === 'added') {
          return (
            <span key={i} className="bg-emerald-100 text-emerald-900 rounded-sm px-0.5">
              {t.value}
            </span>
          );
        }
        if (t.kind === 'removed') {
          return (
            <span key={i} className="bg-red-50 text-red-700 line-through rounded-sm px-0.5">
              {t.value}
            </span>
          );
        }
        return <span key={i}>{t.value}</span>;
      })}
    </span>
  );
}
