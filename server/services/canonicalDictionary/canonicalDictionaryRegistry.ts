export interface CanonicalTableEntry {
  tableName: string;
  humanName: string;
  purpose: string;
  principalSemantics: string;
  visibilityFields: { ownerUserId?: boolean; visibilityScope?: boolean; sharedTeamIds?: boolean };
  columns: Array<{ name: string; type: string; purpose: string }>;
  foreignKeys: Array<{ column: string; referencesTable: string; referencesColumn: string }>;
  freshnessPeriod: string;
  cardinality: '1:1' | '1:N' | 'N:N';
  skillReferences: string[];
  exampleQueries: string[];
  commonJoins: string[];
  antiPatterns: string[];
}

export const CANONICAL_DICTIONARY_REGISTRY: CanonicalTableEntry[] = [
  {
    tableName: 'canonical_accounts',
    humanName: 'Accounts',
    purpose: 'Root entity — represents a client, company, or workspace tracked by the agency.',
    principalSemantics: 'Org-scoped, subaccount-filterable. Visibility defaults to shared_subaccount.',
    visibilityFields: { ownerUserId: true, visibilityScope: true, sharedTeamIds: true },
    columns: [
      { name: 'id', type: 'uuid', purpose: 'Primary key' },
      { name: 'organisation_id', type: 'uuid', purpose: 'Owning organisation' },
      { name: 'connector_config_id', type: 'uuid', purpose: 'Source connector that synced this account' },
      { name: 'subaccount_id', type: 'uuid', purpose: 'Optional subaccount scope' },
      { name: 'external_id', type: 'text', purpose: 'Provider-side unique ID' },
      { name: 'display_name', type: 'text', purpose: 'Human-readable account name' },
      { name: 'status', type: 'text', purpose: 'active | inactive | suspended' },
      { name: 'external_metadata', type: 'jsonb', purpose: 'Provider-specific fields not in canonical schema' },
      { name: 'last_sync_at', type: 'timestamptz', purpose: 'When this row was last refreshed from provider' },
    ],
    foreignKeys: [
      { column: 'organisation_id', referencesTable: 'organisations', referencesColumn: 'id' },
      { column: 'connector_config_id', referencesTable: 'connector_configs', referencesColumn: 'id' },
    ],
    freshnessPeriod: '15 minutes (default poll interval)',
    cardinality: '1:1',
    skillReferences: ['read_crm'],
    exampleQueries: [
      'SELECT * FROM canonical_accounts WHERE organisation_id = $orgId AND status = \'active\'',
      'SELECT display_name, last_sync_at FROM canonical_accounts WHERE subaccount_id = $subId ORDER BY last_sync_at DESC',
    ],
    commonJoins: [
      'canonical_contacts via canonical_contacts.account_id',
      'canonical_opportunities via canonical_opportunities.account_id',
      'canonical_revenue via canonical_revenue.account_id',
    ],
    antiPatterns: [],
  },
  {
    tableName: 'canonical_contacts',
    humanName: 'Contacts',
    purpose: 'People associated with accounts — clients, leads, team members.',
    principalSemantics: 'Org-scoped via account. Visibility inherited from parent account by default.',
    visibilityFields: { ownerUserId: true, visibilityScope: true, sharedTeamIds: true },
    columns: [
      { name: 'id', type: 'uuid', purpose: 'Primary key' },
      { name: 'organisation_id', type: 'uuid', purpose: 'Owning organisation' },
      { name: 'account_id', type: 'uuid', purpose: 'Parent account' },
      { name: 'external_id', type: 'text', purpose: 'Provider-side unique ID' },
      { name: 'first_name', type: 'text', purpose: 'First name' },
      { name: 'last_name', type: 'text', purpose: 'Last name' },
      { name: 'email', type: 'text', purpose: 'Email address' },
      { name: 'phone', type: 'text', purpose: 'Phone number' },
      { name: 'tags', type: 'jsonb', purpose: 'Array of tag strings' },
      { name: 'source', type: 'text', purpose: 'Where the contact was imported from' },
    ],
    foreignKeys: [
      { column: 'account_id', referencesTable: 'canonical_accounts', referencesColumn: 'id' },
    ],
    freshnessPeriod: '15 minutes (synced with parent account)',
    cardinality: '1:N',
    skillReferences: ['read_contacts'],
    exampleQueries: [
      'SELECT * FROM canonical_contacts WHERE account_id = $accountId',
      'SELECT email, first_name FROM canonical_contacts WHERE organisation_id = $orgId AND email LIKE \'%@example.com\'',
    ],
    commonJoins: [
      'canonical_accounts via account_id',
    ],
    antiPatterns: [],
  },
  {
    tableName: 'canonical_opportunities',
    humanName: 'Opportunities',
    purpose: 'Sales pipeline items — deals, proposals, projects tied to accounts.',
    principalSemantics: 'Org-scoped via account.',
    visibilityFields: { ownerUserId: true, visibilityScope: true, sharedTeamIds: true },
    columns: [
      { name: 'id', type: 'uuid', purpose: 'Primary key' },
      { name: 'organisation_id', type: 'uuid', purpose: 'Owning organisation' },
      { name: 'account_id', type: 'uuid', purpose: 'Parent account' },
      { name: 'external_id', type: 'text', purpose: 'Provider-side unique ID' },
      { name: 'name', type: 'text', purpose: 'Opportunity name' },
      { name: 'stage', type: 'text', purpose: 'Current pipeline stage' },
      { name: 'value', type: 'numeric', purpose: 'Monetary value' },
      { name: 'currency', type: 'text', purpose: 'Currency code (USD, AUD, etc.)' },
      { name: 'status', type: 'text', purpose: 'open | won | lost | abandoned' },
    ],
    foreignKeys: [
      { column: 'account_id', referencesTable: 'canonical_accounts', referencesColumn: 'id' },
    ],
    freshnessPeriod: '15 minutes',
    cardinality: '1:N',
    skillReferences: ['read_opportunities'],
    exampleQueries: [
      'SELECT name, value, stage FROM canonical_opportunities WHERE account_id = $accountId AND status = \'open\'',
    ],
    commonJoins: ['canonical_accounts via account_id'],
    antiPatterns: [],
  },
  {
    tableName: 'canonical_conversations',
    humanName: 'Conversations',
    purpose: 'Communication threads — email, chat, SMS, phone interactions.',
    principalSemantics: 'Org-scoped via account.',
    visibilityFields: { ownerUserId: true, visibilityScope: true, sharedTeamIds: true },
    columns: [
      { name: 'id', type: 'uuid', purpose: 'Primary key' },
      { name: 'organisation_id', type: 'uuid', purpose: 'Owning organisation' },
      { name: 'account_id', type: 'uuid', purpose: 'Parent account' },
      { name: 'external_id', type: 'text', purpose: 'Provider-side unique ID' },
      { name: 'channel', type: 'text', purpose: 'sms | email | chat | phone | other' },
      { name: 'status', type: 'text', purpose: 'active | inactive | closed' },
      { name: 'message_count', type: 'integer', purpose: 'Total messages in thread' },
      { name: 'last_message_at', type: 'timestamptz', purpose: 'Timestamp of last message' },
    ],
    foreignKeys: [
      { column: 'account_id', referencesTable: 'canonical_accounts', referencesColumn: 'id' },
    ],
    freshnessPeriod: '15 minutes',
    cardinality: '1:N',
    skillReferences: [],
    exampleQueries: [
      'SELECT channel, message_count FROM canonical_conversations WHERE account_id = $accountId ORDER BY last_message_at DESC',
    ],
    commonJoins: ['canonical_accounts via account_id'],
    antiPatterns: [],
  },
  {
    tableName: 'canonical_revenue',
    humanName: 'Revenue',
    purpose: 'Financial transactions — payments, invoices, refunds tied to accounts.',
    principalSemantics: 'Org-scoped via account.',
    visibilityFields: { ownerUserId: true, visibilityScope: true, sharedTeamIds: true },
    columns: [
      { name: 'id', type: 'uuid', purpose: 'Primary key' },
      { name: 'organisation_id', type: 'uuid', purpose: 'Owning organisation' },
      { name: 'account_id', type: 'uuid', purpose: 'Parent account' },
      { name: 'external_id', type: 'text', purpose: 'Provider-side unique ID' },
      { name: 'amount', type: 'numeric', purpose: 'Transaction amount' },
      { name: 'currency', type: 'text', purpose: 'Currency code' },
      { name: 'type', type: 'text', purpose: 'one_time | recurring | refund' },
      { name: 'status', type: 'text', purpose: 'pending | completed | failed | refunded' },
      { name: 'transaction_date', type: 'timestamptz', purpose: 'When the transaction occurred' },
    ],
    foreignKeys: [
      { column: 'account_id', referencesTable: 'canonical_accounts', referencesColumn: 'id' },
    ],
    freshnessPeriod: '15 minutes',
    cardinality: '1:N',
    skillReferences: [],
    exampleQueries: [
      'SELECT SUM(amount) FROM canonical_revenue WHERE account_id = $accountId AND status = \'completed\'',
    ],
    commonJoins: ['canonical_accounts via account_id'],
    antiPatterns: [],
  },
  {
    tableName: 'canonical_metrics',
    humanName: 'Metrics (Current Snapshot)',
    purpose: 'Latest computed metric values per account — health scores, engagement rates.',
    principalSemantics: 'Org-scoped via account.',
    visibilityFields: { ownerUserId: true, visibilityScope: true, sharedTeamIds: true },
    columns: [
      { name: 'id', type: 'uuid', purpose: 'Primary key' },
      { name: 'organisation_id', type: 'uuid', purpose: 'Owning organisation' },
      { name: 'account_id', type: 'uuid', purpose: 'Parent account' },
      { name: 'metric_slug', type: 'text', purpose: 'Metric identifier (e.g. response_rate_7d)' },
      { name: 'current_value', type: 'numeric', purpose: 'Latest computed value' },
      { name: 'previous_value', type: 'numeric', purpose: 'Previous period value for trend' },
      { name: 'period_type', type: 'text', purpose: 'rolling_7d | rolling_30d | monthly | etc.' },
    ],
    foreignKeys: [
      { column: 'account_id', referencesTable: 'canonical_accounts', referencesColumn: 'id' },
    ],
    freshnessPeriod: 'Computed on schedule — varies by metric',
    cardinality: '1:N',
    skillReferences: [],
    exampleQueries: [
      'SELECT metric_slug, current_value FROM canonical_metrics WHERE account_id = $accountId',
    ],
    commonJoins: ['canonical_accounts via account_id'],
    antiPatterns: ['Do not use for historical trend analysis — use canonical_metric_history instead'],
  },
  {
    tableName: 'canonical_metric_history',
    humanName: 'Metric History',
    purpose: 'Append-only record of metric values over time — used for baseline computation and trend analysis.',
    principalSemantics: 'Org-scoped via account.',
    visibilityFields: { ownerUserId: true, visibilityScope: true, sharedTeamIds: true },
    columns: [
      { name: 'id', type: 'uuid', purpose: 'Primary key' },
      { name: 'organisation_id', type: 'uuid', purpose: 'Owning organisation' },
      { name: 'account_id', type: 'uuid', purpose: 'Parent account' },
      { name: 'metric_slug', type: 'text', purpose: 'Metric identifier' },
      { name: 'period_type', type: 'text', purpose: 'rolling_7d | rolling_30d | monthly | etc.' },
      { name: 'aggregation_type', type: 'text', purpose: 'Aggregation method (sum, avg, count, etc.)' },
      { name: 'value', type: 'numeric', purpose: 'Metric value for this period' },
      { name: 'period_start', type: 'timestamptz', purpose: 'Start of measurement period' },
      { name: 'period_end', type: 'timestamptz', purpose: 'End of measurement period' },
      { name: 'computed_at', type: 'timestamptz', purpose: 'When the value was computed' },
      { name: 'metric_version', type: 'integer', purpose: 'Schema version of the metric definition' },
      { name: 'is_backfill', type: 'boolean', purpose: 'Whether this entry was backfilled' },
      { name: 'created_at', type: 'timestamptz', purpose: 'Row creation timestamp' },
    ],
    foreignKeys: [
      { column: 'account_id', referencesTable: 'canonical_accounts', referencesColumn: 'id' },
    ],
    freshnessPeriod: 'Append-only — new rows added on each metric computation',
    cardinality: '1:N',
    skillReferences: [],
    exampleQueries: [
      'SELECT metric_slug, value, computed_at FROM canonical_metric_history WHERE account_id = $accountId ORDER BY computed_at DESC LIMIT 30',
    ],
    commonJoins: ['canonical_accounts via account_id', 'canonical_metrics via account_id + metric_slug'],
    antiPatterns: ['Do not use for current-state queries — use canonical_metrics instead'],
  },
];
