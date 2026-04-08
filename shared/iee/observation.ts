/**
 * IEE — Observation schema.
 *
 * Spec: docs/iee-development-spec.md §5.6.
 *
 * Every loop iteration constructs an Observation describing the current
 * environment state and passes it to the LLM. Observations are STRUCTURED —
 * never raw HTML, never untruncated command output. Caps are enforced on the
 * executor side, not the prompt.
 */

import { z } from 'zod';

export const Observation = z.object({
  // Browser fields
  url: z.string().url().optional(),
  pageText: z.string().max(8000).optional(),
  clickableElements: z.array(z.string().max(300)).max(80).optional(),
  inputs: z.array(z.string().max(300)).max(80).optional(),

  // Dev fields
  files: z.array(z.string().max(500)).max(100).optional(),
  lastCommandOutput: z.string().max(4000).optional(),
  lastCommandExitCode: z.number().int().optional(),

  // Both modes
  lastActionResult: z.string().max(1000).optional(),
});

export type Observation = z.infer<typeof Observation>;
