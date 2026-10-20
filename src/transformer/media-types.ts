import type { ReportMediaType } from '../contracts/schema.js';

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
