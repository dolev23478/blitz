import { z } from 'zod';

const boolean = z.enum(['true', 'false']).transform((v) => v === 'true');

export const messageQuerySchema = z.object({
  /** Comma-separated usernames, e.g. channel=durov,telegram */
  channel: z.string().optional(),
  q: z.string().trim().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  hasMedia: boolean.optional(),
  sinceId: z.coerce.number().int().nonnegative().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

export const messageIdSchema = z.coerce.number().int().positive();

export type MessageQueryDto = z.output<typeof messageQuerySchema>;
