import type { PrincipalContext } from './types.js';

export class UnauthorizedSystemAccessError extends Error {
  readonly statusCode = 403;
  readonly code = 'unauthorized_system_access' as const;
  readonly errorCode = 'unauthorized_system_access' as const;
  constructor(message = 'System administrator access required') {
    super(message);
    this.name = 'UnauthorizedSystemAccessError';
  }
}

interface AssertOpts {
  actorRole?: string;
}

export function assertSystemAdminContext(
  ctx: { principal: PrincipalContext } | { principal: null | undefined },
  opts: AssertOpts = {},
): asserts ctx is { principal: PrincipalContext } {
  if (ctx.principal?.type === 'system') return;
  if (opts.actorRole === 'system_admin' && ctx.principal != null) return;
  throw new UnauthorizedSystemAccessError();
}
