/**
 * registrySerialiserPure.ts
 *
 * Pure serialisation helpers for ACTION_REGISTRY snapshot/diff tooling.
 *
 * Public surface:
 *   serialiseRegistry(reg) -> SerialisedRegistry
 *
 * Everything else (Zod walker, field-shape extraction, key ordering) is hidden
 * behind that single export.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ZodFieldShape {
  type: string;
  optional?: true;
  describe?: string;
  enum?: unknown[];
  items?: ZodFieldShape;
  /** For ZodObject: map of field name → nested shape */
  properties?: Record<string, ZodFieldShape>;
  /** For ZodRecord: value-side shape */
  valueShape?: ZodFieldShape;
  /** For ZodDefault: unwrapped inner shape */
  innerShape?: ZodFieldShape;
  /** For ZodUnion / ZodDiscriminatedUnion: variant shapes */
  variants?: ZodFieldShape[];
  /** For ZodDiscriminatedUnion: the discriminator key */
  discriminator?: string;
  /** For ZodLiteral: the literal value */
  literal?: unknown;
  /** For ZodTuple: element shapes */
  elements?: ZodFieldShape[];
  default?: unknown;
  min?: number;
  max?: number;
  length?: number;
}

export interface SerialisedEntry {
  /** All ActionDefinition fields except parameterSchema (replaced by parameterSchemaShape) */
  [key: string]: unknown;
  parameterSchemaShape: Record<string, ZodFieldShape>;
}

export interface SerialisedRegistry {
  version: 1;
  capturedAt: string;
  entries: Record<string, SerialisedEntry>;
}

// ---------------------------------------------------------------------------
// Zod _def walker (internal)
// ---------------------------------------------------------------------------

/**
 * Walk a Zod schema's `_def` and produce a deterministic ZodFieldShape.
 * Caps recursion at `maxDepth` (default 8) to guard against accidental cycles.
 */
