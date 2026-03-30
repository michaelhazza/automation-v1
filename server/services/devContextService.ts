import { createHash } from 'crypto';
import { resolve } from 'path';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { subaccounts } from '../db/schema/index.js';

// ---------------------------------------------------------------------------
// Dev Execution Context (DEC) — per-subaccount config for Dev/QA agents
// Loaded from subaccounts.settings.devContext
// ---------------------------------------------------------------------------

export interface DevContextGitConfig {
  defaultBranch: string;
  branchPrefix: string;
  remote: string;
  repoOwner: string;
  repoName: string;
  reuseBranchPerTask: boolean;
}

export interface DevContext {
  projectRoot: string;
  runtime: string;
  packageManager: string;
  testCommand: string;
  buildCommand: string;
  lintCommand: string;
  env: Record<string, string>;
  allowedCommands: string[];
  blockedPatterns: string[];
  gitConfig: DevContextGitConfig;
  resourceLimits: {
    commandTimeoutMs: number;
    maxOutputBytes: number;
  };
  costLimits: {
    maxTestRunsPerTask: number;
    maxCommandsPerRun: number;
    maxPatchAttemptsPerTask: number;
  };
  patchLimits: {
    maxFilesPerPatch: number;
    maxLinesChanged: number;
  };
  safeMode: boolean;
}

export interface DevContextResult {
  context: DevContext;
  hash: string;
}

function validateDevContext(raw: unknown): DevContext {
  if (!raw || typeof raw !== 'object') {
    throw { statusCode: 400, message: 'devContext is missing or invalid in subaccount settings' };
  }

  const ctx = raw as Record<string, unknown>;

  if (!ctx.projectRoot || typeof ctx.projectRoot !== 'string') {
    throw { statusCode: 400, message: 'devContext.projectRoot is required' };
  }
  if (!ctx.testCommand || typeof ctx.testCommand !== 'string') {
    throw { statusCode: 400, message: 'devContext.testCommand is required' };
  }
  if (!ctx.gitConfig || typeof ctx.gitConfig !== 'object') {
    throw { statusCode: 400, message: 'devContext.gitConfig is required' };
  }

  const git = ctx.gitConfig as Record<string, unknown>;
  if (!git.repoOwner || !git.repoName) {
    throw { statusCode: 400, message: 'devContext.gitConfig.repoOwner and repoName are required' };
  }

  return {
    projectRoot: ctx.projectRoot as string,
    runtime: (ctx.runtime as string) ?? 'node@20',
    packageManager: (ctx.packageManager as string) ?? 'npm',
    testCommand: ctx.testCommand as string,
    buildCommand: (ctx.buildCommand as string) ?? 'npm run build',
    lintCommand: (ctx.lintCommand as string) ?? 'npm run lint',
    env: (ctx.env as Record<string, string>) ?? {},
    allowedCommands: (ctx.allowedCommands as string[]) ?? [],
    blockedPatterns: (ctx.blockedPatterns as string[]) ?? [
      'rm -rf', 'sudo', 'curl.*|.*sh', 'npm publish',
      'git push.*--force', 'git reset --hard',
    ],
    gitConfig: {
      defaultBranch: (git.defaultBranch as string) ?? 'main',
      branchPrefix: (git.branchPrefix as string) ?? 'agent/',
      remote: (git.remote as string) ?? 'origin',
      repoOwner: git.repoOwner as string,
      repoName: git.repoName as string,
      reuseBranchPerTask: (git.reuseBranchPerTask as boolean) ?? true,
    },
    resourceLimits: {
      commandTimeoutMs: ((ctx.resourceLimits as Record<string, unknown>)?.commandTimeoutMs as number) ?? 60000,
      maxOutputBytes: ((ctx.resourceLimits as Record<string, unknown>)?.maxOutputBytes as number) ?? 1048576,
    },
    costLimits: {
      maxTestRunsPerTask: ((ctx.costLimits as Record<string, unknown>)?.maxTestRunsPerTask as number) ?? 5,
      maxCommandsPerRun: ((ctx.costLimits as Record<string, unknown>)?.maxCommandsPerRun as number) ?? 10,
      maxPatchAttemptsPerTask: ((ctx.costLimits as Record<string, unknown>)?.maxPatchAttemptsPerTask as number) ?? 10,
    },
    patchLimits: {
      maxFilesPerPatch: ((ctx.patchLimits as Record<string, unknown>)?.maxFilesPerPatch as number) ?? 10,
      maxLinesChanged: ((ctx.patchLimits as Record<string, unknown>)?.maxLinesChanged as number) ?? 500,
    },
    safeMode: (ctx.safeMode as boolean) ?? true,
  };
}

function hashDevContext(ctx: DevContext): string {
  return createHash('sha256').update(JSON.stringify(ctx)).digest('hex');
}

/**
 * Validates that a path is safely inside projectRoot.
 * Blocks path traversal and symlink abuse.
 */
export function assertPathInRoot(filePath: string, projectRoot: string): void {
  const resolved = resolve(filePath);
  const root = resolve(projectRoot);
  if (!resolved.startsWith(root + '/') && resolved !== root) {
    throw {
      statusCode: 403,
      message: `Path "${filePath}" is outside the project root. Access denied.`,
      errorCode: 'permission_failure',
    };
  }

  // Block access to sensitive files regardless of location
  const blocked = ['.env', '.git/config', 'node_modules/.cache'];
  for (const b of blocked) {
    if (resolved.includes('/' + b) || resolved.endsWith('/' + b)) {
      throw {
        statusCode: 403,
        message: `Access to "${b}" is blocked.`,
        errorCode: 'permission_failure',
      };
    }
  }
}

export const devContextService = {
  /**
   * Load, validate, and hash the DEC from subaccount settings.
   * Throws if devContext is not configured.
   */
  async getContext(subaccountId: string): Promise<DevContextResult> {
    const [row] = await db
      .select({ settings: subaccounts.settings })
      .from(subaccounts)
      .where(and(eq(subaccounts.id, subaccountId), isNull(subaccounts.deletedAt)));

    if (!row) {
      throw { statusCode: 404, message: 'Subaccount not found' };
    }

    const settings = row.settings as Record<string, unknown> | null;
    const rawDevContext = settings?.devContext;

    if (!rawDevContext) {
      throw {
        statusCode: 400,
        message: 'This subaccount has no Dev Execution Context configured. Add devContext to subaccount settings before using dev/QA skills.',
        errorCode: 'environment_failure',
      };
    }

    const context = validateDevContext(rawDevContext);
    const hash = hashDevContext(context);

    return { context, hash };
  },

  /**
   * Validate a command against the DEC allowlist and blocklist.
   * Returns an error string if blocked, undefined if allowed.
   */
  validateCommand(command: string, context: DevContext): string | undefined {
    // Check blockedPatterns first (regex deny list)
    for (const pattern of context.blockedPatterns) {
      try {
        if (new RegExp(pattern).test(command)) {
          return `Command matches blocked pattern "${pattern}". Execution refused.`;
        }
      } catch {
        // If pattern is not valid regex, do literal match
        if (command.includes(pattern)) {
          return `Command contains blocked pattern "${pattern}". Execution refused.`;
        }
      }
    }

    // Check allowedCommands whitelist (exact prefix match)
    if (context.allowedCommands.length > 0) {
      const allowed = context.allowedCommands.some(allowed =>
        command === allowed || command.startsWith(allowed + ' ')
      );
      if (!allowed) {
        return `Command "${command}" is not in the allowed commands list. Add it to devContext.allowedCommands to permit this command.`;
      }
    }

    return undefined;
  },
};
