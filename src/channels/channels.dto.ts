import { z } from 'zod';

export const addChannelSchema = z.object({ username: z.string().min(1) });
export const setActiveSchema = z.object({ active: z.boolean() });
export const backfillSchema = z.object({ days: z.number().positive().max(3650).optional() });

export type AddChannelDto = z.output<typeof addChannelSchema>;
export type SetActiveDto = z.output<typeof setActiveSchema>;
export type BackfillDto = z.output<typeof backfillSchema>;
