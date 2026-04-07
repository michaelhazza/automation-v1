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
import type { StepExecutor, ActionResult } from '../loop/executionLoop.js';
import {
  createWorkspace,
  resolveSafePath,
  assertStillInsideWorkspace,
  listWorkspaceFiles,
} from './workspace.js';
import { runShellCommand } from './shell.js';
import { gitClone, gitCommit } from './git.js';
import { db } from '../db.js';
import { ieeArtifacts } from '../../../server/db/schema/ieeArtifacts.js';
import { logger, truncateMiddle } from '../logger.js';

export interface BuildDevExecutorInput {
  ieeRunId: string;
  organisationId: string;
  initialCommands?: string[];
}

export async function buildDevExecutor(input: BuildDevExecutorInput): Promise<StepExecutor> {
  const workspace = await createWorkspace(input.ieeRunId);
  let stepNumber = 0;
  let lastCommandOutput: string | undefined;
  let lastCommandExitCode: number | undefined;

  return {
    mode: 'dev',
    availableActions: DEV_ACTION_TYPES,

    async observe(): Promise<Observation> {
      const files = await listWorkspaceFiles(workspace.dir, { maxDepth: 3, max: 100 });
      return ObservationSchema.parse({
        files,
        lastCommandOutput: lastCommandOutput ? truncateMiddle(lastCommandOutput, 4000) : undefined,
        lastCommandExitCode,
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
