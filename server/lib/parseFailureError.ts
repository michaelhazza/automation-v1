// ---------------------------------------------------------------------------
// ParseFailureError — thrown from a caller-supplied `postProcess` hook when
// the LLM's 200 OK response fails the caller's schema check after every
// retry in the router's fallback loop is exhausted.
//
// The router catches this error, writes the `llm_requests` row with
// status='parse_failure' and `parseFailureRawExcerpt = err.rawExcerpt`,
// then re-throws for caller control flow.
//
// See spec §8.3 (capture rules) and §19.7 (contract).
// ---------------------------------------------------------------------------

export class ParseFailureError extends Error {
  readonly code = 'CLASSIFICATION_PARSE_FAILURE' as const;
  readonly rawExcerpt: string;

  constructor(args: { rawExcerpt: string; message?: string }) {
    super(args.message ?? 'LLM response failed post-processing schema check');
    this.name = 'ParseFailureError';
    this.rawExcerpt = args.rawExcerpt;
  }
}

export function isParseFailureError(err: unknown): err is ParseFailureError {
  return err instanceof ParseFailureError;
}
