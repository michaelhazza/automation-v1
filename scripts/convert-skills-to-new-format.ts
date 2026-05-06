/**
 * Convert system skill .md files from old format (JSON code block) to new format (## Parameters).
 *
 * Usage:
 *   npx tsx scripts/convert-skills-to-new-format.ts
 *
 * - Reads every .md file in server/skills/
 * - Parses the JSON code block to extract input_schema
 * - Converts properties to ## Parameters lines
 * - Merges ## Instructions + ## Methodology into a single ## Instructions section
 * - Writes the file back in place
 * - Runs a verification pass to confirm parameter counts match
 */

import { readdir, readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseParameterSection } from '../shared/skillParameters.js';

const __filename = fileURLToPath(import.meta.url);
const SKILLS_DIR = join(dirname(__filename), '..', 'server', 'skills');

// ---------------------------------------------------------------------------
// Types for the JSON schema we parse out of old-format files
// ---------------------------------------------------------------------------

interface JsonSchemaProperty {
  type?: string;
  description?: string;
  enum?: string[];
  items?: JsonSchemaProperty & {
    properties?: Record<string, JsonSchemaProperty>;
    required?: string[];
  };
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

interface InputSchema {
  type: string;
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
}

interface ToolDefinition {
  name: string;
  description: string;
  input_schema: InputSchema;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract a markdown section by heading using indexOf (not regex).
 * Returns content between `## Heading\n` and the next `\n## ` or end of string.
 */
function extractSection(body: string, heading: string): string | null {
  const marker = `## ${heading}\n`;
  const start = body.indexOf(marker);
  if (start === -1) return null;
  const contentStart = start + marker.length;
  const nextHeading = body.indexOf('\n## ', contentStart);
  const content =
    nextHeading === -1
      ? body.slice(contentStart)
      : body.slice(contentStart, nextHeading);
  const trimmed = content.trim();
  return trimmed || null;
}

/**
 * Build an enriched description for complex types (array, object).
 * For simple arrays (items.type = string/number), just note the type.
 * For arrays of objects, enumerate the nested keys.
 * For plain objects, note it should be a JSON object.
 */
function buildComplexTypeDescription(
  _name: string,
  prop: JsonSchemaProperty,
): string {
  const origDesc = prop.description ?? '';
  const rawType = prop.type ?? 'string';

  if (rawType === 'array') {
    const items = prop.items;
    if (!items) {
      return origDesc ? `JSON array. ${origDesc}` : 'JSON array.';
    }

    // Array of primitives
    if (
      items.type &&
      ['string', 'number', 'integer', 'boolean'].includes(items.type)
    ) {
      return origDesc
        ? `JSON array of ${items.type} values. ${origDesc}`
        : `JSON array of ${items.type} values.`;
    }

    // Array of objects with nested properties
    if (items.type === 'object' && items.properties) {
      const nested = Object.entries(items.properties);
      const keyDescriptions = nested.map(([key, def]) => {
        const keyType = def.type ?? 'string';
        return `"${key}" (${keyType})`;
      });
      const keysStr = keyDescriptions.join(', ');
      const prefix = `JSON array of objects, each with keys: ${keysStr}.`;
      return origDesc ? `${prefix} ${origDesc}` : prefix;
    }

    // Array of objects without specified properties
    if (items.type === 'object') {
      return origDesc
        ? `JSON array of objects. ${origDesc}`
        : 'JSON array of objects.';
    }

    return origDesc ? `JSON array. ${origDesc}` : 'JSON array.';
  }

  if (rawType === 'object') {
    if (prop.properties) {
      const nested = Object.entries(prop.properties);
      const keyDescriptions = nested.map(([key, def]) => {
        const keyType = def.type ?? 'string';
        return `"${key}" (${keyType})`;
      });
      const keysStr = keyDescriptions.join(', ');
      const prefix = `JSON object with keys: ${keysStr}.`;
      return origDesc ? `${prefix} ${origDesc}` : prefix;
    }
    return origDesc ? `JSON object. ${origDesc}` : 'JSON object.';
  }

  return origDesc;
}

/**
 * Convert input_schema.properties into parameter lines.
 * Generates the same format that parseParameterLine / formatParameterLines
 * understand, with enriched descriptions for complex (array/object) types.
 */
function convertPropertiesToParameterLines(schema: InputSchema): string {
  const props = schema.properties;
  const requiredSet = new Set(schema.required ?? []);
  const lines: string[] = [];

  for (const [name, prop] of Object.entries(props)) {
    const rawType = prop.type ?? 'string';
    const isRequired = requiredSet.has(name);

    let typeStr: string;
    let description: string;

    if (prop.enum && Array.isArray(prop.enum)) {
      typeStr = `enum[${prop.enum.join(', ')}]`;
      description = prop.description ?? '';
    } else if (['array', 'object'].includes(rawType)) {
      typeStr = 'string';
      description = buildComplexTypeDescription(name, prop);
    } else {
      typeStr = rawType;
      description = prop.description ?? '';
    }

    const reqStr = isRequired ? ' (required)' : '';
    const descStr = description ? ` — ${description}` : '';
    lines.push(`- ${name}: ${typeStr}${reqStr}${descStr}`);
  }

  return lines.join('\n');
}

/**
 * Merge the text body (everything after the JSON code block) by folding
 * ## Methodology content into ## Instructions.
 *
 * Strategy:
 *   1. Find all ## headings and their positions.
 *   2. Extract Instructions content and Methodology content.
 *   3. Concatenate them under a single ## Instructions heading.
 *   4. Preserve all other ## sections in their original order, omitting
 *      the ## Methodology heading itself.
 */
function mergeInstructionsAndMethodology(textBody: string): string {
  // Parse all ## heading positions
  interface Section {
    heading: string;
    start: number; // start of "## Heading\n"
    contentStart: number; // start of content after heading line
  }
  const sections: Section[] = [];
  let searchFrom = 0;

  // Find the first heading (may be at position 0)
  while (searchFrom < textBody.length) {
    let headingPos: number;
    if (searchFrom === 0 && textBody.startsWith('## ')) {
      headingPos = 0;
    } else {
      const idx = textBody.indexOf('\n## ', searchFrom);
      if (idx === -1) break;
      headingPos = idx + 1; // skip the \n to point at "## "
    }

    const lineEnd = textBody.indexOf('\n', headingPos);
    if (lineEnd === -1) {
      // Heading at end of file with no content
      sections.push({
        heading: textBody.slice(headingPos + 3).trim(),
        start: headingPos,
        contentStart: textBody.length,
      });
      break;
    }

    sections.push({
      heading: textBody.slice(headingPos + 3, lineEnd).trim(),
      start: headingPos,
      contentStart: lineEnd + 1,
    });
    searchFrom = lineEnd + 1;
  }

  // Find Instructions and Methodology indices
  const instrIdx = sections.findIndex((s) => s.heading === 'Instructions');
  const methIdx = sections.findIndex((s) => s.heading === 'Methodology');

  if (instrIdx === -1 && methIdx === -1) {
    // No Instructions or Methodology — return as-is
    return textBody;
  }

  if (instrIdx === -1 && methIdx !== -1) {
    // Only Methodology — rename to Instructions
    return textBody.replace('## Methodology\n', '## Instructions\n');
  }

  if (methIdx === -1) {
    // Only Instructions — return as-is
    return textBody;
  }

  // Both exist — merge them.
  // Get content for each section (up to the next section start or EOF).
  function getSectionContent(idx: number): string {
    const s = sections[idx];
    const nextSection = sections[idx + 1];
    const end = nextSection ? nextSection.start : textBody.length;
    return textBody.slice(s.contentStart, end).trim();
  }

  const instrContent = getSectionContent(instrIdx);
  const methContent = getSectionContent(methIdx);

  // Build the new body by iterating sections in order.
  // - Replace Instructions section with merged content (instr + meth).
  // - Skip Methodology section entirely.
  // - Keep everything else.
  const parts: string[] = [];

  // Anything before the first section
  if (sections.length > 0 && sections[0].start > 0) {
    const before = textBody.slice(0, sections[0].start).trim();
    if (before) parts.push(before);
  }

  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];

