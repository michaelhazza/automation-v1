/**
 * rlsPredicateSqlBuilderPure — generates CREATE POLICY SQL from a table's
 * scoping shape descriptor.
 *
 * Pure functions only (no DB access, no side effects). Used by tooling and
 * tests to verify that RLS policies match the expected shape for a given
 * table's scoping descriptor.
 */

export type ScopingShape = 'one_to_one' | 'multi_scoped' | 'org_only';

export interface TableScopingDescriptor {
  tableName: string;
  shape: ScopingShape;
  hasSubaccountId: boolean;
}

/**
 * Build a principal-scoped SELECT policy for the given table descriptor.
 *
 * - `org_only`: simple org-id gate.
 * - `one_to_one` / `multi_scoped`: full principal-type dispatch with
 *   visibility_scope checks, team overlap, and delegated-principal fallback.
 *   When `hasSubaccountId` is true, service-principal and user-shared_subaccount
 *   clauses include a subaccount_id filter.
 */
export function buildReadPolicy(desc: TableScopingDescriptor): string {
  const { tableName, shape, hasSubaccountId } = desc;
  const policyName = `${tableName}_principal_read`;

  if (shape === 'org_only') {
    return [
      `CREATE POLICY ${policyName} ON ${tableName}`,
      `  FOR SELECT USING (`,
      `    organisation_id = current_setting('app.organisation_id', true)::uuid`,
      `  );`,
    ].join('\n');
  }

  const subaccountFilter = hasSubaccountId
    ? `\n        AND (subaccount_id IS NULL\n             OR subaccount_id = current_setting('app.current_subaccount_id', true)::uuid)`
    : '';

  const serviceBlock = [
    `      (current_setting('app.current_principal_type', true) = 'service'`,
    `        AND visibility_scope IN ('shared_subaccount', 'shared_org')${subaccountFilter})`,
  ].join('\n');

  const userSharedSubaccount = hasSubaccountId
    ? `        OR (visibility_scope = 'shared_subaccount'\n          AND (subaccount_id IS NULL\n               OR subaccount_id = current_setting('app.current_subaccount_id', true)::uuid))`
    : `        OR visibility_scope = 'shared_subaccount'`;

  const userBlock = [
    `      (current_setting('app.current_principal_type', true) = 'user' AND (`,
    `        (visibility_scope = 'private'`,
    `          AND owner_user_id::text = current_setting('app.current_principal_id', true))`,
    `        OR (visibility_scope = 'shared_team'`,
    `          AND shared_team_ids && (CASE`,
    `            WHEN current_setting('app.current_team_ids', true) = '' THEN '{}'::uuid[]`,
    `            ELSE string_to_array(current_setting('app.current_team_ids', true), ',')::uuid[]`,
    `          END))`,
    userSharedSubaccount,
    `        OR visibility_scope = 'shared_org'`,
    `      ))`,
  ].join('\n');

  const delegatedBlock = [
    `      (current_setting('app.current_principal_type', true) = 'delegated'`,
    `        AND visibility_scope = 'private'`,
    `        AND owner_user_id::text = current_setting('app.current_principal_id', true))`,
  ].join('\n');

  return [
    `CREATE POLICY ${policyName} ON ${tableName}`,
    `  FOR SELECT USING (`,
    `    organisation_id = current_setting('app.organisation_id', true)::uuid`,
    `    AND (`,
    serviceBlock,
    `      OR`,
    userBlock,
    `      OR`,
    delegatedBlock,
    `    )`,
    `  );`,
  ].join('\n');
}

/**
 * Build a writer-bypass policy that grants the `canonical_writer` role
 * unrestricted access within the org boundary.
 */
export function buildWriterBypassPolicy(tableName: string): string {
  return [
    `CREATE POLICY ${tableName}_writer_bypass ON ${tableName}`,
    `  FOR ALL`,
    `  TO canonical_writer`,
    `  USING (`,
    `    organisation_id = current_setting('app.organisation_id', true)::uuid`,
    `  )`,
    `  WITH CHECK (`,
    `    organisation_id = current_setting('app.organisation_id', true)::uuid`,
    `  );`,
  ].join('\n');
}
