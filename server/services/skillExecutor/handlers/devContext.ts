import { eq, and, count, inArray } from 'drizzle-orm';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { glob } from 'glob';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { db } from '../../../db/index.js';
import { agentRuns, actions } from '../../../db/schema/index.js';
import type { SkillExecutionContext } from '../context.js';
import { proposeReviewGatedAction } from '../gating.js';
import { devContextService, assertPathInRoot } from '../../devContextService.js';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// proposeDevopsAction — safeMode-checked proposal for write_patch / run_command / create_pr
// ---------------------------------------------------------------------------

export async function proposeDevopsAction(
  actionType: 'write_patch' | 'run_command' | 'create_pr',
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  let devCtxResult;
  try {
    devCtxResult = await devContextService.getContext(context.subaccountId!);
  } catch (err) {
    const msg = (err as { message?: string }).message ?? String(err);
    return { success: false, error: `Cannot load dev execution context: ${msg}` };
  }

  const { context: devCtx } = devCtxResult;

  // safeMode blocks all code-modification actions
  if (devCtx.safeMode) {
    return {
      success: false,
      error: `safeMode is enabled for this subaccount. ${actionType} is not allowed. Disable safeMode in devContext settings to permit code changes.`,
      errorCode: 'permission_failure',
    };
  }

  // write_patch: validate patchLimits + maxPatchAttemptsPerTask before proposing
  if (actionType === 'write_patch') {
    const diff = String(input.diff ?? '');
    const lineCount = diff.split('\n').length;
    if (lineCount > devCtx.patchLimits.maxLinesChanged) {
      return {
        success: false,
        error: `Patch exceeds maxLinesChanged limit (${lineCount} lines > ${devCtx.patchLimits.maxLinesChanged}). Split the change into smaller patches.`,
        errorCode: 'patch_size_exceeded',
      };
    }

    // Enforce maxPatchAttemptsPerTask across all runs for this task
    if (context.taskId) {
      // guard-ignore-next-line: with-org-tx-or-scoped-db reason="system service — cross-tenant admin access intentional; no HTTP/ALS context"
      const taskRunRows = await db
        .select({ id: agentRuns.id })
        .from(agentRuns)
        .where(eq(agentRuns.taskId, context.taskId));
      const taskRunIds = taskRunRows.map(r => r.id);
      const patchCount = taskRunIds.length
        // guard-ignore-next-line: with-org-tx-or-scoped-db reason="system service — cross-tenant admin access intentional; no HTTP/ALS context"
        ? await db
            .select({ total: count() })
            .from(actions)
            .where(and(inArray(actions.agentRunId, taskRunIds), eq(actions.actionType, 'write_patch')))
            .then(rows => Number(rows[0]?.total ?? 0))
        : 0;
      if (patchCount >= devCtx.costLimits.maxPatchAttemptsPerTask) {
        return {
          success: false,
          error: `Patch attempt limit reached (${patchCount}/${devCtx.costLimits.maxPatchAttemptsPerTask} per task). Cannot propose more patches for this task without human review.`,
          errorCode: 'permission_failure',
        };
      }
    }

    // Auto-inject task_id so devopsAdapter can manage the correct branch
    if (context.taskId) {
      input = { ...input, task_id: context.taskId };
    }
  }

  // run_command: enforce maxCommandsPerRun cost limit
  if (actionType === 'run_command') {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="system service — cross-tenant admin access intentional; no HTTP/ALS context"
    const [countRow] = await db
      .select({ total: count() })
      .from(actions)
      .where(
        and(
          eq(actions.agentRunId, context.runId),
          eq(actions.actionType, 'run_command')
        )
      );
    const commandCount = Number(countRow?.total ?? 0);
    if (commandCount >= devCtx.costLimits.maxCommandsPerRun) {
      return {
        success: false,
        error: `Command limit reached (${commandCount}/${devCtx.costLimits.maxCommandsPerRun} per run). Cannot run more commands in this agent run.`,
        errorCode: 'permission_failure',
      };
    }
  }

  return proposeReviewGatedAction(actionType, input, context);
}

// ---------------------------------------------------------------------------
// Read Codebase — read a file from DEC projectRoot with path validation
// ---------------------------------------------------------------------------

const READ_CODEBASE_MAX_BYTES = 50 * 1024; // 50 KB

export async function executeReadCodebase(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const filePath = String(input.file_path ?? '');
  if (!filePath) return { success: false, error: 'file_path is required' };

  try {
    const { context: devCtx } = await devContextService.getContext(context.subaccountId!);
    const absolutePath = resolve(devCtx.projectRoot, filePath);

    assertPathInRoot(absolutePath, devCtx.projectRoot);

    const raw = await readFile(absolutePath, 'utf8');
    const rawBytes = Buffer.byteLength(raw, 'utf8');
    const truncated = rawBytes > READ_CODEBASE_MAX_BYTES;
    const content = truncated
      ? Buffer.from(raw, 'utf8').slice(0, READ_CODEBASE_MAX_BYTES).toString('utf8')
      : raw;

    return {
      success: true,
      file_path: filePath,
      content,
      truncated,
      size_bytes: rawBytes,
    };
  } catch (err) {
    const e = err as { message?: string; code?: string; statusCode?: number };
    if (e.statusCode === 403) return { success: false, error: e.message ?? 'Access denied' };
    if (e.code === 'ENOENT') return { success: false, error: `File not found: ${filePath}` };
    return { success: false, error: e.message ?? String(err) };
  }
}

