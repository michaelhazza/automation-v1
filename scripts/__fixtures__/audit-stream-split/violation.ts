// Fixture: this pattern SHOULD trigger the audit-stream split gate.
// auth.* events must go through securityAuditService, not auditService.log.
auditService.log({ action: 'auth.login.failure', meta: {} });
