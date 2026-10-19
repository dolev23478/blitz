import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import type { ParsedMessage, StoredMessage } from '../types.js';

export interface MessageQuery {
  /** One or more channel usernames (lowercase). */
  channels?: string[];
  q?: string;
  from?: Date;
  to?: Date;
  hasMedia?: boolean;
  /** Incremental sync: only rows with internal id greater than this, returned oldest-first. */
  sinceId?: number;
  /** Keyset cursor for paging back (posted_at, id) of the last row of the previous page. */
  before?: { postedAt: Date; id: number };
  limit: number;
}

export interface MessageStats {
  totalMessages: number;
  perChannel: { channel: string; messages: number; oldest: Date | null; newest: Date | null }[];
}

const SELECT_MESSAGE = `
  SELECT m.id, m.channel_id AS "channelId", c.username AS channel, m.message_id AS "messageId",
         m.posted_at AS "postedAt", m.text, m.views, m.media, m.links,
         m.forwarded_from AS "forwardedFrom", m.edited, m.url, m.fetched_at AS "fetchedAt",
         m.sender_id AS "senderId", m.sender_name AS "senderName", m.forwards, m.reactions, c.title AS "channelTitle"
  FROM messages m JOIN channels c ON c.id = m.channel_id`;

@Injectable()
export class MessagesRepository {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  /** Inserts or updates messages; returns number of newly inserted rows. */
  async upsertMany(channelId: number, messages: ParsedMessage[]): Promise<number> {
    if (messages.length === 0) return 0;
    let inserted = 0;
    for (const m of messages) {
      const res = await this.db.query<{ inserted: boolean }>(
        `INSERT INTO messages (channel_id, message_id, posted_at, text, views, media, links, forwarded_from, edited, url,
                               sender_id, forwards, reactions, sender_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (channel_id, message_id) DO UPDATE SET
           text = EXCLUDED.text, views = EXCLUDED.views, media = EXCLUDED.media,
           links = EXCLUDED.links, edited = EXCLUDED.edited, fetched_at = now(),
           forwards = coalesce(EXCLUDED.forwards, messages.forwards),
           sender_id = coalesce(EXCLUDED.sender_id, messages.sender_id),
           sender_name = coalesce(EXCLUDED.sender_name, messages.sender_name),
           reactions = CASE WHEN EXCLUDED.reactions = '[]'::jsonb THEN messages.reactions ELSE EXCLUDED.reactions END
         RETURNING (xmax = 0) AS inserted`,
        [
          channelId,
          m.messageId,
          m.postedAt,
          m.text,
          m.views,
          JSON.stringify(m.media),
          JSON.stringify(m.links),
          m.forwardedFrom,
          m.edited,
          m.url,
          m.senderId ?? null,
          m.forwards ?? null,
          JSON.stringify(m.reactions ?? []),
          m.senderName ?? null,
        ],
      );
      if (res.rows[0]?.inserted) inserted++;
    }
    return inserted;
  }

  /** Refreshes views/text/edited of already-stored messages; never inserts. */
  async refreshMany(channelId: number, messages: ParsedMessage[]): Promise<void> {
    if (messages.length === 0) return;
    await this.db.query(
      `UPDATE messages m SET text = u.text, views = u.views, media = u.media, links = u.links,
         edited = u.edited, fetched_at = now()
       FROM jsonb_to_recordset($2::jsonb)
         AS u(message_id int, text text, views int, media jsonb, links jsonb, edited boolean)
       WHERE m.channel_id = $1 AND m.message_id = u.message_id`,
      [
        channelId,
        JSON.stringify(
          messages.map((m) => ({
            message_id: m.messageId, text: m.text, views: m.views, media: m.media, links: m.links, edited: m.edited,
          })),
        ),
      ],
    );
  }

  async query(opts: MessageQuery): Promise<StoredMessage[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };

    if (opts.channels?.length) add('c.username = ANY(?)', opts.channels);
    if (opts.q) add(`m.text ILIKE '%' || ? || '%'`, opts.q);
    if (opts.from) add('m.posted_at >= ?', opts.from);
    if (opts.to) add('m.posted_at <= ?', opts.to);
    if (opts.hasMedia !== undefined) where.push(`(jsonb_array_length(m.media) > 0) = ${opts.hasMedia}`);
    if (opts.sinceId !== undefined) add('m.id > ?', opts.sinceId);
    if (opts.before) {
      params.push(opts.before.postedAt, opts.before.id);
      where.push(`(m.posted_at, m.id) < ($${params.length - 1}, $${params.length})`);
    }
    params.push(opts.limit);

    const order = opts.sinceId !== undefined ? 'm.id ASC' : 'm.posted_at DESC, m.id DESC';
    const sql = `${SELECT_MESSAGE}
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY ${order}
      LIMIT $${params.length}`;
    return (await this.db.query<StoredMessage>(sql, params)).rows;
  }

  async get(id: number): Promise<StoredMessage | null> {
    return (await this.db.query<StoredMessage>(`${SELECT_MESSAGE} WHERE m.id = $1`, [id])).rows[0] ?? null;
  }

  async stats(): Promise<MessageStats> {
    const { rows } = await this.db.query<MessageStats['perChannel'][number]>(
      `SELECT c.username AS channel, count(m.id)::int AS messages,
              min(m.posted_at) AS oldest, max(m.posted_at) AS newest
       FROM channels c LEFT JOIN messages m ON m.channel_id = c.id
       GROUP BY c.username ORDER BY c.username`,
    );
    return { totalMessages: rows.reduce((s, r) => s + r.messages, 0), perChannel: rows };
  }
}
