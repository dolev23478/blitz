import type { ReportMediaType } from '../contracts/schema.js';

/** URLs of photos that were uploaded to our storage (flagged `stored`); empty when uploads are off or failed. */
export function storedMediaUrls(
  media: ReadonlyArray<{ type: string; url?: string; stored?: boolean }>,
): string[] {
  return media.filter((m) => m.stored && m.type === 'photo' && m.url).map((m) => m.url as string);
}

/** Animation is video. Non-visual attachments remain in collector data, not in RAW_REPORT.media_type. */
export function reportMediaTypes(
  media: ReadonlyArray<{ type: string }>,
): ReportMediaType[] {
  const result = new Set<ReportMediaType>(['text']);
  for (const { type } of media) {
    switch (type) {
      case 'text':
      case 'photo':
      case 'video':
        result.add(type);
        break;
      case 'gif':
      case 'animated_gif':
        result.add('video');
        break;
      case 'document':
      case 'audio':
      case 'other':
        break;
      default:
        throw new Error('Unrecognized collector media type.');
    }
  }
  return [...result];
}
