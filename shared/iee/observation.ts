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

// Result of a single configured quality check (lint / typecheck / test)
// run after a write_file or git_commit action in the dev executor. The
// dev executor surfaces these so the agent can see whether the code it
// just wrote passes the project's own gates.
const CheckResult = z.object({
  exitCode: z.number().int(),
  passed: z.boolean(),
  output: z.string().max(1500),
});

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

  // Dev fields — quality checks run after every write_file / git_commit.
  // Each entry is omitted when its corresponding check command is not
  // configured. See worker/src/dev/qualityChecks.ts for the runner.
  lastChecks: z.object({
    lint: CheckResult.optional(),
    typecheck: CheckResult.optional(),
    test: CheckResult.optional(),
  }).optional(),

  // Both modes
  lastActionResult: z.string().max(1000).optional(),
});

export type Observation = z.infer<typeof Observation>;
