import { execFile } from 'child_process';
import { promisify } from 'util';
import type { Action } from '../../db/schema/actions.js';
import type { ExecutionResult, ExecutionAdapter } from './workerAdapter.js';
import { gitService } from '../gitService.js';
import { devContextService } from '../devContextService.js';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Devops Adapter — executes approved write_patch, run_command, and create_pr
// actions after human approval in the HITL review queue.
// ---------------------------------------------------------------------------

export const devopsAdapter: ExecutionAdapter = {
  async execute(action: Action): Promise<ExecutionResult> {
    const start = Date.now();

    try {
      switch (action.actionType) {
        case 'write_patch':
          return await executeWritePatch(action, start);
        case 'run_command':
          return await executeRunCommand(action, start);
        case 'create_pr':
          return await executeCreatePr(action, start);
        default:
          return {
            success: false,
            resultStatus: 'failed',
            error: `Unknown devops action type: ${action.actionType}`,
            errorCode: 'unknown_type',
          };
      }
    } catch (err) {
      const e = err as { message?: string; errorCode?: string };
      return {
        success: false,
        resultStatus: 'failed',
        error: e.message ?? String(err),
        errorCode: e.errorCode ?? 'execution_failure',
        durationMs: Date.now() - start,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// write_patch — apply an approved code diff via gitService
// ---------------------------------------------------------------------------

async function executeWritePatch(action: Action, start: number): Promise<ExecutionResult> {
  const payload = action.payloadJson as Record<string, unknown>;
  const file = String(payload.file ?? '');
  const diff = String(payload.diff ?? '');
  const baseCommit = String(payload.base_commit ?? '');
  const reasoning = String(payload.reasoning ?? '');
  const intent = String(payload.intent ?? 'feature');

  if (!file || !diff || !baseCommit) {
    return {
      success: false,
      resultStatus: 'failed',
      error: 'write_patch requires file, diff, and base_commit',
      errorCode: 'validation_failure',
    };
  }

  // Ensure we're on the correct task branch before patching
  const taskId = payload.task_id ? String(payload.task_id) : undefined;
  if (taskId) {
    // Use a stable 12-char suffix of the taskId as the branch slug
    const taskSlug = taskId.replace(/-/g, '').slice(-12);
    await gitService.getOrCreateTaskBranch(action.subaccountId!, taskSlug);
  }

  const commitHash = await gitService.applyPatch(
    action.subaccountId!,
    file,
    diff,
    baseCommit
  );

  return {
    success: true,
    resultStatus: 'success',
    result: {
      commit_hash: commitHash,
      file,
      intent,
      reasoning,
    },
    durationMs: Date.now() - start,
  };
}

// ---------------------------------------------------------------------------
// run_command — execute an approved shell command inside projectRoot
// ---------------------------------------------------------------------------

async function executeRunCommand(action: Action, start: number): Promise<ExecutionResult> {
  const payload = action.payloadJson as Record<string, unknown>;
  const command = String(payload.command ?? '');

  if (!command) {
    return {
      success: false,
      resultStatus: 'failed',
      error: 'run_command requires command',
      errorCode: 'validation_failure',
    };
  }

  const { context } = await devContextService.getContext(action.subaccountId!);

  // Final safety check before execution (belt-and-suspenders)
  const blocked = devContextService.validateCommand(command, context);
  if (blocked) {
    return {
      success: false,
      resultStatus: 'failed',
      error: blocked,
      errorCode: 'permission_failure',
    };
  }

  const [cmd, ...args] = command.split(' ');
  const { stdout, stderr } = await execFileAsync(cmd, args, {
    cwd: context.projectRoot,
    timeout: context.resourceLimits.commandTimeoutMs,
    maxBuffer: context.resourceLimits.maxOutputBytes,
    env: { ...process.env, ...context.env },
  }).catch(err => {
    // execFile throws on non-zero exit — capture stdout/stderr if available
    const e = err as { stdout?: string; stderr?: string; code?: number };
    throw {
      errorCode: 'execution_failure',
      message: `Command exited with code ${e.code ?? 1}: ${(e.stderr ?? '').slice(0, 2000)}`,
    };
  });

  const truncated = (stdout + stderr).length > context.resourceLimits.maxOutputBytes;
  const output = (stdout + (stderr ? `\nSTDERR:\n${stderr}` : '')).slice(
    0,
    context.resourceLimits.maxOutputBytes
  );

  return {
    success: true,
    resultStatus: 'success',
    result: {
      output,
      truncated,
      command,
    },
    durationMs: Date.now() - start,
  };
}

// ---------------------------------------------------------------------------
// create_pr — create a GitHub PR from accumulated approved patches
// ---------------------------------------------------------------------------

async function executeCreatePr(action: Action, start: number): Promise<ExecutionResult> {
  const payload = action.payloadJson as Record<string, unknown>;
  const title = String(payload.title ?? '');
  const description = String(payload.description ?? '');
  const branch = payload.branch as string | undefined;

  if (!title) {
    return {
      success: false,
      resultStatus: 'failed',
      error: 'create_pr requires title',
      errorCode: 'validation_failure',
    };
  }

  // If no branch specified, use current branch
  const targetBranch = branch ?? await gitService.getCurrentBranch(action.subaccountId!);

  const prUrl = await gitService.createPullRequest(action.subaccountId!, {
    title,
    description,
    branch: targetBranch,
  });

  return {
    success: true,
    resultStatus: 'success',
    result: {
      pr_url: prUrl,
      branch: targetBranch,
    },
    durationMs: Date.now() - start,
  };
}
