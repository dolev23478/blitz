import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { createClient, type RedisClientType } from 'redis';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: RedisClientType | null = null;
  private readonly enabled: boolean;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.enabled = Boolean(this.config.REDIS_URL);
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.warn('REDIS_URL is not configured; Redis is disabled.');
      return;
    }

    try {
      this.client = createClient({
        url: this.config.REDIS_URL!,
        disableOfflineQueue: true,
      });
      this.client.on('error', (err: Error) => {
        this.logger.warn(`Redis error: ${err.message}`);
        // node-redis reconnects this client; keep its reference for recovery/shutdown.
      });

      await this.client.connect();
      this.logger.log('Redis connected');
    } catch (error) {
      if (this.client?.isOpen) this.client.destroy();
      this.client = null;
      this.logger.warn(
        `Redis is unavailable; continuing without Redis. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (client?.isReady) await client.quit();
    else if (client?.isOpen) client.destroy();
  }

  isEnabled(): boolean {
    return this.enabled && this.client?.isReady === true;
  }

  /** Atomic queue/lease operations reuse this application's existing connection. */
  async eval(
    script: string,
    keys: string[],
    arguments_: string[],
  ): Promise<unknown> {
    if (!this.client)
      throw new Error(
        'Redis is not connected; publication requires REDIS_URL.',
      );
    return this.client.eval(script, { keys, arguments: arguments_ });
  }

  async publish(channel: string, message: string): Promise<number> {
    if (!this.client) {
      this.logger.warn(
        `Redis publish skipped for channel=${channel} because Redis is unavailable.`,
      );
      return 0;
    }
    return this.client.publish(channel, message);
  }

  async set(key: string, value: string): Promise<string> {
    if (!this.client) {
      this.logger.warn(
        `Redis set skipped for key=${key} because Redis is unavailable.`,
      );
      return '';
    }
    const result = await this.client.set(key, value);
    if (result !== 'OK') throw new Error('Redis did not confirm the write.');
    return result;
  }

  /** Sets a value that expires on its own after `ttlSeconds`. */
  async setEx(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (!this.client) throw new Error('Redis is not connected');
    const result = await this.client.set(key, value, { EX: ttlSeconds });
    if (result !== 'OK') throw new Error('Redis did not confirm the write.');
  }

  async get(key: string): Promise<string | null> {
    if (!this.client) {
      return null;
    }
    return this.client.get(key);
  }

  /** Atomically sets the key only when it does not exist yet; true when this call claimed it. */
  async setIfAbsent(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    if (!this.client) throw new Error('Redis is not connected');
    return (
      (await this.client.set(key, value, { NX: true, EX: ttlSeconds })) === 'OK'
    );
  }

  async del(key: string): Promise<number> {
    if (!this.client) throw new Error('Redis is not connected');
    return this.client.del(key);
  }

  async hset(hash: string, field: string, value: string): Promise<number> {
    if (!this.client) {
      this.logger.warn(
        `Redis hset skipped for hash=${hash} field=${field} because Redis is unavailable.`,
      );
      return 0;
    }
    return this.client.hSet(hash, field, value);
  }

  async hget(hash: string, field: string): Promise<string | null> {
    if (!this.client) {
      return null;
    }
    return this.client.hGet(hash, field);
  }

  async hgetall(hash: string): Promise<Record<string, string>> {
    if (!this.client) {
      return {};
    }
    return this.client.hGetAll(hash);
  }
}
