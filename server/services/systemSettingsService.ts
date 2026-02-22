import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { systemSettings } from '../db/schema/index.js';

// Defaults used when a key has no row in the DB.
// max_upload_size_mb: 200MB covers audio, PDFs, documents, and short video clips
// without risking memory exhaustion on the server.
export const SETTING_DEFAULTS: Record<string, string> = {
  max_upload_size_mb: '200',
};

export const SETTING_KEYS = {
  MAX_UPLOAD_SIZE_MB: 'max_upload_size_mb',
} as const;

export class SystemSettingsService {
  async getAll(): Promise<Record<string, string>> {
    const rows = await db.select().from(systemSettings);
    const result = { ...SETTING_DEFAULTS };
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  async get(key: string): Promise<string> {
    const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, key));
    return row?.value ?? SETTING_DEFAULTS[key] ?? '';
  }

  async getMaxUploadSizeBytes(): Promise<number> {
    const mb = parseInt(await this.get(SETTING_KEYS.MAX_UPLOAD_SIZE_MB), 10);
    return (isNaN(mb) ? 200 : mb) * 1024 * 1024;
  }

  async set(key: string, value: string): Promise<void> {
    await db
      .insert(systemSettings)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value, updatedAt: new Date() },
      });
  }
}

export const systemSettingsService = new SystemSettingsService();