// ---------------------------------------------------------------------------
// Search Codebase — grep content or glob filenames, scoped to projectRoot
// ---------------------------------------------------------------------------

export async function executeSearchCodebase(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const query = String(input.query ?? '');
  const searchType = String(input.search_type ?? 'content'); // 'content' | 'filename'
  const filePattern = input.file_pattern ? String(input.file_pattern) : undefined;
  const maxResults = Math.min(Number(input.max_results ?? 20), 50);

  if (!query) return { success: false, error: 'query is required' };

  try {
    const { context: devCtx } = await devContextService.getContext(context.subaccountId!);
    const root = devCtx.projectRoot;

    if (searchType === 'filename') {
      const pattern = filePattern ?? `**/*${query}*`;
      const matches: string[] = [];
      for (const file of await glob(pattern, { cwd: root })) {
        const strFile = String(file);
        matches.push(strFile);
        if (matches.length >= maxResults) break;
      }
      return {
        success: true,
        search_type: 'filename',
        query,
        results: matches.map(f => ({ file: f })),
        total: matches.length,
      };
    }

    // Content search using grep
    const includeArg = filePattern ? `--include=${filePattern}` : '--include=*';
    const grepArgs = ['-r', '-n', '--max-count=5', includeArg, query, root];

    const { stdout } = await execFileAsync('grep', grepArgs, {
      cwd: root,
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    }).catch((err: { stdout?: string; code?: number }) => {
      // grep exits 1 when no matches — not a real failure
      if (err.code === 1) return { stdout: '' };
      throw err;
    });

    const lines = stdout.trim().split('\n').filter(Boolean);
    const results = lines.slice(0, maxResults).map(line => {
      const colonIdx = line.indexOf(':');
      const secondColon = line.indexOf(':', colonIdx + 1);
      const file = line.slice(root.length + 1, colonIdx);
      const lineNum = secondColon !== -1 ? line.slice(colonIdx + 1, secondColon) : '';
      const content = secondColon !== -1 ? line.slice(secondColon + 1) : line.slice(colonIdx + 1);
      return { file, line: lineNum ? Number(lineNum) : undefined, content: content.trim() };
    });

    return {
      success: true,
      search_type: 'content',
      query,
      results,
      total: results.length,
      truncated: lines.length > maxResults,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Search failed: ${errMsg}` };
  }
}

// ---------------------------------------------------------------------------
// Run Tests — execute DEC testCommand, enforce maxTestRunsPerTask limit
// ---------------------------------------------------------------------------

export async function executeRunTests(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  let devCtxResult;
  try {
    devCtxResult = await devContextService.getContext(context.subaccountId!);
  } catch (err) {
    const msg = (err as { message?: string }).message ?? String(err);
    return { success: false, error: `Cannot load dev execution context: ${msg}` };
  }

  const { context: devCtx } = devCtxResult;

  // Enforce maxTestRunsPerTask cost limit
  // actions table has no taskId column; count via agentRuns.taskId → actions.agentRunId
  if (context.taskId) {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="system service — cross-tenant admin access intentional; no HTTP/ALS context"
    const taskRunRows = await db
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(eq(agentRuns.taskId, context.taskId));
    const taskRunIds = taskRunRows.map(r => r.id);
    const runCount = taskRunIds.length
      // guard-ignore-next-line: with-org-tx-or-scoped-db reason="system service — cross-tenant admin access intentional; no HTTP/ALS context"
      ? await db
          .select({ total: count() })
          .from(actions)
          .where(and(inArray(actions.agentRunId, taskRunIds), eq(actions.actionType, 'run_tests')))
          .then(rows => Number(rows[0]?.total ?? 0))
      : 0;
    if (runCount >= devCtx.costLimits.maxTestRunsPerTask) {
      return {
        success: false,
        error: `Test run limit reached (${runCount}/${devCtx.costLimits.maxTestRunsPerTask} per task). Cannot run more tests for this task.`,
        errorCode: 'permission_failure',
      };
    }
  }

  const testFilter = input.test_filter ? String(input.test_filter) : undefined;
  const baseCommand = devCtx.testCommand;
  const command = testFilter ? `${baseCommand} ${testFilter}` : baseCommand;

  const [cmd, ...args] = command.split(' ');
  const start = Date.now();

  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      cwd: devCtx.projectRoot,
      timeout: devCtx.resourceLimits.commandTimeoutMs,
      maxBuffer: devCtx.resourceLimits.maxOutputBytes,
      env: { ...process.env, ...devCtx.env },
    }).catch((err: { stdout?: string; stderr?: string; code?: number }) => {
      // Non-zero exit = test failures; still capture output
      return { stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
    });

    const durationMs = Date.now() - start;
    const output = (stdout + (stderr ? `\nSTDERR:\n${stderr}` : '')).slice(
      0,
      devCtx.resourceLimits.maxOutputBytes
    );
    const truncated = (stdout + stderr).length > devCtx.resourceLimits.maxOutputBytes;

    // Basic pass/fail detection from output
    const passed = /\d+ passed/.exec(output)?.[0] ?? null;
    const failed = /\d+ failed/.exec(output)?.[0] ?? null;

    return {
      success: true,
      command,
      output,
      truncated,
      duration_ms: durationMs,
      passed,
      failed,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Test execution failed: ${errMsg}` };
  }
}
