/**
 * Best-effort zod-based validator for Automation input/output schemas.
 * §5.4 / §5.5 — if the column is empty or unparseable, validation is skipped
 * and the step proceeds. Only structured JSON Schema subsets are compiled.
 *
 * Architect decision §2 item 1: zod is already a runtime dep; no new vendor
 * dep. additionalProperties defaults to permissive (true) unless the parsed
 * schema explicitly declares false.
 */

import { z } from 'zod';

interface SimpleJsonSchema {
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

function compileSchema(raw: unknown): z.ZodTypeAny | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const schema = raw as SimpleJsonSchema;

  const shape: Record<string, z.ZodTypeAny> = {};
  if (schema.properties && typeof schema.properties === 'object') {
    for (const [key] of Object.entries(schema.properties)) {
      shape[key] = z.unknown();
    }
  }

  const required = Array.isArray(schema.required) ? schema.required : [];
  const additionalProperties = schema.additionalProperties !== false;

  const base =
    Object.keys(shape).length > 0
      ? z.object(shape).partial()
      : z.record(z.unknown());

  if (!additionalProperties && Object.keys(shape).length > 0) {
    return z.object(shape).partial().superRefine((val, ctx) => {
      const allowed = new Set(Object.keys(shape));
      for (const key of Object.keys(val as object)) {
        if (!allowed.has(key)) {
          ctx.addIssue({ code: z.ZodIssueCode.unrecognized_keys, keys: [key] });
        }
      }
      for (const req of required) {
        if ((val as Record<string, unknown>)[req] === undefined) {
          ctx.addIssue({ code: z.ZodIssueCode.invalid_type, expected: 'unknown', received: 'undefined', path: [req] });
        }
      }
    });
  }

  return base.superRefine((val, ctx) => {
    for (const req of required) {
      if ((val as Record<string, unknown>)[req] === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.invalid_type, expected: 'unknown', received: 'undefined', path: [req] });
      }
    }
  });
}

export type SchemaValidationResult =
  | { ok: true }
  | { ok: false; errors: string[] };

/** Validate `data` against a raw JSON-Schema text column. §5.4 best-effort. */
export function validateInput(
  data: unknown,
  schemaText: string | null | undefined,
): SchemaValidationResult {
  if (!schemaText) return { ok: true };
  let parsed: unknown;
  try { parsed = JSON.parse(schemaText); } catch { return { ok: true }; }
  const compiled = compileSchema(parsed);
  if (!compiled) return { ok: true };
  const result = compiled.safeParse(data);
  if (result.success) return { ok: true };
  return { ok: false, errors: result.error.errors.map((e) => e.message) };
}

/** Validate `data` against a raw JSON-Schema text column. §5.5 best-effort. */
export function validateOutput(
  data: unknown,
  schemaText: string | null | undefined,
): SchemaValidationResult {
  return validateInput(data, schemaText);
}
