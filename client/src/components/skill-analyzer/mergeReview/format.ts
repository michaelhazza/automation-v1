export type FieldKey = 'name' | 'description' | 'definition' | 'instructions';
export const SHORT_FIELDS: FieldKey[] = ['name', 'description'];
export const LONG_FIELDS: FieldKey[] = ['definition', 'instructions'];

export function definitionToString(def: object | null | undefined): string {
  if (def === null || def === undefined) return '';
  try {
    return JSON.stringify(def, null, 2);
  } catch {
    return '';
  }
}

export function tryParseJson(text: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const value: unknown = JSON.parse(text);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: 'definition must be a JSON object' };
    }
    return { ok: true, value: value as Record<string, unknown> };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'invalid JSON' };
  }
}

export type ParsedNameMismatch = {
  topLevel?: string;
  schemaName?: string | null;
  distinctNames?: string[];
  candidates?: string[];
};

export function parseNameMismatchDetail(detail: string | undefined): ParsedNameMismatch {
  if (!detail) return {};
  try {
    return JSON.parse(detail) as ParsedNameMismatch;
  } catch {
    return {};
  }
}
