/**
 * Shared cloud storage helpers used by fileService and webhookService.
 * Centralises S3/R2 client construction and bucket name resolution
 * to avoid duplication across services.
 */

import { S3Client } from '@aws-sdk/client-s3';
import { env } from './env.js';

export function getS3Client(): S3Client {
  if (env.FILE_STORAGE_BACKEND === 'r2') {
    return new S3Client({
      region: 'auto',
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID ?? '',
        secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? '',
      },
    });
  }
  return new S3Client({
    region: env.S3_REGION ?? 'ap-southeast-2',
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
    },
  });
}

export function getBucketName(): string {
  return env.FILE_STORAGE_BACKEND === 'r2'
    ? (env.R2_BUCKET_NAME ?? '')
    : (env.S3_BUCKET_NAME ?? '');
}
