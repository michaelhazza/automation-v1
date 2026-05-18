/**
 * Pure helpers for check-validator-isolation.ts.
 * Exported for unit testing; no filesystem or process side-effects.
 */

export const EXCLUDED_FILES = new Set([
  'registry.ts',
  'types.ts',
  'entityResolverRegistry.ts',
]);

export const FORBIDDEN_IMPORT_PATTERNS: RegExp[] = [
  /['"]node:fs['"]/,
  /from\s+['"]fs['"]/,
  /require\s*\(\s*['"]fs['"]\s*\)/,
  /['"]node:net['"]/,
  /from\s+['"]net['"]/,
  /['"]node:http['"]/,
  /from\s+['"]http['"]/,
  /['"]node:https['"]/,
  /from\s+['"]https['"]/,
  /process\.env/,
  /from\s+['"][^'"]*\/db['"]/,
  /from\s+['"][^'"]*drizzle[^'"]*['"]/,
  /from\s+['"]drizzle[^'"]*['"]/,
  /from\s+['"]postgres['"]/,
  /from\s+['"][^'"]*\/pg['"]/,
  /require\s*\(\s*['"][^'"]*\/db['"]\s*\)/,
  /require\s*\(\s*['"]pg['"]\s*\)/,
];

export interface Violation {
  lineNumber: number;
  line: string;
  pattern: string;
}

export function extractValidatorKind(source: string): string | null {
  const match = source.match(/kind\s*:\s*['"]([^'"]+)['"]/);
  return match ? match[1] : null;
}

function describeFirstMatch(line: string): string {
  for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
    if (pattern.test(line)) {
      return pattern.toString();
    }
  }
  return 'unknown forbidden pattern';
}

export function checkSource(source: string): Violation[] {
  const kind = extractValidatorKind(source);
  if (kind !== 'deterministic') {
    return [];
  }
  const lines = source.split('\n');
  const violations: Violation[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
      if (pattern.test(line)) {
        violations.push({ lineNumber: i + 1, line: line.trim(), pattern: describeFirstMatch(line) });
        break;
      }
    }
  }
  return violations;
}

export function isValidatorFile(filename: string): boolean {
  return (
    filename.endsWith('.ts') &&
    !filename.endsWith('.test.ts') &&
    !EXCLUDED_FILES.has(filename)
  );
}
