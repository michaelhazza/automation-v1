import { AsyncLocalStorage } from 'node:async_hooks';
import type { SystemPrincipal, PrincipalContext } from './types.js';
import { resolveSystemOpsContext } from '../systemOperationsOrgResolver.js';

const SYSTEM_PRINCIPAL_USER_ID = '00000000-0000-0000-0000-000000000001';

let inflightPromise: Promise<SystemPrincipal> | null = null;

/** Returns the immutable singleton system principal. Resolves SYSTEM_OPERATIONS_ORG_ID lazily. */
export function getSystemPrincipal(): Promise<SystemPrincipal> {
  if (inflightPromise) return inflightPromise;
  inflightPromise = (async () => {
    const { organisationId } = await resolveSystemOpsContext();
    return {
      type: 'system',
      id: SYSTEM_PRINCIPAL_USER_ID,
      organisationId,
      subaccountId: null,
      teamIds: [],
      isSystemPrincipal: true,
    } satisfies SystemPrincipal;
  })();
  inflightPromise.catch(() => { inflightPromise = null; });
  return inflightPromise;
}

const als = new AsyncLocalStorage<{ principal: PrincipalContext }>();

/** Wraps a function so principal context is available via getCurrentPrincipal(). */
export async function withSystemPrincipal<T>(fn: (ctx: { principal: SystemPrincipal }) => Promise<T>): Promise<T> {
  const principal = await getSystemPrincipal();
  return als.run({ principal }, () => fn({ principal }));
}

/** Reads the current principal from ALS. Returns null if outside any scope. */
export function getCurrentPrincipal(): PrincipalContext | null {
  return als.getStore()?.principal ?? null;
}

/** Test-only: reset the cache. Production no-op. */
export function __resetForTest(): void {
  if (process.env.NODE_ENV !== 'test') return;
  inflightPromise = null;
}
