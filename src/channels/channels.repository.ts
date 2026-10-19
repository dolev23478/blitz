import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import type { Channel } from '../types.js';

const columns = `id, username, title, active, source, tg_chat_id AS "tgChatId", last_message_id AS "lastMessageId",
  backfilled_at AS "backfilledAt", last_polled_at AS "lastPolledAt",
  last_error AS "lastError", created_at AS "createdAt"`;

@Injectable()
export class ChannelsRepository {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async list(): Promise<Channel[]> {
    return (await this.db.query<Channel>(`SELECT ${columns} FROM channels ORDER BY username`)).rows;
  }

  async listActive(): Promise<Channel[]> {
    return (await this.db.query<Channel>(`SELECT ${columns} FROM channels WHERE active ORDER BY id`)).rows;
  }

  async get(id: number): Promise<Channel | null> {
    return (await this.db.query<Channel>(`SELECT ${columns} FROM channels WHERE id = $1`, [id])).rows[0] ?? null;
  }

  async getByUsername(username: string): Promise<Channel | null> {
    return (
      await this.db.query<Channel>(`SELECT ${columns} FROM channels WHERE username = $1`, [username])
    ).rows[0] ?? null;
  }

  async create(username: string, title: string | null): Promise<Channel> {
    return (
      await this.db.query<Channel>(
        `INSERT INTO channels (username, title) VALUES ($1, $2) RETURNING ${columns}`,
        [username, title],
      )
    ).rows[0]!;
  }

  async getByTgChatId(tgChatId: number): Promise<Channel | null> {
    return (
      await this.db.query<Channel>(`SELECT ${columns} FROM channels WHERE tg_chat_id = $1`, [tgChatId])
    ).rows[0] ?? null;
  }

  async listTelegram(): Promise<Channel[]> {
    return (
      await this.db.query<Channel>(`SELECT ${columns} FROM channels WHERE source = 'mtproto' AND active ORDER BY id`)
    ).rows;
  }

  async createTelegram(tgChatId: number, username: string, title: string | null): Promise<Channel> {
    return (
      await this.db.query<Channel>(
        `INSERT INTO channels (username, title, source, tg_chat_id) VALUES ($1, $2, 'mtproto', $3)
         RETURNING ${columns}`,
        [username, title, tgChatId],
      )
    ).rows[0]!;
  }

  async setActive(id: number, active: boolean): Promise<Channel | null> {
    return (
      await this.db.query<Channel>(`UPDATE channels SET active = $2 WHERE id = $1 RETURNING ${columns}`, [id, active])
    ).rows[0] ?? null;
  }

  async remove(id: number): Promise<boolean> {
    return ((await this.db.query('DELETE FROM channels WHERE id = $1', [id])).rowCount ?? 0) > 0;
  }

  async markPolled(id: number, lastMessageId: number | null, title: string | null): Promise<void> {
    await this.db.query(
      `UPDATE channels SET last_polled_at = now(), last_error = NULL,
         last_message_id = GREATEST(coalesce(last_message_id, 0), coalesce($2, 0)),
         title = coalesce($3, title)
       WHERE id = $1`,
      [id, lastMessageId, title],
    );
  }

  async markBackfilled(id: number): Promise<void> {
    await this.db.query('UPDATE channels SET backfilled_at = now() WHERE id = $1', [id]);
  }

  async markError(id: number, error: string): Promise<void> {
    await this.db.query('UPDATE channels SET last_error = $2, last_polled_at = now() WHERE id = $1', [id, error]);
  }
}
