import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { StoredMessage } from '../types.js';
import type { MessageQueryDto } from './messages.dto.js';
import { MessagesRepository } from './messages.repository.js';

export interface MessagePage {
  items: StoredMessage[];
  count: number;
  nextCursor: string | null;
  lastId: number | null;
  hasMore: boolean;
}

export function encodeCursor(m: { postedAt: Date; id: number }): string {
  return Buffer.from(`${new Date(m.postedAt).toISOString()}|${m.id}`).toString('base64url');
}

export function decodeCursor(cursor: string): { postedAt: Date; id: number } | null {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const postedAt = new Date(iso ?? '');
  const n = Number(id);
  return Number.isNaN(postedAt.getTime()) || !Number.isInteger(n) ? null : { postedAt, id: n };
}

@Injectable()
export class MessagesService {
  constructor(@Inject(MessagesRepository) private readonly repo: MessagesRepository) {}

  /**
   * - Default: newest first; page back with `nextCursor` -> `cursor`.
   * - With `sinceId`: oldest first, only rows with id > sinceId (incremental sync); use `lastId` next time.
   */
  async list(dto: MessageQueryDto): Promise<MessagePage> {
    const { cursor, channel, ...rest } = dto;
    if (cursor && rest.sinceId !== undefined) {
      throw new BadRequestException('`cursor` and `sinceId` cannot be combined');
    }
    const before = cursor ? decodeCursor(cursor) : undefined;
    if (before === null) throw new BadRequestException('Invalid cursor');
    const channels = channel
      ?.split(',')
      .map((c) => c.trim().replace(/^@/, '').toLowerCase())
      .filter(Boolean);

    const items = await this.repo.query({ ...rest, ...(channels?.length ? { channels } : {}), ...(before ? { before } : {}) });
    const incremental = rest.sinceId !== undefined;
    const last = items.at(-1);
    return {
      items,
      count: items.length,
      nextCursor: !incremental && items.length === rest.limit && last ? encodeCursor(last) : null,
      lastId: incremental ? (last?.id ?? rest.sinceId ?? null) : (items.reduce((m, i) => Math.max(m, i.id), 0) || null),
      hasMore: items.length === rest.limit,
    };
  }

  async get(id: number): Promise<StoredMessage> {
    const message = await this.repo.get(id);
    if (!message) throw new NotFoundException('Message not found');
    return message;
  }
}
