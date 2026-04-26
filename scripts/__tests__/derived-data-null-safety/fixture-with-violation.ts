// H1 gate self-test fixture: deliberate non-null assertion on a derived field.
// Reachable ONLY via the dedicated runner (`run-fixture-self-test.sh`), which
// sets DERIVED_DATA_NULL_SAFETY_SCAN_DIR to this directory. The standard CI
// invocation of verify-derived-data-null-safety.sh scans server/ and skips
// __tests__, so this file is invisible there. Both `@null-safety-exempt` and
// `guard-ignore-next-line` annotations are intentionally absent — the gate
// MUST fire on the line below for the self-test to pass.
// @ts-nocheck
declare function getBundleStats(orgId: string): { utilizationByModelFamily: Record<string, unknown> | null };
declare const orgId: string;

const bundleStats = getBundleStats(orgId);
const utilization = bundleStats.utilizationByModelFamily!;
