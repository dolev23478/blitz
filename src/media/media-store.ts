import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { AppConfig } from '../config/app-config.js';

/** Minimal storage port so the upload logic does not depend on a concrete provider. */
export interface MediaStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
}

export const MEDIA_STORE = Symbol('MEDIA_STORE');

export class S3MediaStore implements MediaStore {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    config: Pick<
      AppConfig,
      'S3_REGION' | 'S3_ENDPOINT' | 'S3_ACCESS_KEY_ID' | 'S3_SECRET_ACCESS_KEY' | 'S3_FORCE_PATH_STYLE'
    >,
  ) {
    this.client = new S3Client({
      region: config.S3_REGION,
      endpoint: config.S3_ENDPOINT,
      // Newer SDKs add CRC32 checksums by default, which several S3-compatible stores reject.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      // A dead or blackholed endpoint must fail fast instead of stalling a collector cycle.
      requestHandler: { connectionTimeout: 10_000, requestTimeout: 30_000 },
      maxAttempts: 2,
      forcePathStyle: config.S3_FORCE_PATH_STYLE === 'true' || (config.S3_ENDPOINT !== undefined && config.S3_FORCE_PATH_STYLE !== 'false'),
      ...(config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY
        ? { credentials: { accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY } }
        : {}),
    });
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }
}

/** Returns null (uploads disabled) unless S3_BUCKET is configured. */
export function createMediaStore(config: AppConfig): MediaStore | null {
  if (!config.S3_BUCKET) return null;
  return new S3MediaStore(config.S3_BUCKET, config);
}