function walkZodDef(def: Record<string, unknown>, depth = 0): ZodFieldShape {
  if (depth > 8) {
    return { type: 'ZodUnknown' };
  }

  const typeName = def['typeName'] as string | undefined;

  // ------------------------------------------------------------------
  // ZodOptional — unwrap and set optional flag
  // ------------------------------------------------------------------
  if (typeName === 'ZodOptional') {
    const inner = walkZodDef(
      (def['innerType'] as { _def: Record<string, unknown> })._def,
      depth + 1,
    );
    return { ...inner, optional: true };
  }

  // ------------------------------------------------------------------
  // ZodDefault — unwrap, capture default value
  // ------------------------------------------------------------------
  if (typeName === 'ZodDefault') {
    const inner = walkZodDef(
      (def['innerType'] as { _def: Record<string, unknown> })._def,
      depth + 1,
    );
    let defaultValue: unknown;
    try {
      defaultValue = typeof def['defaultValue'] === 'function'
        ? (def['defaultValue'] as () => unknown)()
        : def['defaultValue'];
    } catch {
      defaultValue = undefined;
    }
    return { ...inner, innerShape: inner, default: defaultValue };
  }

  // ------------------------------------------------------------------
  // ZodNullable — treat like optional for shape purposes
  // ------------------------------------------------------------------
  if (typeName === 'ZodNullable') {
    const inner = walkZodDef(
      (def['innerType'] as { _def: Record<string, unknown> })._def,
      depth + 1,
    );
    return { ...inner, optional: true };
  }

  // ------------------------------------------------------------------
  // ZodString
  // ------------------------------------------------------------------
  if (typeName === 'ZodString') {
    const shape: ZodFieldShape = { type: 'ZodString' };
    const checks = (def['checks'] as Array<{ kind: string; value?: number }>) ?? [];
    for (const check of checks) {
      if (check.kind === 'min') shape.min = check.value;
      if (check.kind === 'max') shape.max = check.value;
      if (check.kind === 'length') shape.length = check.value;
    }
    if (def['description']) shape.describe = def['description'] as string;
    return shape;
  }

  // ------------------------------------------------------------------
  // ZodNumber
  // ------------------------------------------------------------------
  if (typeName === 'ZodNumber') {
    const shape: ZodFieldShape = { type: 'ZodNumber' };
    const checks = (def['checks'] as Array<{ kind: string; value?: number }>) ?? [];
    for (const check of checks) {
      if (check.kind === 'min') shape.min = check.value;
      if (check.kind === 'max') shape.max = check.value;
    }
    if (def['description']) shape.describe = def['description'] as string;
    return shape;
  }

  // ------------------------------------------------------------------
  // ZodBoolean
  // ------------------------------------------------------------------
  if (typeName === 'ZodBoolean') {
    const shape: ZodFieldShape = { type: 'ZodBoolean' };
    if (def['description']) shape.describe = def['description'] as string;
    return shape;
  }

  // ------------------------------------------------------------------
  // ZodEnum
  // ------------------------------------------------------------------
  if (typeName === 'ZodEnum') {
    const shape: ZodFieldShape = {
      type: 'ZodEnum',
      enum: def['values'] as unknown[],
    };
    if (def['description']) shape.describe = def['description'] as string;
    return shape;
  }

  // ------------------------------------------------------------------
  // ZodLiteral
  // ------------------------------------------------------------------
  if (typeName === 'ZodLiteral') {
    const shape: ZodFieldShape = {
      type: 'ZodLiteral',
      literal: def['value'],
    };
    if (def['description']) shape.describe = def['description'] as string;
    return shape;
  }

  // ------------------------------------------------------------------
  // ZodArray
  // ------------------------------------------------------------------
  if (typeName === 'ZodArray') {
    const itemsDef = (def['type'] as { _def: Record<string, unknown> })._def;
    const shape: ZodFieldShape = {
      type: 'ZodArray',
      items: walkZodDef(itemsDef, depth + 1),
    };
    const checks = (def['exactLength'] || def['minLength'] || def['maxLength'])
      ? [
          def['minLength'] ? { kind: 'min', value: (def['minLength'] as { value: number }).value } : null,
          def['maxLength'] ? { kind: 'max', value: (def['maxLength'] as { value: number }).value } : null,
          def['exactLength'] ? { kind: 'length', value: (def['exactLength'] as { value: number }).value } : null,
        ].filter(Boolean) as Array<{ kind: string; value: number }>
      : [];
    for (const check of checks) {
      if (check.kind === 'min') shape.min = check.value;
      if (check.kind === 'max') shape.max = check.value;
      if (check.kind === 'length') shape.length = check.value;
    }
    if (def['description']) shape.describe = def['description'] as string;
    return shape;
  }

  // ------------------------------------------------------------------
  // ZodObject
  // ------------------------------------------------------------------
  if (typeName === 'ZodObject') {
    const rawShape = typeof def['shape'] === 'function'
      ? (def['shape'] as () => Record<string, { _def: Record<string, unknown> }>)()
      : (def['shape'] as Record<string, { _def: Record<string, unknown> }>);
    const properties: Record<string, ZodFieldShape> = {};
    for (const [key, fieldSchema] of Object.entries(rawShape).sort(([a], [b]) => a.localeCompare(b))) {
      properties[key] = walkZodSchema(fieldSchema as unknown, depth + 1);
    }
    const shape: ZodFieldShape = { type: 'ZodObject', properties };
    if (def['description']) shape.describe = def['description'] as string;
    return shape;
  }

  // ------------------------------------------------------------------
  // ZodRecord
  // ------------------------------------------------------------------
  if (typeName === 'ZodRecord') {
    const valueType = def['valueType'] as { _def: Record<string, unknown> } | undefined;
    const shape: ZodFieldShape = {
      type: 'ZodRecord',
      valueShape: valueType ? walkZodDef(valueType._def, depth + 1) : { type: 'ZodUnknown' },
    };
    if (def['description']) shape.describe = def['description'] as string;
    return shape;
  }

  // ------------------------------------------------------------------
  // ZodUnion
  // ------------------------------------------------------------------
  if (typeName === 'ZodUnion') {
    const options = def['options'] as Array<{ _def: Record<string, unknown> }>;
    const shape: ZodFieldShape = {
      type: 'ZodUnion',
      variants: options.map(o => walkZodDef(o._def, depth + 1)),
    };
    if (def['description']) shape.describe = def['description'] as string;
    return shape;
  }

  // ------------------------------------------------------------------
  // ZodDiscriminatedUnion
  // ------------------------------------------------------------------
  if (typeName === 'ZodDiscriminatedUnion') {
    const discriminator = def['discriminator'] as string;
    const options = def['options'] as Array<{ _def: Record<string, unknown> }>;
    const shape: ZodFieldShape = {
      type: 'ZodDiscriminatedUnion',
      discriminator,
      variants: options.map(o => walkZodDef(o._def, depth + 1)),
    };
    if (def['description']) shape.describe = def['description'] as string;
    return shape;
  }

  // ------------------------------------------------------------------
  // ZodTuple
  // ------------------------------------------------------------------
  if (typeName === 'ZodTuple') {
    const items = def['items'] as Array<{ _def: Record<string, unknown> }>;
    const shape: ZodFieldShape = {
      type: 'ZodTuple',
      elements: items.map(i => walkZodDef(i._def, depth + 1)),
    };
    if (def['description']) shape.describe = def['description'] as string;
    return shape;
  }

  // ------------------------------------------------------------------
  // ZodUnknown / ZodAny / ZodNull / ZodUndefined / ZodNever / ZodVoid
  // ------------------------------------------------------------------
  if (
    typeName === 'ZodUnknown' ||
    typeName === 'ZodAny' ||
    typeName === 'ZodNull' ||
    typeName === 'ZodUndefined' ||
    typeName === 'ZodNever' ||
    typeName === 'ZodVoid'
  ) {
    const shape: ZodFieldShape = { type: typeName ?? 'ZodUnknown' };
    if (def['description']) shape.describe = def['description'] as string;
    return shape;
  }

  // ------------------------------------------------------------------
  // Fallback
  // ------------------------------------------------------------------
  return { type: typeName ?? 'ZodUnknown' };
}

