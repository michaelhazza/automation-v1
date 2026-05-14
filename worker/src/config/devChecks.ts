// ---------------------------------------------------------------------------
// Default quality-check commands for the IEE dev executor.
//
// These run after every write_file / git_commit when no explicit override is
// passed in the job payload (`task.checks`). The defaults are deliberately
// conservative:
//
//  - `lint`:      `npm run -s lint --if-present` — no-op when the project has
//                  no `lint` script defined, so a git_clone'd repo without a
//                  linter doesn't error out the loop.
//  - `typecheck`: `npx tsc --noEmit --pretty false` — runs against the
//                  workspace's local tsconfig.json. Plain output is easier
//                  for the LLM to read than coloured.
//  - `test`:      `undefined` — explicitly opt-in. Many test suites are slow
//                  and we don't want to run them after every micro-edit. Set
//                  in `task.checks.testCommand` for projects where it's worth
//                  the latency.
//
// Caller can override any subset by passing `task.checks` in the dev job
// payload. See shared/iee/jobPayload.ts::DevTaskChecks.
// ---------------------------------------------------------------------------

import type { DevTaskChecks } from '../../../shared/iee/jobPayload.js';

export const DEV_TASK_DEFAULT_CHECKS: Required<Omit<DevTaskChecks, 'testCommand'>> & Pick<DevTaskChecks, 'testCommand'> = {
  lintCommand:      'npm run -s lint --if-present',
  typecheckCommand: 'npx tsc --noEmit --pretty false',
  testCommand:      undefined,
};
