// ---------------------------------------------------------------------------
// DevStepExecutor — workspace + git + shell + read/write file.
// Spec §7 + §13.5.
// ---------------------------------------------------------------------------

import { promises as fs } from 'fs';
import {
  type ExecutionAction,
  DEV_ACTION_TYPES,
} from '../../../shared/iee/actionSchema.js';
import type { Observation } from '../../../shared/iee/observation.js';
import { Observation as ObservationSchema } from '../../../shared/iee/observation.js';
import { SafetyError } from '../../../shared/iee/failureReason.js';
import type { DevTaskChecks } from '../../../shared/iee/jobPayload.js';
import type { StepExecutor, ActionResult } from '../loop/executionLoop.js';
import {
  createWorkspace,
  resolveSafePath,
  assertStillInsideWorkspace,
  listWorkspaceFiles,
} from './workspace.js';
import { runShellCommand } from './shell.js';
import { gitClone, gitCommit } from './git.js';
import { runQualityChecks } from './qualityChecks.js';
import { DEV_TASK_DEFAULT_CHECKS } from '../config/devChecks.js';
import { db } from '../db.js';
import { ieeArtifacts } from '../../../server/db/schema/ieeArtifacts.js';
import { logger, truncateMiddle } from '../logger.js';

export interface BuildDevExecutorInput {
  ieeRunId: string;
  organisationId: string;
  initialCommands?: string[];
  /** Override defaults for the post-write quality-check trio. */
  checks?: DevTaskChecks;
}

