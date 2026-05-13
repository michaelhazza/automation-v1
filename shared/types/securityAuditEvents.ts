export type SecurityEventSeverity =
  | 'system_integrity'
  | 'security_boundary'
  | 'rate_limit'
  | 'configuration';

interface AuditEventSpec {
  readonly name: string;
  readonly severity?: SecurityEventSeverity;
}

export const auditEvent = {
  auth: {
    loginFailed:            { name: 'auth.login.failure' },
    loginSucceeded:         { name: 'auth.login.success' },
    logout:                 { name: 'auth.logout' },
    signup:                 { name: 'auth.signup' },
    permissionDenied:       { name: 'auth.permission_denied' },
    tokenRevoked:           { name: 'auth.token_revoked' },
    crossOrgAccess:         { name: 'auth.cross_org_access' },
    passwordResetRequested: { name: 'auth.password_reset_requested' },
    passwordResetCompleted: { name: 'auth.password_reset_completed' },
  },
  oauth: {
    stateIssued:   { name: 'oauth.state.issued' },
    stateConsumed: { name: 'oauth.state.consumed' },
    stateExpired:  { name: 'oauth.state.expired' },
    stateNotFound: { name: 'oauth.state.not_found' },
    enrolProgress: { name: 'oauth.enrol.progress' },
    enrolCompleted: { name: 'oauth.enrol.completed' },
    enrolFailed:   { name: 'oauth.enrol.failed' },
    enrolPartial:  { name: 'oauth.enrol.partial' },
    enrolCapped:   { name: 'oauth.enrol.capped' },
  },
  security: {
    crossTenantAttempt:      { name: 'security.cross_tenant_attempt',      severity: 'security_boundary' as const },
    missingPrincipalContext: { name: 'security.missing_principal_context', severity: 'system_integrity' as const },
    rateLimitTrip:           { name: 'security.rate_limit_trip',           severity: 'rate_limit' as const },
  },
  audit: {},   // reserved for future audit-control events; empty in Phase 3
  agent: {
    observationsRetentionPrune: { name: 'agent.observations.retention_prune' },
  },
  owner: {
    contentRevealed: { name: 'owner.content_revealed', severity: 'security_boundary' as const },
  },
} as const satisfies Record<string, Record<string, AuditEventSpec>>;

// Derive SecurityAuditEventName as a union of all .name literal values across all namespaces.
type AuditEventFactory = typeof auditEvent;
type NamespaceValues<NS extends Record<string, AuditEventSpec>> = NS[keyof NS];
type ExtractName<T> = T extends { name: infer N } ? N : never;
type EventNamesInNamespace<NS extends Record<string, AuditEventSpec>> = ExtractName<NamespaceValues<NS>>;

export type SecurityAuditEventName =
  | EventNamesInNamespace<AuditEventFactory['auth']>
  | EventNamesInNamespace<AuditEventFactory['oauth']>
  | EventNamesInNamespace<AuditEventFactory['security']>
  | EventNamesInNamespace<AuditEventFactory['audit']>
  | EventNamesInNamespace<AuditEventFactory['agent']>
  | EventNamesInNamespace<AuditEventFactory['owner']>;
