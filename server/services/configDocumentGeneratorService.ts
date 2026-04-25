/**
 * configDocumentGeneratorService — render Configuration Documents (§9.3)
 *
 * Aggregates `ConfigQuestion[]` schemas into a deliverable document in DOCX
 * (always), Google Doc (when connected), or Markdown (on request).
 *
 * The bundle manifest (`onboarding_bundle_configs`) supplies the ordered list
 * of playbook slugs for an org. Each slug resolves to its `ConfigQuestion[]`
 * array via a small registry.
 *
 * Phase 3 scope: ships DOCX (via `docx` npm package) and Markdown. Google Doc
 * generation is a compatibility stub until the Google Workspace integration
 * adds a `createDocFromHtml` method. See §9.3 "Output formats".
 *
 * Spec: docs/memory-and-briefings-spec.md §9.3 (S21)
 */

import type { ConfigQuestion } from '../types/configSchema.js';
import { INTELLIGENCE_BRIEFING_SCHEMA } from '../workflows/intelligence-briefing.schema.js';
import { WEEKLY_DIGEST_SCHEMA } from '../workflows/weekly-digest.schema.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { organisations } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Schema registry — playbook slug → ConfigQuestion[]
// ---------------------------------------------------------------------------

const SCHEMA_REGISTRY: Readonly<Record<string, ConfigQuestion[]>> = Object.freeze({
  'intelligence-briefing': INTELLIGENCE_BRIEFING_SCHEMA,
  'weekly-digest': WEEKLY_DIGEST_SCHEMA,
});

export async function getOrgName(orgId: string): Promise<string> {
  const db = getOrgScopedDb('configDocumentGeneratorService.getOrgName');
  const [org] = await db.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, orgId)).limit(1);
  return org?.name ?? 'Agency';
}

export function resolveBundleSchemas(bundleSlugs: readonly string[]): ConfigQuestion[] {
  const out: ConfigQuestion[] = [];
  for (const slug of bundleSlugs) {
    const schema = SCHEMA_REGISTRY[slug];
    if (!schema) continue;
    for (const q of schema) out.push(q);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GenerateInput {
  agencyName: string;
  subaccountName: string;
  bundleSlugs: readonly string[];
  format: 'docx' | 'markdown';
  /** Magic upload URL surfaced in the footer. */
  uploadUrl: string;
}

export interface GenerateResult {
  format: 'docx' | 'markdown';
  /** Base64-encoded DOCX bytes, or the raw markdown string. */
  contents: string;
  filename: string;
}

export async function generateConfigurationDocument(input: GenerateInput): Promise<GenerateResult> {
  const schemas = resolveBundleSchemas(input.bundleSlugs);

  if (input.format === 'markdown') {
    const md = renderMarkdown(input, schemas);
    return {
      format: 'markdown',
      contents: md,
      filename: `${slugify(input.subaccountName)}-configuration.md`,
    };
  }

  // DOCX path — uses the `docx` npm package. Imported dynamically so test
  // runs don't need the package installed.
  const docx = await import('docx').catch(() => null as unknown as typeof import('docx') | null);
  if (!docx) {
    throw {
      statusCode: 500,
      message: 'docx package not available; cannot generate DOCX',
      errorCode: 'DOCX_UNAVAILABLE',
    };
  }
  const { Document, Packer, Paragraph, HeadingLevel, TextRun } = docx;

  const children: InstanceType<typeof Paragraph>[] = [];

  // Header
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun(`Configuration Brief — ${input.subaccountName}`)],
    }),
  );
  children.push(
    new Paragraph({
      children: [new TextRun({ text: `Prepared by ${input.agencyName} · ${new Date().toLocaleDateString()}`, italics: true })],
    }),
  );
  children.push(
    new Paragraph({
      children: [
        new TextRun(
          'Fill in the sections below. Leave blank if unknown — the system will follow up with any missing items.',
        ),
      ],
    }),
  );

  // Sections by heading
  let currentSection = '';
  for (const q of schemas) {
    if (q.section !== currentSection) {
      currentSection = q.section;
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun(q.section)],
        }),
      );
    }

    children.push(
      new Paragraph({
        children: [new TextRun({ text: q.question, bold: true })],
      }),
    );
    if (q.helpText) {
      children.push(new Paragraph({ children: [new TextRun({ text: q.helpText, italics: true })] }));
    }
    if (q.options) {
      children.push(new Paragraph({ children: [new TextRun(`Options: ${q.options.join(', ')}`)] }));
    }
    if (q.default !== undefined) {
      children.push(new Paragraph({ children: [new TextRun(`Default: ${Array.isArray(q.default) ? q.default.join(', ') : String(q.default)}`)] }));
    }
    children.push(new Paragraph({ children: [new TextRun({ text: 'Answer: ___________________', color: '888888' })] }));
  }

  // Footer
  children.push(
    new Paragraph({
      children: [new TextRun({ text: `Upload completed document at ${input.uploadUrl}`, italics: true })],
    }),
  );

  const doc = new Document({ sections: [{ properties: {}, children }] });
  const buffer = await Packer.toBuffer(doc);
  const base64 = Buffer.from(buffer).toString('base64');

  return {
    format: 'docx',
    contents: base64,
    filename: `${slugify(input.subaccountName)}-configuration.docx`,
  };
}

// ---------------------------------------------------------------------------
// Markdown rendering (for technical users / fallback)
// ---------------------------------------------------------------------------

function renderMarkdown(input: GenerateInput, schemas: ConfigQuestion[]): string {
  const lines: string[] = [];
  lines.push(`# Configuration Brief — ${input.subaccountName}`);
  lines.push('');
  lines.push(`*Prepared by ${input.agencyName} · ${new Date().toLocaleDateString()}*`);
  lines.push('');
  lines.push('Fill in the sections below. Leave blank if unknown — the system will follow up with any missing items.');
  lines.push('');

  let currentSection = '';
  for (const q of schemas) {
    if (q.section !== currentSection) {
      currentSection = q.section;
      lines.push(`## ${q.section}`);
      lines.push('');
    }
    lines.push(`**${q.question}**`);
    if (q.helpText) lines.push(`*${q.helpText}*`);
    if (q.options) lines.push(`Options: ${q.options.join(', ')}`);
    if (q.default !== undefined) {
      lines.push(`Default: ${Array.isArray(q.default) ? q.default.join(', ') : String(q.default)}`);
    }
    lines.push('');
    lines.push('Answer:');
    lines.push('```');
    lines.push('');
    lines.push('```');
    lines.push('');
  }

  lines.push(`---`);
  lines.push(`Upload completed document at ${input.uploadUrl}`);
  return lines.join('\n');
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
