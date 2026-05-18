import type { Validator, ValidatorContext, ValidatorResult } from './types.js';

type PhraseEntry = string | { regex: string; flags?: string };

function toRegex(entry: PhraseEntry): RegExp {
  if (typeof entry === 'string') {
    return new RegExp(entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }
  return new RegExp(entry.regex, entry.flags ?? 'i');
}

export const validator: Validator = {
  slug: 'no_forbidden_phrase',
  version: '1.0.0',
  kind: 'deterministic',
  parameterSchema: [
    {
      name: 'phrases',
      type: 'array',
      required: true,
      description:
        'Array of forbidden phrases. Each item is either a plain string (matched case-insensitively) or an object with "regex" (pattern string) and optional "flags".',
      uiHint: 'textarea',
    },
  ],
  async evaluate(ctx: ValidatorContext): Promise<ValidatorResult> {
    const phrases = ctx.parameters['phrases'];
    if (!Array.isArray(phrases) || phrases.length === 0) {
      return {
        passed: true,
        score: 1.0,
        reasoning: 'No forbidden phrases configured; check trivially passes.',
      };
    }

    const phrasesTotal = phrases.length;
    let violationCount = 0;
    const violatingCategories: string[] = [];

    for (const phrase of phrases as PhraseEntry[]) {
      let re: RegExp;
      try {
        re = toRegex(phrase);
      } catch (e) {
        // Malformed regex — count as a violation to fail safe.
        violationCount++;
        violatingCategories.push(`[invalid pattern: ${String(e)}]`);
        continue;
      }
      // ReDoS guard: cap input length before applying user-supplied regex.
      if (re.test(ctx.runOutput.slice(0, 50_000))) {
        violationCount++;
        const label = typeof phrase === 'string' ? phrase : phrase.regex;
        // Store the pattern/category only — never the matched substring (redaction policy).
        violatingCategories.push(label.slice(0, 80));
      }
    }

    const phrasesClean = phrasesTotal - violationCount;
    const score = phrasesTotal > 0 ? phrasesClean / phrasesTotal : 1.0;
    const passed = violationCount === 0;

    if (passed) {
      return {
        passed: true,
        score: 1.0,
        reasoning: `All ${phrasesTotal} forbidden phrase(s) absent from output.`,
      };
    }

    const capped = violatingCategories.slice(0, 50);
    const truncated = violatingCategories.length > 50;
    const evidence: Record<string, unknown> = {
      phrasesClean,
      phrasesTotal,
      violatingPatterns: capped,
    };
    if (truncated) evidence['_truncated'] = true;

    return {
      passed: false,
      score,
      reasoning: `${violationCount} forbidden phrase(s) found in output (${phrasesClean}/${phrasesTotal} clean).`,
      evidence: evidence as ValidatorResult['evidence'],
    };
  },
};
