import { z } from 'zod';
import { ISO_639_1_CODES } from '../common/languages.js';
import { radioStationSchema } from './radio.config.js';

export const captureResultSchema = z
  .object({
    startedAt: z.iso.datetime(),
    endedAt: z.iso.datetime(),
    durationSeconds: z.number().positive().max(300),
    text: z.string().max(100000),
    // Local ASR result only; this is not the RAW_REPORT wire contract.
    language: z.union([z.enum(ISO_639_1_CODES), z.literal('unknown')]),
    segments: z
      .array(
        z.object({
          start: z.number().nonnegative(),
          end: z.number().nonnegative(),
          text: z.string().max(100000),
        }),
      )
      .max(1000),
  })
  .superRefine((result, ctx) => {
    if (Date.parse(result.endedAt) < Date.parse(result.startedAt))
      ctx.addIssue({ code: 'custom', message: 'Capture end precedes start.' });
    if (result.text.trim() && result.language === 'unknown')
      ctx.addIssue({
        code: 'custom',
        message: 'Nonempty ASR text needs a valid language code.',
      });
    for (const segment of result.segments) {
      if (
        segment.end < segment.start ||
        segment.end > result.durationSeconds + 0.1
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Invalid audio segment bounds.',
        });
    }
  });

export type CaptureResult = z.infer<typeof captureResultSchema>;
export const radioTranscriptSchema = captureResultSchema.safeExtend({
  clipId: z.uuidv4(),
  station: radioStationSchema,
  status: z.enum(['transcribed', 'no_speech']),
});
export type RadioTranscript = z.infer<typeof radioTranscriptSchema>;
export interface RadioCycleResult {
  skipped: boolean;
  archiveFull: boolean;
  clips: RadioTranscript[];
  failedStations: string[];
}
