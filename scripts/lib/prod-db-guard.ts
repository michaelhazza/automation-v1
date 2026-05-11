const HARDCODED_DENY_FRAGMENTS = ['supabase', 'neon', 'render', 'rds.amazonaws', 'pooler.'];

export function assertDevTargetOrThrow(
  databaseUrl: string | undefined,
  nodeEnv: string | undefined,
): void {
  // PTH-CGT-R8-F1 (operator-approved tightening of spec §6.3):
  // Primary guard — allowlist on NODE_ENV. Only "development" passes. Any
  // other value (production, staging, test, integration, undefined) throws.
  // Previously this was a blocklist (only "production" threw), which left
  // staging / test / integration / undefined as silently-permissive.
  // Allowlist matches the spec's "fail closed" intent and protects against
  // CI runners or misconfigured environments that happen to have a real
  // DB URL not matching the secondary host denylist.
  if (nodeEnv !== 'development') {
    throw new Error(
      `REFUSING TO RUN: NODE_ENV="${nodeEnv ?? 'undefined'}", expected "development". This destructive script never runs outside explicit development mode. Set NODE_ENV=development on a local dev DB.`,
    );
  }

  // PTH-CGT-R8-F1: explicit fail when DATABASE_URL is unset.
  // Previously the secondary guard's denylist scan against an empty string
  // would silently pass — but an unset DATABASE_URL means the script falls
  // back to whatever the DB driver's default is (often localhost:5432),
  // which can be a real shared dev DB. Fail closed.
  if (!databaseUrl) {
    throw new Error(
      'REFUSING TO RUN: DATABASE_URL is not set. This destructive script requires an explicit local/dev DATABASE_URL pointing at a database you are willing to drop.',
    );
  }

  // Secondary guard — defence-in-depth host fragment denylist
  const envDeny = (process.env.PROD_DB_HOST_DENYLIST ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const fragments = [...HARDCODED_DENY_FRAGMENTS, ...envDeny];
  for (const fragment of fragments) {
    if (databaseUrl.includes(fragment)) {
      throw new Error(
        `REFUSING TO RUN: DATABASE_URL contains denylisted host fragment "${fragment}". This script destroys data; point at an explicit local or self-hosted dev DB.`,
      );
    }
  }
}
