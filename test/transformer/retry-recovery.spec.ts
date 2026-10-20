import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, type Producer, type RecordMetadata } from 'kafkajs';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { PublishingProcessor } from '../../src/transformer/processors/publishing.processor.js';
import { RETRY_LEASE_MS } from '../../src/transformer/retry-queue.js';
import { ReportValidator } from '../../src/transformer/report-validator.js';
import { context, rawReport } from './fixtures.js';
import { FakeRetryQueue, FakeRetryStorage } from './fake-retry-queue.js';

const ack: RecordMetadata[] = [
  { topicName: 'reports.raw', partition: 0, errorCode: 0 },
];
const send = vi.fn();
const processors: PublishingProcessor[] = [];
const config = new ConfigService({ KAFKA_BROKERS: 'capture.invalid:9092' });
function publisher(queue: FakeRetryQueue) {
  const p = new PublishingProcessor(config, queue);
  processors.push(p);
  return p;
}
const ctx = () => ({ ...context(), reports: [rawReport()] });
beforeEach(() => {
  vi.useFakeTimers();
  send.mockReset().mockResolvedValue(ack);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  vi.spyOn(Kafka.prototype, 'producer').mockReturnValue({
    connect: async () => undefined,
    send,
    disconnect: async () => undefined,
  } as unknown as Producer);
});
afterEach(async () => {
  for (const p of processors.splice(0)) await p.onModuleDestroy();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('publication recovery with a storage double (not a live Redis integration)', () => {
  it('never sends when durable Redis admission fails', async () => {
    const q = new FakeRetryQueue();
    vi.spyOn(q, 'enqueue').mockRejectedValue(new Error('Redis unavailable'));
    await expect(publisher(q).execute(ctx())).rejects.toThrow(
      'caller must retain',
    );
    expect(send).not.toHaveBeenCalled();
  });
  it('retains original report, attempt count, next retry time and errors until the fourth failed attempt', async () => {
    const q = new FakeRetryQueue();
    send.mockRejectedValue(new Error('broker unavailable'));
    const p = publisher(q);
    const running = p.execute(ctx());
    const rejected = expect(running).rejects.toThrow('3 retries');
    await vi.advanceTimersByTimeAsync(0);
    const job = [...q.storage.jobs.values()][0]!;
    expect(job.report).toEqual(rawReport());
    expect(job.attempts).toBe(1);
    expect(job.retryCount).toBe(0);
    expect(job.nextRetryAt).toBe(Date.now() + 60000);
    expect(job.errors[0]!.message).toBe('broker unavailable');
    for (let attempt = 2; attempt <= 3; attempt++) {
      await vi.advanceTimersByTimeAsync(60000);
      expect(send).toHaveBeenCalledTimes(attempt);
      expect(q.storage.jobs.size).toBe(1);
    }
    await vi.advanceTimersByTimeAsync(60000);
    await rejected;
    expect(send).toHaveBeenCalledTimes(4);
    expect(q.storage.jobs.size).toBe(0);
    expect(q.storage.order).toEqual([]);
    await vi.advanceTimersByTimeAsync(300000);
    expect(send).toHaveBeenCalledTimes(4);
  });
  it('recovers a failed pending report after destroying and recreating the application-side publisher', async () => {
    const storage = new FakeRetryStorage();
    const q1 = new FakeRetryQueue(storage);
    const first = publisher(q1);
    send.mockRejectedValueOnce(new Error('outage'));
    const running = first.execute(ctx());
    const rejected = expect(running).rejects.toThrow('persisted in Redis');
    await vi.advanceTimersByTimeAsync(0);
    await first.onModuleDestroy();
    await rejected;
    expect(storage.jobs.size).toBe(1);
    const second = publisher(new FakeRetryQueue(storage));
    second.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(59999);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(storage.jobs.size).toBe(0);
  });
  it('shares a claimed job between two publisher instances without concurrent Kafka sends', async () => {
    const storage = new FakeRetryStorage();
    const q1 = new FakeRetryQueue(storage);
    const q2 = new FakeRetryQueue(storage);
    let confirm!: (value: RecordMetadata[]) => void;
    send.mockReturnValueOnce(
      new Promise((resolve) => {
        confirm = resolve;
      }),
    );
    const first = publisher(q1).execute(ctx());
    const second = publisher(q2).execute(ctx());
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(storage.jobs.size).toBe(1);
    await vi.advanceTimersByTimeAsync(RETRY_LEASE_MS + 1);
    expect(await q2.claim('different-instance')).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
    confirm(ack);
    await vi.advanceTimersByTimeAsync(250);
    await Promise.all([first, second]);
    expect(storage.jobs.size).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('rejects stale owner completion after a lease expires', async () => {
    const q = new FakeRetryQueue();
    const value = new ReportValidator(config).serialize(
      rawReport({ languages: [], categories: [] }),
    );
    await q.enqueue([value]);
    const first = (await q.claim('old-owner'))!;
    await vi.advanceTimersByTimeAsync(RETRY_LEASE_MS);
    const replacement = (await q.claim('new-owner'))!;
    await expect(q.finish(first, 'old-owner', 'confirmed')).rejects.toThrow(
      'Lease lost',
    );
    expect(q.storage.jobs.size).toBe(1);
    expect(replacement.attempts).toBe(2);
    await q.finish(replacement, 'new-owner', 'confirmed');
    expect(q.storage.jobs.size).toBe(0);
  });
  it('retains data if Redis cannot record a successful Kafka acknowledgment', async () => {
    const q = new FakeRetryQueue();
    vi.spyOn(q, 'finish').mockRejectedValueOnce(new Error('lost Redis reply'));
    const retried = vi.spyOn(q, 'retry');
    const p = publisher(q);
    const running = p.execute(ctx());
    const rejected = expect(running).rejects.toThrow('persisted in Redis');
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(q.storage.jobs.size).toBe(1);
    expect(retried).not.toHaveBeenCalled();
    await p.onModuleDestroy();
    await rejected;
  });
  it('revalidates recovered records and never sends contract-invalid JSON', async () => {
    const q = new FakeRetryQueue();
    const payload = JSON.stringify({ ...rawReport(), schema_version: '1.0.0' });
    await q.enqueue([payload]);
    const p = publisher(q);
    p.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(180000);
    expect(send).not.toHaveBeenCalled();
    expect(q.storage.jobs.size).toBe(0);
  });
});
