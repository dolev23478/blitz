import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
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
      this.client = createClient({ url: this.config.REDIS_URL! });
      this.client.on('error', (err: Error) => {
        this.logger.warn(`Redis error: ${err.message}`);
        this.client = null;
      });

      await this.client.connect();
      this.logger.log('Redis connected');
    } catch (error) {
      this.client = null;
      this.logger.warn(
        `Redis is unavailable; continuing without Redis. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.client) return;
    await this.client.quit();
    this.client = null;
  }

  isEnabled(): boolean {
    return this.enabled && this.client !== null;
  }

  async publish(channel: string, message: string): Promise<number> {
    if (!this.client) {
      this.logger.warn(`Redis publish skipped for channel=${channel} because Redis is unavailable.`);
      return 0;
    }
    return this.client.publish(channel, message);
  }

  async set(key: string, value: string): Promise<string> {
    if (!this.client) {
      this.logger.warn(`Redis set skipped for key=${key} because Redis is unavailable.`);
      return '';
    }
    const result = await this.client.set(key, value);
    if (result !== 'OK') throw new Error('Redis did not confirm the write.');
    return result;
  }

  async get(key: string): Promise<string | null> {
    if (!this.client) {
      return null;
    }
    return this.client.get(key);
  }

  async hset(hash: string, field: string, value: string): Promise<number> {
    if (!this.client) {
      this.logger.warn(`Redis hset skipped for hash=${hash} field=${field} because Redis is unavailable.`);
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
