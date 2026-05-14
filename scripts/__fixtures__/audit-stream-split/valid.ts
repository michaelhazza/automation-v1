// Fixture: this pattern is correct and SHOULD NOT trigger the gate.
// auth.* events routed through securityAuditService as required.
recordSecurityEvent({ eventType: 'auth.login.failure', organisationId: 'org1', meta: {} });
