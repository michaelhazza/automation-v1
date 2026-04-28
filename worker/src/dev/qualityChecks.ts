// ---------------------------------------------------------------------------
// runQualityChecks — invokes configured lint / typecheck / test commands
// after every write_file or git_commit, returns structured results for the
// next Observation. Per spec §4.1 of tasks/builds/pre-test-audit-fixes/spec.md.
//
// Each command is opt-in. If a command is undefined (or a default like
// `npm run -s lint --if-present` exits 0 because the script is absent), the
// agent sees "passed: true" with empty output — same shape, no special-case
// handling.
//
// Errors from the shell runner (timeouts, denylist hits) are caught and
// surfaced as `passed: false` with a short error string in `output`. We do
// NOT propagate them — quality checks are observational, never fatal.
// ---------------------------------------------------------------------------

import type { Observation } from '../../../shared/iee/observation.js';
import type { DevTaskChecks } from '../../../shared/iee/jobPayload.js';
import { runShellCommand } from './shell.js';
import { truncateMiddle } from '../logger.js';

const OUTPUT_CAP = 1500;

type CheckResult = NonNullable<NonNullable<Observation['lastChecks']>['lint']>;

interface RunQualityChecksInput {
  workspaceDir: string;
  config: DevTaskChecks;
  ctx: { ieeRunId: string; stepNumber: number };
}

async function runOne(
  command: string,
  workspaceDir: string,
  ctx: { ieeRunId: string; stepNumber: number },
): Promise<CheckResult> {
  try {
    const res = await runShellCommand(command, workspaceDir, ctx);
    const combined = res.stdout + (res.stderr ? `\n[stderr]\n${res.stderr}` : '');
    return {
      exitCode: res.exitCode,
      passed: res.exitCode === 0,
      output: truncateMiddle(combined.trim(), OUTPUT_CAP),
    };
  } catch (err) {
    // Timeouts and denylist hits land here. Surface as a failed check rather
    // than letting the loop crash — the agent should see the failure and try
    // a different command, not die.
    const msg = err instanceof Error ? err.message : String(err);
    return {
      exitCode: -1,
      passed: false,
      output: truncateMiddle(`check command failed to run: ${msg}`, OUTPUT_CAP),
    };
  }
}

export async function runQualityChecks(
  input: RunQualityChecksInput,
): Promise<Observation['lastChecks']> {
  const { workspaceDir, config, ctx } = input;
  const result: NonNullable<Observation['lastChecks']> = {};

  if (config.lintCommand) {
    result.lint = await runOne(config.lintCommand, workspaceDir, ctx);
  }
  if (config.typecheckCommand) {
    result.typecheck = await runOne(config.typecheckCommand, workspaceDir, ctx);
  }
  if (config.testCommand) {
    result.test = await runOne(config.testCommand, workspaceDir, ctx);
  }

  // Return undefined when nothing was configured so the observation field is
  // absent (cleaner shape than an empty object).
  if (!result.lint && !result.typecheck && !result.test) return undefined;
  return result;
}
