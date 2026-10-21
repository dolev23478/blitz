import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { MEDIA_STORE, type MediaStore } from './media-store.js';

export interface PhotoSource {
  /** Collector name, e.g. "x" or "telegram". */
  source: string;
  /** Account or channel the post belongs to. */
  owner: string;
  /** Post / message id. */
  id: string | number;
  /** Either a remote URL to download from, or the bytes already in memory. */
  url?: string;
  bytes?: Uint8Array;
  mimeType?: string | null;
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const FETCH_TIMEOUT_MS = 20_000;
const ATTEMPTS = 2;

const safe = (v: string | number): string => String(v).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || '_';

/**
 * Uploads photos to an S3-compatible store and returns their public URL. Never throws: a failed or skipped
 * upload returns null so the report is still published (without the media URL).
 */
@Injectable()
export class MediaStorageService {
  private readonly logger = new Logger(MediaStorageService.name);
  private readonly base: string | null;
  private readonly maxBytes: number;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(MEDIA_STORE) private readonly store: MediaStore | null,
  ) {
    const rawBase =
      config.S3_PUBLIC_BASE_URL ??
      (config.S3_BUCKET ? `https://${config.S3_BUCKET}.s3.${config.S3_REGION}.amazonaws.com` : null);
    this.base = rawBase?.replace(/\/+$/, '') ?? null;
    this.maxBytes = config.MEDIA_MAX_MB * 1024 * 1024;
    if (!this.enabled) this.logger.log('media upload disabled (S3_BUCKET not set); original media URLs are kept');
  }

  get enabled(): boolean {
    return this.store !== null && this.base !== null;
  }

  /** True unless the declared size is known and above the upload limit (checked before downloading). */
  withinLimit(sizeBytes: number | null | undefined): boolean {
    return !sizeBytes || sizeBytes <= this.maxBytes;
  }

  /** True when the URL points into our bucket/CDN. */
  isStoredUrl(url: string): boolean {
    return this.base !== null && url.startsWith(`${this.base}/`);
  }

  async uploadPhoto(photo: PhotoSource): Promise<string | null> {
    if (!this.enabled || !this.store || !this.base) return null;
    const label = `${photo.source}/${photo.owner}/${photo.id}`;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        const loaded = photo.bytes ? { bytes: photo.bytes, mimeType: photo.mimeType ?? 'image/jpeg' } : await this.download(photo.url);
        if (!loaded) return null;
        const mime = (loaded.mimeType ?? 'image/jpeg').split(';')[0].trim().toLowerCase();
        if (!mime.startsWith('image/')) {
          this.logger.warn(`skipping ${label}: not an image (${mime})`);
          return null;
        }
        if (loaded.bytes.byteLength === 0 || loaded.bytes.byteLength > this.maxBytes) {
          this.logger.warn(`skipping ${label}: ${loaded.bytes.byteLength} bytes is outside the 1..${this.maxBytes} limit`);
          return null;
        }
        const hash = createHash('sha256').update(loaded.bytes).digest('hex').slice(0, 16);
        const key = `${this.config.S3_KEY_PREFIX}/${safe(photo.source)}/${safe(photo.owner)}/${safe(photo.id)}/${hash}.${EXTENSIONS[mime] ?? 'img'}`;
        await this.store.put(key, loaded.bytes, mime);
        return `${this.base}/${key}`;
      } catch (err) {
        if (attempt === ATTEMPTS) this.logger.warn(`media upload failed for ${label}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return null;
  }

  private async download(url: string | undefined): Promise<{ bytes: Uint8Array; mimeType: string | null } | null> {
    if (!url) return null;
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`download HTTP ${res.status}`);
    const length = Number(res.headers.get('content-length'));
    if (length > this.maxBytes) {
      this.logger.warn(`skipping ${url}: content-length ${length} exceeds ${this.maxBytes}`);
      return null;
    }
    return { bytes: new Uint8Array(await res.arrayBuffer()), mimeType: res.headers.get('content-type') };
  }
}
