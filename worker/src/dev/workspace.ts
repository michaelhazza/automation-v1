// ---------------------------------------------------------------------------
// Dev workspace lifecycle + path safety. Spec §7.2, §7.3.
// ---------------------------------------------------------------------------

import { promises as fs } from 'fs';
import path from 'path';
import { env } from '../config/env.js';
import { SafetyError } from '../../../shared/iee/failureReason.js';

export interface Workspace {
  dir: string;
  destroy(): Promise<void>;
}

export async function createWorkspace(ieeRunId: string): Promise<Workspace> {
  const dir = path.join(env.WORKSPACE_BASE_DIR, ieeRunId);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  return {
    dir,
    async destroy(): Promise<void> {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

/**
 * Resolve a candidate path against the workspace, refusing any path that
 * escapes via .. or absolute paths. Symlinks are dereferenced after the
 * write to detect escape attempts.
 */
export function resolveSafePath(workspaceDir: string, candidate: string): string {
  if (path.isAbsolute(candidate)) {
    throw new SafetyError(`absolute path not allowed: ${candidate}`, 'path_outside_workspace');
  }
  const resolved = path.resolve(workspaceDir, candidate);
  const rel = path.relative(workspaceDir, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new SafetyError(`path escapes workspace: ${candidate}`, 'path_outside_workspace');
  }
  return resolved;
}

/** Re-validate after a write/read in case symlinks were involved. */
export async function assertStillInsideWorkspace(workspaceDir: string, candidatePath: string): Promise<void> {
  try {
    const real = await fs.realpath(candidatePath);
    const root = await fs.realpath(workspaceDir);
    const rel = path.relative(root, real);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new SafetyError(`symlink escape detected: ${candidatePath}`, 'path_outside_workspace');
    }
  } catch (err) {
    if (err instanceof SafetyError) throw err;
    // realpath ENOENT etc — ignore (file may have been removed by the action)
  }
}

/** Recursively list files in the workspace, capped. Used by the observation. */
export async function listWorkspaceFiles(
  workspaceDir: string,
  opts: { maxDepth: number; max: number },
): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (out.length >= opts.max) return;
    if (depth > opts.maxDepth) return;
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= opts.max) return;
      const full = path.join(dir, entry.name);
      const rel = path.relative(workspaceDir, full);
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules') {
          out.push(`${rel}/`);
          continue;
        }
        await walk(full, depth + 1);
      } else {
        out.push(rel);
      }
    }
  }
  await walk(workspaceDir, 0);
  return out;
}