/**
 * Walk a Zod schema instance (has a `._def` property) and produce a shape.
 */
function walkZodSchema(schema: unknown, depth = 0): ZodFieldShape {
  if (schema == null || typeof schema !== 'object') {
    return { type: 'ZodUnknown' };
  }
  const s = schema as { _def?: Record<string, unknown>; description?: string };
  if (!s._def) {
    return { type: 'ZodUnknown' };
  }
  const shape = walkZodDef(s._def, depth);
  // Zod attaches description at the schema instance level in some versions
  if (s.description && !shape.describe) {
    shape.describe = s.description;
  }
  return shape;
}

/**
 * Serialise the top-level fields of a ZodObject parameterSchema.
 * Returns a Record<string, ZodFieldShape> keyed by field name, alphabetically ordered.
 */
function serialiseParameterSchema(schema: unknown): Record<string, ZodFieldShape> {
  if (schema == null || typeof schema !== 'object') {
    return {};
  }
  const s = schema as { _def?: Record<string, unknown> };
  if (!s._def) return {};

  const def = s._def;
  const typeName = def['typeName'] as string | undefined;
  if (typeName !== 'ZodObject') {
    // Non-object schema at top level — return a single entry describing the whole schema
    return { _root: walkZodDef(def, 0) };
  }

  const rawShape = typeof def['shape'] === 'function'
    ? (def['shape'] as () => Record<string, unknown>)()
    : (def['shape'] as Record<string, unknown>);

  const result: Record<string, ZodFieldShape> = {};
  for (const [key, fieldSchema] of Object.entries(rawShape).sort(([a], [b]) => a.localeCompare(b))) {
    result[key] = walkZodSchema(fieldSchema, 1);
    // Attach description from the Zod schema instance if not already captured
    const fs = fieldSchema as { description?: string };
    if (fs.description && !result[key].describe) {
      result[key].describe = fs.description;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Serialise the full ACTION_REGISTRY into a stable, diffable structure.
 * Keys are ordered alphabetically. `parameterSchema` is replaced with
 * `parameterSchemaShape`.
 */
export function serialiseRegistry(
  registry: Record<string, Record<string, unknown>>,
  capturedAt: string,
): SerialisedRegistry {
  const entries: Record<string, SerialisedEntry> = {};

  for (const slug of Object.keys(registry).sort()) {
    const def = registry[slug];
    const { parameterSchema, ...rest } = def as Record<string, unknown> & {
      parameterSchema?: unknown;
    };

    const serialised: SerialisedEntry = {
      ...sortObjectKeys(rest),
      parameterSchemaShape: serialiseParameterSchema(parameterSchema),
    };

    entries[slug] = serialised;
  }

  return { version: 1, capturedAt, entries };
}

/** Sort an object's keys alphabetically for deterministic serialisation. */
function sortObjectKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key];
  }
  return sorted;
}
