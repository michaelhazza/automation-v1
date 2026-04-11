// ---------------------------------------------------------------------------
// Skill Parameters — pure conversion utilities
// Shared between server (parser) and client (parameter builder UI).
// Zero dependencies.
// ---------------------------------------------------------------------------

export interface SkillParameter {
  name: string;
  type: 'string' | 'number' | 'integer' | 'boolean' | 'enum';
  required: boolean;
  description: string;
  enumValues?: string[]; // only when type === 'enum'
}

// ---------------------------------------------------------------------------
// Parameters → JSON Schema
// ---------------------------------------------------------------------------

/** Convert a flat parameter list into a JSON Schema properties object + required array. */
export function parametersToSchema(params: SkillParameter[]): {
  properties: Record<string, object>;
  required: string[];
} {
  const properties: Record<string, object> = {};
  const required: string[] = [];

  for (const p of params) {
    if (p.type === 'enum' && p.enumValues && p.enumValues.length > 0) {
      properties[p.name] = {
        type: 'string',
        enum: p.enumValues,
        description: p.description,
      };
    } else {
      properties[p.name] = {
        type: p.type === 'enum' ? 'string' : p.type,
        description: p.description,
      };
    }
    if (p.required) required.push(p.name);
  }

  return { properties, required };
}

// ---------------------------------------------------------------------------
// JSON Schema → Parameters
// ---------------------------------------------------------------------------

/** Convert a JSON Schema properties object + required array back to a flat parameter list.
 *  Gracefully handles nested types (object, array) by mapping them to 'string'. */
export function schemaToParameters(schema: {
  properties?: Record<string, { type?: string; enum?: string[]; description?: string; items?: object }>;
  required?: string[];
}): SkillParameter[] {
  const props = schema.properties ?? {};
  const req = new Set(schema.required ?? []);
  const params: SkillParameter[] = [];

  for (const [name, def] of Object.entries(props)) {
    if (def.enum && Array.isArray(def.enum)) {
      params.push({
        name,
        type: 'enum',
        required: req.has(name),
        description: def.description ?? '',
        enumValues: def.enum.map(String),
      });
    } else {
      const rawType = def.type ?? 'string';
      // Map complex types to string
      const type = (['string', 'number', 'integer', 'boolean'].includes(rawType)
        ? rawType
        : 'string') as SkillParameter['type'];
      params.push({
        name,
        type,
        required: req.has(name),
        description: def.description ?? '',
      });
    }
  }

  return params;
}

// ---------------------------------------------------------------------------
// Build complete Anthropic tool definition
// ---------------------------------------------------------------------------

/** Build a complete Anthropic tool definition from slug, description, and flat parameters. */
export function buildToolDefinition(
  slug: string,
  description: string,
  params: SkillParameter[]
): { name: string; description: string; input_schema: { type: 'object'; properties: Record<string, object>; required: string[] } } {
  const { properties, required } = parametersToSchema(params);
  return {
    name: slug,
    description,
    input_schema: { type: 'object', properties, required },
  };
}

/** Minimal shape check for an Anthropic tool-definition object. Used by
 *  systemSkillService.createSystemSkill / updateSystemSkill and by the
 *  skill-analyzer merge PATCH endpoint (Phase 5) so every write path to
 *  `system_skills.definition` agrees on what counts as "a valid tool definition".
 *
 *  The predicate is deliberately shallow — it confirms the required top-level
 *  keys and their coarse types, not every nested constraint. Deeper validation
 *  happens downstream (the LLM SDK, the agent execution path). */
export function isValidToolDefinitionShape(
  def: unknown
): def is { name: string; description: string; input_schema: { type: 'object'; properties: Record<string, unknown>; required?: unknown[] } } {
  if (def === null || typeof def !== 'object') return false;
  const d = def as Record<string, unknown>;
  if (typeof d.name !== 'string' || d.name.length === 0) return false;
  if (typeof d.description !== 'string') return false;
  if (d.input_schema === null || typeof d.input_schema !== 'object') return false;
  const schema = d.input_schema as Record<string, unknown>;
  if (schema.type !== 'object') return false;
  if (schema.properties === null || typeof schema.properties !== 'object') return false;
  if (schema.required !== undefined && !Array.isArray(schema.required)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Parse parameter lines from markdown ## Parameters section
// ---------------------------------------------------------------------------

/** Parse a single parameter line.
 *  Format: `- name: type (required)? — description`
 *  Enum:   `- name: enum[val1, val2, val3] (required)? — description` */
export function parseParameterLine(line: string): SkillParameter | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('- ')) return null;

  // Remove leading "- "
  const rest = trimmed.slice(2);

  // Split on first colon to get name
  const colonIdx = rest.indexOf(':');
  if (colonIdx === -1) return null;

  const name = rest.slice(0, colonIdx).trim();
  if (!name) return null;

  let after = rest.slice(colonIdx + 1).trim();

  // Parse type (may include enum[...])
  let type: SkillParameter['type'] = 'string';
  let enumValues: string[] | undefined;

  const enumMatch = after.match(/^enum\[([^\]]*)\]/);
  if (enumMatch) {
    type = 'enum';
    enumValues = enumMatch[1].split(',').map((v) => v.trim()).filter(Boolean);
    after = after.slice(enumMatch[0].length).trim();
  } else {
    const typeMatch = after.match(/^(string|number|integer|boolean)\b/);
    if (typeMatch) {
      type = typeMatch[1] as SkillParameter['type'];
      after = after.slice(typeMatch[0].length).trim();
    }
  }

  // Parse (required) flag
  const required = /^\(required\)/i.test(after);
  if (required) {
    after = after.replace(/^\(required\)\s*/i, '');
  }

  // Parse description after em-dash or hyphen separator
  let description = '';
  const dashMatch = after.match(/^[—–-]\s*/);
  if (dashMatch) {
    description = after.slice(dashMatch[0].length).trim();
  } else {
    description = after.trim();
  }

  return { name, type, required, description, ...(enumValues ? { enumValues } : {}) };
}

/** Parse a full ## Parameters section body into a parameter list. */
export function parseParameterSection(text: string): SkillParameter[] {
  const lines = text.split('\n');
  const params: SkillParameter[] = [];
  for (const line of lines) {
    const param = parseParameterLine(line);
    if (param) params.push(param);
  }
  return params;
}

// ---------------------------------------------------------------------------
// Format parameters back to markdown line format
// ---------------------------------------------------------------------------

/** Format a parameter list back to markdown lines for .md file authoring. */
export function formatParameterLines(params: SkillParameter[]): string {
  return params
    .map((p) => {
      const typeStr = p.type === 'enum' && p.enumValues
        ? `enum[${p.enumValues.join(', ')}]`
        : p.type;
      const reqStr = p.required ? ' (required)' : '';
      const descStr = p.description ? ` — ${p.description}` : '';
      return `- ${p.name}: ${typeStr}${reqStr}${descStr}`;
    })
    .join('\n');
}
