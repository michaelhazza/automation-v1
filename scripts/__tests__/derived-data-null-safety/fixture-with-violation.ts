// Test fixture: deliberately uses non-null assertion on a derived field
// @ts-nocheck
declare function getBundleStats(orgId: string): { utilizationByModelFamily: Record<string, unknown> | null };
declare const orgId: string;

const bundleStats = getBundleStats(orgId);
// guard-ignore-next-line: derived-data-null-safety reason="test fixture — intentional violation for gate self-test"
const utilization = bundleStats.utilizationByModelFamily!; // @null-safety-exempt: test fixture
