/**
 * auditSubaccountRootsPure.ts
 *
 * Pure helper for the audit-subaccount-roots script.
 * No DB imports — takes already-fetched rows and returns violation analysis.
 */

export interface SubaccountRootRow {
  subaccountId: string;
  orgId: string;
  count: number;
  agentSlugs: string[];
}

export interface AuditResult {
  violations: SubaccountRootRow[];
  summary: string;
}

/**
 * Analyse subaccount root rows and return any violations (count > 1)
 * alongside a human-readable summary string.
 */
export function auditSubaccountRoots(rows: SubaccountRootRow[]): AuditResult {
  const violations = rows.filter((r) => r.count > 1);

  let summary: string;
  if (violations.length === 0) {
    summary = `OK — all ${rows.length} subaccount(s) have at most one active root agent.`;
  } else {
    const lines = violations.map(
      (v) =>
        `  subaccount ${v.subaccountId} (org ${v.orgId}): ${v.count} roots [${v.agentSlugs.join(', ')}]`
    );
    summary = [
      `VIOLATION — ${violations.length} subaccount(s) have multiple active root agents:`,
      ...lines,
    ].join('\n');
  }

  return { violations, summary };
}
