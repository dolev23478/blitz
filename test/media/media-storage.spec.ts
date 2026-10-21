import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config/app-config.js';
import { MediaStorageService } from '../../src/media/media-storage.service.js';
import { createMediaStore, type MediaStore, S3MediaStore } from '../../src/media/media-store.js';
import { storedMediaUrls } from '../../src/transformer/media-types.js';

const config = (env: Record<string, string> = {}) =>
  loadConfig({ S3_BUCKET: 'b', S3_PUBLIC_BASE_URL: 'https://cdn.example.com/', ...env });
const store = (put = vi.fn().mockResolvedValue(undefined)): MediaStore & { put: ReturnType<typeof vi.fn> } => ({ put });
const bytes = new Uint8Array([1, 2, 3]);

afterEach(() => vi.unstubAllGlobals());

describe('MediaStorageService', () => {
  it('is disabled without a store and returns null', async () => {
    const svc = new MediaStorageService(loadConfig({}), null);
    expect(svc.enabled).toBe(false);
    expect(await svc.uploadPhoto({ source: 'x', owner: 'a', id: 1, bytes })).toBeNull();
  });

  it('uploads bytes and returns a stable public URL under the key prefix', async () => {
    const s = store();
    const svc = new MediaStorageService(config(), s);
    const a = await svc.uploadPhoto({ source: 'telegram', owner: 'chan nel', id: 7, bytes, mimeType: 'image/png' });
    const b = await svc.uploadPhoto({ source: 'telegram', owner: 'chan nel', id: 7, bytes, mimeType: 'image/png' });
    expect(a).toMatch(/^https:\/\/cdn\.example\.com\/media\/telegram\/chan_nel\/7\/[0-9a-f]{16}\.png$/);
    expect(b).toBe(a);
    expect(s.put).toHaveBeenCalledWith(expect.stringContaining('media/telegram/chan_nel/7/'), bytes, 'image/png');
  });

  it('downloads remote URLs, and skips non-images and oversized files', async () => {
    const s = store();
    const svc = new MediaStorageService(config({ MEDIA_MAX_MB: '1' }), s);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(bytes, { headers: { 'content-type': 'image/jpeg' } })));
    expect(await svc.uploadPhoto({ source: 'x', owner: 'a', id: 1, url: 'https://pbs.twimg.com/a.jpg' })).toMatch(/\.jpg$/);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(bytes, { headers: { 'content-type': 'text/html' } })));
    expect(await svc.uploadPhoto({ source: 'x', owner: 'a', id: 2, url: 'https://x/a' })).toBeNull();

    const big = new Uint8Array(2 * 1024 * 1024);
    expect(await svc.uploadPhoto({ source: 'telegram', owner: 'a', id: 3, bytes: big })).toBeNull();
    expect(svc.withinLimit(2 * 1024 * 1024)).toBe(false);
  });

  it('retries once and then returns null instead of throwing', async () => {
    const s = store(vi.fn().mockRejectedValue(new Error('denied')));
    const svc = new MediaStorageService(config(), s);
    expect(await svc.uploadPhoto({ source: 'x', owner: 'a', id: 1, bytes })).toBeNull();
    expect(s.put).toHaveBeenCalledTimes(2);
  });

  it('defaults public base URL to direct S3 bucket URL when S3_PUBLIC_BASE_URL is omitted', async () => {
    const s = store();
    const preprodConfig = loadConfig({ S3_BUCKET: 'data-forge-pre', S3_REGION: 'il-central-1' });
    const svc = new MediaStorageService(preprodConfig, s);
    expect(svc.enabled).toBe(true);
    const url = await svc.uploadPhoto({ source: 'x', owner: 'user1', id: '100', bytes, mimeType: 'image/jpeg' });
    expect(url).toMatch(/^https:\/\/data-forge-pre\.s3\.il-central-1\.amazonaws\.com\/media\/x\/user1\/100\/[0-9a-f]{16}\.jpg$/);
  });
});

describe('Config and MediaStore for IRSA pre-prod', () => {
  it('loadConfig respects AWS_REGION and defaults S3_REGION to il-central-1', () => {
    const c1 = loadConfig({});
    expect(c1.S3_REGION).toBe('il-central-1');

    const c2 = loadConfig({ AWS_REGION: 'il-central-1' });
    expect(c2.S3_REGION).toBe('il-central-1');

    const c3 = loadConfig({ S3_REGION: 'eu-west-1' });
    expect(c3.S3_REGION).toBe('eu-west-1');
  });

  it('createMediaStore creates store when S3_BUCKET is provided without S3_PUBLIC_BASE_URL', () => {
    const disabled = createMediaStore(loadConfig({}));
    expect(disabled).toBeNull();

    const enabled = createMediaStore(loadConfig({ S3_BUCKET: 'data-forge-pre' }));
    expect(enabled).toBeInstanceOf(S3MediaStore);
  });
});

describe('storedMediaUrls', () => {
  it('returns only uploaded photos', () => {
    expect(
      storedMediaUrls([
        { type: 'photo', url: 'https://cdn/a.jpg', stored: true },
        { type: 'photo', url: 'https://pbs.twimg.com/b.jpg' },
        { type: 'video', url: 'https://cdn/c.mp4', stored: true },
      ]),
    ).toEqual(['https://cdn/a.jpg']);
  });
});