export async function buildDevExecutor(input: BuildDevExecutorInput): Promise<StepExecutor> {
  const workspace = await createWorkspace(input.ieeRunId);
  let stepNumber = 0;
  let lastCommandOutput: string | undefined;
  let lastCommandExitCode: number | undefined;
  // Populated by `runQualityChecks` after every write_file / git_commit.
  // Held here so it persists across the next `observe()` call without
  // leaking through every action result.
  let lastChecks: Observation['lastChecks'] | undefined;

  // Resolve check config: explicit per-job override wins, else defaults.
  const effectiveChecks: DevTaskChecks = {
    lintCommand:      input.checks?.lintCommand      ?? DEV_TASK_DEFAULT_CHECKS.lintCommand,
    typecheckCommand: input.checks?.typecheckCommand ?? DEV_TASK_DEFAULT_CHECKS.typecheckCommand,
    testCommand:      input.checks?.testCommand      ?? DEV_TASK_DEFAULT_CHECKS.testCommand,
  };

  // ── Wire `initialCommands` (previously dead-code) ────────────────────────
  // Run each setup command exactly once before returning the executor.
  // The very first observation reflects the result of the LAST initial
  // command — same shape the LLM sees after any other run_command.
  if (input.initialCommands && input.initialCommands.length > 0) {
    for (const command of input.initialCommands) {
      try {
        const result = await runShellCommand(command, workspace.dir, {
          ieeRunId: input.ieeRunId,
          stepNumber: 0, // pre-loop bootstrap — explicit step 0
        });
        lastCommandOutput = result.stdout + (result.stderr ? `\n[stderr]\n${result.stderr}` : '');
        lastCommandExitCode = result.exitCode;
        // Stop on the first non-zero exit — subsequent commands (e.g. build
        // steps after a failed `npm install`) won't work either.
        if (result.exitCode !== 0) break;
      } catch (err) {
        // Denylist hits and timeouts land here — same stop logic.
        const msg = err instanceof Error ? err.message : String(err);
        lastCommandOutput = `initialCommand '${command.slice(0, 200)}' failed: ${msg}`;
        lastCommandExitCode = -1;
        logger.warn('iee.dev.initial_command_failed', {
          ieeRunId: input.ieeRunId,
          command: command.slice(0, 500),
          error: msg.slice(0, 500),
        });
        break;
      }
    }
  }

  return {
    mode: 'dev',
    availableActions: DEV_ACTION_TYPES,

    async observe(): Promise<Observation> {
      const files = await listWorkspaceFiles(workspace.dir, { maxDepth: 3, max: 100 });
      return ObservationSchema.parse({
        files,
        lastCommandOutput: lastCommandOutput ? truncateMiddle(lastCommandOutput, 4000) : undefined,
        lastCommandExitCode,
        lastChecks,
      });
    },

    async execute(action: ExecutionAction): Promise<ActionResult> {
      stepNumber++;
      const ctx = { ieeRunId: input.ieeRunId, stepNumber };

      switch (action.type) {
        case 'run_command': {
          const result = await runShellCommand(action.command, workspace.dir, ctx);
          lastCommandOutput = (result.stdout + (result.stderr ? `\n[stderr]\n${result.stderr}` : ''));
          lastCommandExitCode = result.exitCode;
          return {
            output: { exitCode: result.exitCode, durationMs: result.durationMs },
            summary: `ran '${action.command.slice(0, 80)}' exit=${result.exitCode}`,
          };
        }
        case 'write_file': {
          const target = resolveSafePath(workspace.dir, action.path);
          await fs.mkdir(target.replace(/\/[^/]*$/, ''), { recursive: true }).catch(() => undefined);
          await fs.writeFile(target, action.content, 'utf8');
          await assertStillInsideWorkspace(workspace.dir, target);
          await db.insert(ieeArtifacts).values({
            ieeRunId: input.ieeRunId,
            organisationId: input.organisationId,
            kind: 'file',
            path: target,
            sizeBytes: Buffer.byteLength(action.content, 'utf8'),
          });
          // Run configured quality checks against the post-write state so
          // the agent sees lint / typecheck / test results in the next
          // observation. Failures here surface as `passed: false`; they do
          // not abort the action.
          lastChecks = await runQualityChecks({
            workspaceDir: workspace.dir,
            config: effectiveChecks,
            ctx,
          });
          return {
            output: { path: target, bytes: Buffer.byteLength(action.content, 'utf8') },
            summary: `wrote ${action.path}`,
            artifacts: [target],
          };
        }
        case 'read_file': {
          const target = resolveSafePath(workspace.dir, action.path);
          await assertStillInsideWorkspace(workspace.dir, target);
          const content = await fs.readFile(target, 'utf8');
          const truncated = truncateMiddle(content, 4000);
          return {
            output: { path: target, content: truncated, bytes: content.length },
            summary: `read ${action.path} (${content.length} bytes)`,
          };
        }
        case 'git_clone': {
          const result = await gitClone(workspace.dir, action.repoUrl, action.branch, ctx);
          lastCommandExitCode = result.exitCode;
          return {
            output: { path: result.path, exitCode: result.exitCode },
            summary: `cloned ${action.repoUrl}${action.branch ? `@${action.branch}` : ''}`,
          };
        }
        case 'git_commit': {
          const result = await gitCommit(workspace.dir, action.message, ctx);
          lastCommandOutput = result.stdout + (result.stderr ? `\n[stderr]\n${result.stderr}` : '');
          lastCommandExitCode = result.exitCode;
          // Same rationale as write_file — the agent should see the cost
          // of what it just committed.
          lastChecks = await runQualityChecks({
            workspaceDir: workspace.dir,
            config: effectiveChecks,
            ctx,
          });
          return {
            output: { exitCode: result.exitCode },
            summary: `committed: ${action.message.slice(0, 80)}`,
          };
        }
        case 'done':
        case 'failed':
          return { output: action, summary: action.type };
        default:
          throw new SafetyError(
            `dev executor received unsupported action type: ${(action as { type: string }).type}`,
          );
      }
    },

    async dispose(): Promise<void> {
      // §7.2 — workspace is ALWAYS destroyed at the end of the job
      try {
        await workspace.destroy();
      } catch (err) {
        logger.warn('iee.dev.workspace_destroy_failed', {
          ieeRunId: input.ieeRunId,
          dir: workspace.dir,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}
