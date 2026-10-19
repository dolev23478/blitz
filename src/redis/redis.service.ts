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

    this.client = createClient({ url: this.config.REDIS_URL! });
    this.client.on('error', (err: Error) => this.logger.error(`Redis error: ${err.message}`));

    await this.client.connect();
    this.logger.log('Redis connected');
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
    if (!this.client) throw new Error('Redis is not connected');
    return this.client.publish(channel, message);
  }

  async set(key: string, value: string): Promise<'OK'> {
    if (!this.client) throw new Error('Redis is not connected');
    return this.client.set(key, value);
  }

  async get(key: string): Promise<string | null> {
    if (!this.client) throw new Error('Redis is not connected');
    return this.client.get(key);
  }

  async hset(hash: string, field: string, value: string): Promise<number> {
    if (!this.client) throw new Error('Redis is not connected');
    return this.client.hSet(hash, field, value);
  }

  async hget(hash: string, field: string): Promise<string | null> {
    if (!this.client) throw new Error('Redis is not connected');
    return this.client.hGet(hash, field);
  }

  async hgetall(hash: string): Promise<Record<string, string>> {
    if (!this.client) throw new Error('Redis is not connected');
    return this.client.hGetAll(hash);
  }
}
