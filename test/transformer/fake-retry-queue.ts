import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { RedisService } from '../../src/redis/redis.service.js';
import {
  RedisRetryQueue,
  RETRY_LEASE_MS,
  RECEIPT_TTL_MS,
  type RetryError,
  type RetryJob,
  type RetryOutcome,
} from '../../src/transformer/retry-queue.js';

/** A deterministic storage double, NOT a Redis integration test or execution of Lua. */
export class FakeRetryStorage {
  jobs = new Map<string, RetryJob>();
  order: string[] = [];
  lease?: { token: string; expires: number };
  receipts = new Map<string, { outcome: RetryOutcome; expires: number }>();
}
export class FakeRetryQueue extends RedisRetryQueue {
  constructor(readonly storage = new FakeRetryStorage()) {
    super({ isEnabled: () => true } as RedisService, new ConfigService());
  }
  override isEnabled() {
    return true;
  }
  override async enqueue(values: string[]) {
    return values.map((payload) => {
      const id = createHash('sha256').update(payload).digest('hex');
      const receipt = this.storage.receipts.get(id);
      if (receipt && receipt.expires <= Date.now())
        this.storage.receipts.delete(id);
      if (!this.storage.jobs.has(id) && !this.storage.receipts.has(id)) {
        this.storage.jobs.set(id, {
          id,
          payload,
          report: JSON.parse(payload),
          attempts: 0,
          retryCount: 0,
          nextRetryAt: Date.now(),
          errors: [],
          status: 'pending',
        });
        this.storage.order.push(id);
      }
      return id;
    });
  }
  override async claim(token: string): Promise<RetryJob | undefined> {
    if (this.storage.lease && this.storage.lease.expires > Date.now())
      return undefined;
    const job = this.storage.jobs.get(this.storage.order[0] ?? '');
    if (!job || job.nextRetryAt > Date.now()) return undefined;
    this.storage.lease = { token, expires: Date.now() + RETRY_LEASE_MS };
    if (job.attempts >= 4) return { ...structuredClone(job), exhausted: true };
    job.attempts++;
    job.retryCount = job.attempts - 1;
    job.status = 'processing';
    job.nextRetryAt = Date.now() + RETRY_LEASE_MS;
    return structuredClone(job);
  }
  override async renew(token: string) {
    if (
      this.storage.lease?.token !== token ||
      this.storage.lease.expires <= Date.now()
    )
      return false;
    this.storage.lease.expires = Date.now() + RETRY_LEASE_MS;
    return true;
  }
  override async release(token: string) {
    if (this.storage.lease?.token === token) this.storage.lease = undefined;
  }
  private owns(job: RetryJob, token: string) {
    if (
      this.storage.lease?.token !== token ||
      this.storage.lease.expires <= Date.now() ||
      this.storage.order[0] !== job.id
    )
      throw new Error('Lease lost; record retained');
  }
  override async retry(
    job: RetryJob,
    token: string,
    error: RetryError,
    delay: number,
  ) {
    this.owns(job, token);
    const stored = this.storage.jobs.get(job.id)!;
    stored.errors.push(structuredClone(error));
    stored.status = 'pending';
    stored.nextRetryAt = Date.now() + delay;
  }
  override async finish(
    job: RetryJob,
    token: string,
    outcome: 'confirmed' | 'discarded',
  ) {
    this.owns(job, token);
    this.storage.receipts.set(job.id, {
      outcome,
      expires: Date.now() + RECEIPT_TTL_MS,
    });
    this.storage.order.shift();
    this.storage.jobs.delete(job.id);
  }
  override async outcomes(ids: string[]): Promise<RetryOutcome[]> {
    return ids.map((id) => {
      const receipt = this.storage.receipts.get(id);
      if (receipt && receipt.expires > Date.now()) return receipt.outcome;
      return this.storage.jobs.has(id) ? 'pending' : 'missing';
    });
  }
}
