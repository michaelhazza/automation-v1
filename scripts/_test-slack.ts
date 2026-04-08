import { db } from '../server/db/index.js';
import { integrationConnections } from '../server/db/schema/index.js';
import { connectionTokenService } from '../server/services/connectionTokenService.js';
import { eq } from 'drizzle-orm';

const rows = await db.select().from(integrationConnections)
  .where(eq(integrationConnections.providerType, 'slack'));

for (const r of rows) {
  console.log('Row:', r.id, 'status:', r.connectionStatus, 'hasToken:', !!r.accessToken, 'config:', JSON.stringify(r.configJson));
  if (!r.accessToken) continue;
  const token = connectionTokenService.decryptToken(r.accessToken);
  console.log('Token prefix:', token.slice(0, 15));
  const resp = await fetch('https://slack.com/api/conversations.list?types=public_channel&limit=5', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await resp.json() as { ok: boolean; error?: string; channels?: { name: string }[] };
  console.log('Slack response — ok:', data.ok, 'error:', data.error, 'channels:', data.channels?.map(c => c.name));
}

process.exit(0);
