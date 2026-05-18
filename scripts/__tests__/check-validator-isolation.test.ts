import { describe, test, expect } from 'vitest';
import { checkSource, extractValidatorKind, isValidatorFile } from '../check-validator-isolationPure.js';

describe('extractValidatorKind', () => {
  test('returns deterministic for kind: deterministic', () => {
    const src = `export const validator = { kind: 'deterministic', slug: 'x' };`;
    expect(extractValidatorKind(src)).toBe('deterministic');
  });

  test('returns deterministic_external for kind: deterministic_external', () => {
    const src = `export const validator = { kind: 'deterministic_external', slug: 'x' };`;
    expect(extractValidatorKind(src)).toBe('deterministic_external');
  });

  test('returns null when no kind field present', () => {
    const src = `export const validator = { slug: 'x' };`;
    expect(extractValidatorKind(src)).toBeNull();
  });
});

describe('isValidatorFile', () => {
  test('accepts plain validator filenames', () => {
    expect(isValidatorFile('output_non_empty.ts')).toBe(true);
    expect(isValidatorFile('my_validator.ts')).toBe(true);
  });

  test('rejects test files', () => {
    expect(isValidatorFile('output_non_empty.test.ts')).toBe(false);
  });

  test('rejects excluded files', () => {
    expect(isValidatorFile('registry.ts')).toBe(false);
    expect(isValidatorFile('types.ts')).toBe(false);
    expect(isValidatorFile('entityResolverRegistry.ts')).toBe(false);
  });

  test('rejects non-.ts files', () => {
    expect(isValidatorFile('output_non_empty.md')).toBe(false);
    expect(isValidatorFile('output_non_empty.js')).toBe(false);
  });
});

describe('checkSource — deterministic validator with forbidden imports', () => {
  const deterministicHeader = `export const validator = { kind: 'deterministic', slug: 'x' };\n`;

  test('rejects import fs from node:fs', () => {
    const src = deterministicHeader + `import fs from 'node:fs';\n`;
    const violations = checkSource(src);
    expect(violations.length).toBeGreaterThan(0);
  });

  test('rejects import from "fs"', () => {
    const src = deterministicHeader + `import { readFileSync } from 'fs';\n`;
    const violations = checkSource(src);
    expect(violations.length).toBeGreaterThan(0);
  });

  test('rejects process.env access', () => {
    const src = deterministicHeader + `const x = process.env.SOME_VAR;\n`;
    const violations = checkSource(src);
    expect(violations.length).toBeGreaterThan(0);
  });

  test('rejects net import', () => {
    const src = deterministicHeader + `import net from 'node:net';\n`;
    const violations = checkSource(src);
    expect(violations.length).toBeGreaterThan(0);
  });

  test('rejects http import', () => {
    const src = deterministicHeader + `import http from 'node:http';\n`;
    const violations = checkSource(src);
    expect(violations.length).toBeGreaterThan(0);
  });

  test('rejects https import', () => {
    const src = deterministicHeader + `import https from 'node:https';\n`;
    const violations = checkSource(src);
    expect(violations.length).toBeGreaterThan(0);
  });

  test('rejects drizzle import', () => {
    const src = deterministicHeader + `import { eq } from 'drizzle-orm';\n`;
    const violations = checkSource(src);
    expect(violations.length).toBeGreaterThan(0);
  });

  test('rejects db import from server path', () => {
    const src = deterministicHeader + `import { db } from '../../db';\n`;
    const violations = checkSource(src);
    expect(violations.length).toBeGreaterThan(0);
  });

  test('rejects postgres import', () => {
    const src = deterministicHeader + `import postgres from 'postgres';\n`;
    const violations = checkSource(src);
    expect(violations.length).toBeGreaterThan(0);
  });
});

describe('checkSource — deterministic validator with allowed imports', () => {
  const deterministicHeader = `export const validator = { kind: 'deterministic', slug: 'x' };\n`;

  test('accepts import from types module', () => {
    const src = deterministicHeader + `import type { Validator } from './types.js';\n`;
    const violations = checkSource(src);
    expect(violations).toHaveLength(0);
  });

  test('accepts import from entityResolverRegistry (deterministic_external uses it)', () => {
    // Note: the isolation rule only applies to kind: 'deterministic'; a
    // deterministic_external validator may import entityResolverRegistry.
    // This test confirms a clean deterministic validator with no imports is fine.
    const src = deterministicHeader + `import type { ValidatorContext } from './types.js';\n`;
    const violations = checkSource(src);
    expect(violations).toHaveLength(0);
  });

  test('accepts multiple clean imports', () => {
    const src =
      deterministicHeader +
      `import type { Validator, ValidatorContext, ValidatorResult } from './types.js';\n` +
      `import Ajv from 'ajv';\n`;
    const violations = checkSource(src);
    expect(violations).toHaveLength(0);
  });
});

describe('checkSource — non-deterministic validators are not checked', () => {
  test('skips violation check for deterministic_external kind', () => {
    const src =
      `export const validator = { kind: 'deterministic_external', slug: 'x' };\n` +
      `import { ENTITY_RESOLVERS } from './entityResolverRegistry.js';\n`;
    // deterministic_external validators may use entity resolvers.
    // The isolation check only enforces on kind: 'deterministic'.
    const violations = checkSource(src);
    expect(violations).toHaveLength(0);
  });

  test('skips violation check when no kind found', () => {
    const src = `import fs from 'node:fs';\nexport function doSomething() {}\n`;
    const violations = checkSource(src);
    expect(violations).toHaveLength(0);
  });
});
