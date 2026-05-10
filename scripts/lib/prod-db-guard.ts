const HARDCODED_DENY_FRAGMENTS = ['supabase', 'neon', 'render', 'rds.amazonaws', 'pooler.'];

export function assertDevTargetOrThrow(
  databaseUrl: string | undefined,
  nodeEnv: string | undefined,
): void {
  // Primary guard — fails closed unconditionally
  if (nodeEnv === 'production') {
    throw new Error(
      'REFUSING TO RUN: NODE_ENV=production. This destructive script never runs in production. Set NODE_ENV=development on a dev DB.',
    );
  }

  // Secondary guard — defence-in-depth
  const dbUrl = databaseUrl ?? '';
  const envDeny = (process.env.PROD_DB_HOST_DENYLIST ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const fragments = [...HARDCODED_DENY_FRAGMENTS, ...envDeny];
  for (const fragment of fragments) {
    if (dbUrl.includes(fragment)) {
      throw new Error(
        `REFUSING TO RUN: DATABASE_URL contains denylisted host fragment "${fragment}". This script destroys data; point at an explicit local or self-hosted dev DB.`,
      );
    }
  }
}
