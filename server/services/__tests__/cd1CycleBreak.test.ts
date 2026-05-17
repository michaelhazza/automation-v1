// guard-ignore-file: pure-helper-convention reason="structural gate reads handler files directly via fs; no service-level import is meaningful here"
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const HANDLERS_DIR = join(process.cwd(), 'server/services/skillExecutor/handlers');
const WORKFLOW_ACTION_CALL = join(process.cwd(), 'server/services/workflowActionCallExecutor.ts');

const FORBIDDEN_PATTERNS = [
  // Static value-imports of workflowEngineService from handler files
  /from\s+['"].*workflowEngineService\.js['"]/,
  // Static value-imports of workflowRunStartSkillService from handler files
  /from\s+['"].*workflowRunStartSkillService\.js['"]/,
];

// import type { ... } is allowed — TypeScript erases it at compile time
const TYPE_IMPORT = /import\s+type\s+/;

describe('CD1 cycle-break assertions', () => {
  it('skill handler files have no static value-import of workflowEngineService or workflowRunStartSkillService', () => {
    const handlerFiles = readdirSync(HANDLERS_DIR)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
      .map((f) => join(HANDLERS_DIR, f));

    const violations: string[] = [];

    for (const file of handlerFiles) {
      const src = readFileSync(file, 'utf-8');
      const lines = src.split('\n');
      for (const [idx, line] of lines.entries()) {
        // Skip type-only imports — they are erased by TypeScript
        if (TYPE_IMPORT.test(line)) continue;
        for (const pattern of FORBIDDEN_PATTERNS) {
          if (pattern.test(line)) {
            violations.push(`${file}:${idx + 1}: ${line.trim()}`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('workflowActionCallExecutor has no static value-import of skillExecutor', () => {
    const src = readFileSync(WORKFLOW_ACTION_CALL, 'utf-8');
    const lines = src.split('\n');
    const violations: string[] = [];

    for (const [idx, line] of lines.entries()) {
      if (TYPE_IMPORT.test(line)) continue;
      if (/from\s+['"].*skillExecutor['"]/i.test(line) && !line.includes('SkillExecutionContext')) {
        violations.push(`${idx + 1}: ${line.trim()}`);
      }
    }

    expect(violations).toEqual([]);
  });
});