    if (s.heading === 'Methodology') {
      // Skip — its content is merged into Instructions
      continue;
    }

    if (s.heading === 'Instructions') {
      parts.push(`## Instructions\n\n${instrContent}`);
      if (methContent) {
        parts.push(methContent);
      }
      continue;
    }

    // Any other section — preserve as-is
    const content = getSectionContent(i);
    parts.push(`## ${s.heading}\n\n${content}`);
  }

  return parts.join('\n\n');
}

/**
 * Convert a single skill file from old format to new format.
 * Returns { converted, paramCount } or throws.
 */
function convertSkillContent(raw: string): {
  converted: string;
  paramCount: number;
} {
  // Normalize line endings
  const normalised = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Split frontmatter from body
  const fmMatch = normalised.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) {
    throw new Error('No valid frontmatter found');
  }

  const frontmatterRaw = fmMatch[1];
  const body = fmMatch[2];

  // Extract JSON code block
  const jsonMatch = body.match(/```json\n([\s\S]*?)\n```/);
  if (!jsonMatch) {
    throw new Error('No JSON code block found (may already be converted)');
  }

  let toolDef: ToolDefinition;
  try {
    toolDef = JSON.parse(jsonMatch[1]);
  } catch (e) {
    throw new Error(`Invalid JSON in code block: ${e}`, { cause: e });
  }

  const schema = toolDef.input_schema;
  const paramCount = Object.keys(schema.properties).length;

  // Build the ## Parameters section
  const parameterLines = convertPropertiesToParameterLines(schema);
  const parametersSection = `## Parameters\n\n${parameterLines}`;

  // Get everything after the JSON code block (the closing ``` line)
  const jsonBlockStart = body.indexOf('```json');
  const jsonBlockEnd = body.indexOf('```', jsonBlockStart + 7);
  const afterJsonBlock = body.slice(jsonBlockEnd + 3);

  // Strip leading blank lines, keep the rest
  let textBody = afterJsonBlock.replace(/^\n+/, '');

  // Merge Instructions + Methodology
  if (textBody.trim()) {
    textBody = mergeInstructionsAndMethodology(textBody);
  }

  // Clean up excessive newlines
  textBody = textBody.replace(/\n{3,}/g, '\n\n').trim();

  // Assemble the final file
  const result = textBody
    ? `---\n${frontmatterRaw}\n---\n\n${parametersSection}\n\n${textBody}\n`
    : `---\n${frontmatterRaw}\n---\n\n${parametersSection}\n`;

  return { converted: result, paramCount };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const files = (await readdir(SKILLS_DIR))
    .filter((f) => f.endsWith('.md'))
    .sort();

  console.log(`Found ${files.length} skill files in ${SKILLS_DIR}\n`);

  let convertedCount = 0;
  let skipped = 0;
  const failures: string[] = [];

  // Map of file -> expected param count (populated during conversion pass)
  const expectedParamCounts = new Map<string, number>();

  // -----------------------------------------------------------------------
  // Pass 1: Convert all files
  // -----------------------------------------------------------------------
  console.log('=== CONVERSION PASS ===\n');

  for (const file of files) {
    const filePath = join(SKILLS_DIR, file);
    const raw = await readFile(filePath, 'utf-8');

    try {
      const { converted, paramCount } = convertSkillContent(raw);
      await writeFile(filePath, converted, 'utf-8');
      console.log(`  [ok] ${file} — ${paramCount} params`);
      convertedCount++;
      expectedParamCounts.set(file, paramCount);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('already be converted')) {
        console.log(`  [skip] ${file} — no JSON code block`);
        skipped++;
      } else {
        console.error(`  [FAIL] ${file} — ${msg}`);
        failures.push(`${file}: ${msg}`);
      }
    }
  }

  console.log(`\n=== CONVERSION SUMMARY ===`);
  console.log(`  Converted: ${convertedCount}`);
  console.log(`  Skipped:   ${skipped}`);
  console.log(`  Failed:    ${failures.length}`);
  if (failures.length > 0) {
    console.log(`\n  Failures:`);
    for (const f of failures) console.log(`    - ${f}`);
  }

  // -----------------------------------------------------------------------
  // Pass 2: Verification — re-read each converted file and validate
  // -----------------------------------------------------------------------
  console.log(`\n=== VERIFICATION PASS ===\n`);

  let verifyOk = 0;
  let verifyFail = 0;
  const verifyFailures: string[] = [];

  for (const file of files) {
    const expectedCount = expectedParamCounts.get(file);
    if (expectedCount === undefined) {
      // File was skipped or failed — nothing to verify
      continue;
    }

    const filePath = join(SKILLS_DIR, file);
    const raw = await readFile(filePath, 'utf-8');
    const normalised = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    const fmMatch = normalised.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!fmMatch) {
      console.error(`  [FAIL] ${file} — cannot parse frontmatter`);
      verifyFail++;
      verifyFailures.push(`${file}: cannot parse frontmatter`);
      continue;
    }

    const body = fmMatch[2];
    const issues: string[] = [];

    // 1. Check ## Parameters section exists and has correct count
    const paramSection = extractSection(body, 'Parameters');
    if (!paramSection) {
      issues.push('no ## Parameters section');
    } else {
      const params = parseParameterSection(paramSection);
      if (params.length !== expectedCount) {
        issues.push(
          `param count mismatch: expected ${expectedCount}, got ${params.length}`,
        );
      }
      // Check each param is well-formed
      for (const p of params) {
        if (!p.name) issues.push('parameter missing name');
        if (!p.type) issues.push(`parameter "${p.name}" missing type`);
      }
    }

    // 2. No tool-definition JSON code block should remain.
    //    Example/output JSON blocks in Instructions are fine — only flag blocks
    //    that look like a tool definition (contain "input_schema").
    const jsonBlocks = body.match(/```json\n[\s\S]*?\n```/g) ?? [];
    for (const block of jsonBlocks) {
      if (block.includes('"input_schema"')) {
        issues.push('tool-definition JSON code block still present');
        break;
      }
    }

    // 3. No ## Methodology heading should remain
    if (
      body.includes('\n## Methodology\n') ||
      body.startsWith('## Methodology\n')
    ) {
      issues.push('## Methodology heading still present');
    }

    if (issues.length === 0) {
      console.log(`  [ok] ${file} — ${expectedCount} params verified`);
      verifyOk++;
    } else {
      console.error(`  [FAIL] ${file} — ${issues.join('; ')}`);
      verifyFail++;
      verifyFailures.push(`${file}: ${issues.join('; ')}`);
    }
  }

  console.log(`\n=== VERIFICATION SUMMARY ===`);
  console.log(`  Passed: ${verifyOk}`);
  console.log(`  Failed: ${verifyFail}`);
  if (verifyFailures.length > 0) {
    console.log(`\n  Verification failures:`);
    for (const f of verifyFailures) console.log(`    - ${f}`);
  }

  // Final summary
  console.log(`\n=== DONE ===`);
  const totalIssues = failures.length + verifyFail;
  if (totalIssues === 0) {
    console.log(
      `All ${convertedCount} files converted and verified successfully.`,
    );
  } else {
    console.log(`${totalIssues} issue(s) found. Review the output above.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
