import type { CanonicalTableEntry } from './canonicalDictionaryRegistry.js';

export interface SchemaColumn {
  name: string;
  type: string;
}

export interface SchemaTable {
  tableName: string;
  columns: SchemaColumn[];
}

export interface DriftFinding {
  type: 'missing_entry' | 'orphan_entry' | 'column_mismatch';
  tableName: string;
  detail: string;
}

export function validateDictionary(
  registry: CanonicalTableEntry[],
  schemaTables: SchemaTable[],
): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const registryTableNames = new Set(registry.map((r) => r.tableName));
  const schemaTableNames = new Set(schemaTables.map((s) => s.tableName));

  // Missing entries: schema has table but registry doesn't
  for (const st of schemaTables) {
    if (!registryTableNames.has(st.tableName)) {
      findings.push({
        type: 'missing_entry',
        tableName: st.tableName,
        detail: `Table ${st.tableName} exists in schema but not in dictionary registry`,
      });
    }
  }

  // Orphan entries: registry has table but schema doesn't
  for (const entry of registry) {
    if (!schemaTableNames.has(entry.tableName)) {
      findings.push({
        type: 'orphan_entry',
        tableName: entry.tableName,
        detail: `Table ${entry.tableName} in dictionary registry but not in schema`,
      });
    }
  }

  // Column mismatches
  for (const entry of registry) {
    const schemaTable = schemaTables.find((s) => s.tableName === entry.tableName);
    if (!schemaTable) continue;

    const schemaColNames = new Set(schemaTable.columns.map((c) => c.name));
    const registryColNames = new Set(entry.columns.map((c) => c.name));

    for (const col of entry.columns) {
      if (!schemaColNames.has(col.name)) {
        findings.push({
          type: 'column_mismatch',
          tableName: entry.tableName,
          detail: `Column ${col.name} in registry but not in schema`,
        });
      }
    }

    for (const col of schemaTable.columns) {
      if (!registryColNames.has(col.name)) {
        findings.push({
          type: 'column_mismatch',
          tableName: entry.tableName,
          detail: `Column ${col.name} in schema but not in registry`,
        });
      }
    }
  }

  return findings;
}
