import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import type { Readable } from 'stream';

// ---------------------------------------------------------------------------
// Storage abstraction — allows swapping local filesystem for S3/R2 later
// ---------------------------------------------------------------------------

export interface StorageService {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  getStream(key: string): Readable;
  delete(key: string): Promise<void>;
}

const BASE_DIR = path.resolve(process.cwd(), 'data', 'attachments');

export class LocalStorageService implements StorageService {
  private resolvePath(key: string): string {
    // Prevent path traversal
    const resolved = path.resolve(BASE_DIR, key);
    if (!resolved.startsWith(BASE_DIR)) {
      throw { statusCode: 400, message: 'Invalid storage key' };
    }
    return resolved;
  }

  async put(key: string, data: Buffer, _contentType: string): Promise<void> {
    const filePath = this.resolvePath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
  }

  async get(key: string): Promise<Buffer> {
    const filePath = this.resolvePath(key);
    return fs.readFile(filePath);
  }

  getStream(key: string): Readable {
    const filePath = this.resolvePath(key);
    return createReadStream(filePath);
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolvePath(key);
    await fs.unlink(filePath).catch(() => {
      // File may already be removed — ignore
    });
  }
}

export const storageService: StorageService = new LocalStorageService();
