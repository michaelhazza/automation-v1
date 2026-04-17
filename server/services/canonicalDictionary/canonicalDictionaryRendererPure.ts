import type { CanonicalTableEntry } from './canonicalDictionaryRegistry.js';

export interface RenderOptions {
  tableFilter?: string[];
  includeExamples?: boolean;
  includeAntiPatterns?: boolean;
}

export function renderDictionary(
  registry: CanonicalTableEntry[],
  options: RenderOptions = {},
): string {
  const tables = options.tableFilter
    ? registry.filter((t) => options.tableFilter!.includes(t.tableName))
    : registry;

  if (tables.length === 0) {
    return 'No canonical tables match the filter.';
  }

  const sections = tables.map((t) => {
    const lines: string[] = [
      `## ${t.humanName} (${t.tableName})`,
      '',
      t.purpose,
      '',
      `**Cardinality:** ${t.cardinality} relative to canonical_accounts`,
      `**Freshness:** ${t.freshnessPeriod}`,
      '',
      '### Columns',
      '',
      '| Column | Type | Purpose |',
      '|--------|------|---------|',
      ...t.columns.map((c) => `| ${c.name} | ${c.type} | ${c.purpose} |`),
    ];

    if (t.foreignKeys.length > 0) {
      lines.push('', '### Joins', '');
      for (const fk of t.foreignKeys) {
        lines.push(`- \`${fk.column}\` → \`${fk.referencesTable}.${fk.referencesColumn}\``);
      }
    }

    if (t.commonJoins.length > 0) {
      lines.push('', '### Common Join Paths', '');
      for (const j of t.commonJoins) {
        lines.push(`- ${j}`);
      }
    }

    if (options.includeExamples && t.exampleQueries.length > 0) {
      lines.push('', '### Example Queries', '');
      for (const q of t.exampleQueries) {
        lines.push(`\`\`\`sql`, q, `\`\`\``);
      }
    }

    if (options.includeAntiPatterns && t.antiPatterns.length > 0) {
      lines.push('', '### Anti-Patterns', '');
      for (const a of t.antiPatterns) {
        lines.push(`- ⚠️ ${a}`);
      }
    }

    return lines.join('\n');
  });

  return sections.join('\n\n---\n\n');
}
