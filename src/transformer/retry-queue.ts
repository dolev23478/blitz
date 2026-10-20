import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { RedisService } from '../redis/redis.service.js';
import type { RawReport } from '../contracts/schema.js';

export const RETRY_LEASE_MS = 120000;
export const RETRY_POLL_MS = 250;
export const MAX_PUBLISH_ATTEMPTS = 4; // Initial attempt plus the user's approved 3 retries.
// Short-lived caller receipts, not a report archive or permanent deduplication cache.
export const RECEIPT_TTL_MS = 60000;
export interface RetryError {
  at: number;
  name: string;
  message: string;
}
export interface RetryJob {
  id: string;
  report: RawReport;
  /** Original wire JSON kept opaque to Lua, so empty arrays cannot become objects. */
  payload: string;
  attempts: number;
  retryCount: number;
  nextRetryAt: number;
  errors: RetryError[];
  status: 'pending' | 'processing';
  exhausted?: boolean;
}
export type RetryOutcome = 'pending' | 'confirmed' | 'discarded' | 'missing';

const nowLua = `local t = redis.call('TIME'); local now = t[1] * 1000 + math.floor(t[2] / 1000)`;
export const ENQUEUE = `-- transformer:enqueue
${nowLua}
local entries = cjson.decode(ARGV[1])
for i, entry in ipairs(entries) do
  if redis.call('HEXISTS', KEYS[2], entry.id) == 0 and redis.call('EXISTS', KEYS[2+i]) == 0 then
    entry.nextRetryAt = now
    redis.call('HSET', KEYS[2], entry.id, cjson.encode(entry))
    redis.call('RPUSH', KEYS[1], entry.id)
  end
end
return 1`;

export const CLAIM = `-- transformer:claim
${nowLua}
if not redis.call('SET', KEYS[3], ARGV[1], 'NX', 'PX', ARGV[2]) then return nil end
local id = redis.call('LINDEX', KEYS[1], 0)
if not id then redis.call('DEL', KEYS[3]); return nil end
local value = redis.call('HGET', KEYS[2], id)
if not value then redis.call('DEL', KEYS[3]); return redis.error_reply('Missing outbox record; head preserved') end
local entry = cjson.decode(value)
if entry.nextRetryAt > now then redis.call('DEL', KEYS[3]); return nil end
if entry.attempts >= ${MAX_PUBLISH_ATTEMPTS} then entry.exhausted = true; return cjson.encode(entry) end
entry.attempts = entry.attempts + 1
entry.retryCount = entry.attempts - 1
entry.status = 'processing'
entry.nextRetryAt = now + tonumber(ARGV[2])
redis.call('HSET', KEYS[2], id, cjson.encode(entry))
return cjson.encode(entry)`;

export const RENEW = `-- transformer:renew
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
return redis.call('PEXPIRE', KEYS[1], ARGV[2])`;

export const RELEASE = `-- transformer:release
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
return redis.call('DEL', KEYS[1])`;

export const RESCHEDULE = `-- transformer:reschedule
${nowLua}
if redis.call('GET', KEYS[3]) ~= ARGV[1] or redis.call('LINDEX', KEYS[1], 0) ~= ARGV[2] then return 0 end
local entry = cjson.decode(redis.call('HGET', KEYS[2], ARGV[2]))
local detail = cjson.decode(ARGV[3]); detail.at = now
table.insert(entry.errors, detail)
entry.status = 'pending'; entry.nextRetryAt = now + tonumber(ARGV[4])
redis.call('HSET', KEYS[2], entry.id, cjson.encode(entry))
return 1`;

export const FINISH = `-- transformer:finish
if redis.call('GET', KEYS[3]) ~= ARGV[1] or redis.call('LINDEX', KEYS[1], 0) ~= ARGV[2] then return 0 end
redis.call('SET', KEYS[4], ARGV[3], 'PX', ARGV[4])
redis.call('LPOP', KEYS[1])
redis.call('HDEL', KEYS[2], ARGV[2])
return 1`;

export const OUTCOMES = `-- transformer:outcomes
local outcomes = {}
for i, id in ipairs(cjson.decode(ARGV[1])) do
  local receipt = redis.call('GET', KEYS[i+1])
  if receipt then outcomes[i] = receipt
  elseif redis.call('HEXISTS', KEYS[1], id) == 1 then outcomes[i] = 'pending'
  else outcomes[i] = 'missing' end
end
return outcomes`;

/** A persisted FIFO with one renewable, token-checked lease on a Redis primary. */
@Injectable()
export class RedisRetryQueue {
  private readonly prefix: string;
  private readonly keys: string[];
  constructor(
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.prefix =
      config.get<string>('TRANSFORMER_RETRY_PREFIX') ??
      'blitz:{reports.raw}:outbox';
    this.keys = [
      this.prefix + ':queue',
      this.prefix + ':jobs',
      this.prefix + ':lease',
    ];
  }
  isEnabled(): boolean {
    return this.redis.isEnabled();
  }
  private receipt(id: string) {
    return this.prefix + ':result:' + id;
  }
  async enqueue(values: string[]): Promise<string[]> {
    const entries: RetryJob[] = values.map((value) => ({
      id: createHash('sha256').update(value).digest('hex'),
      report: JSON.parse(value) as RawReport,
      payload: value,
      attempts: 0,
      retryCount: 0,
      nextRetryAt: 0,
      errors: [],
      status: 'pending',
    }));
    if (entries.length)
      await this.redis.eval(
        ENQUEUE,
        this.keys
          .slice(0, 2)
          .concat(entries.map((entry) => this.receipt(entry.id))),
        [JSON.stringify(entries.map(({ report: _report, ...entry }) => entry))],
      );
    return entries.map((entry) => entry.id);
  }
  async claim(token: string): Promise<RetryJob | undefined> {
    const result = await this.redis.eval(CLAIM, this.keys, [
      token,
      String(RETRY_LEASE_MS),
    ]);
    if (typeof result !== 'string') return undefined;
    const job = JSON.parse(result) as RetryJob;
    job.report = JSON.parse(job.payload) as RawReport;
    if (!Array.isArray(job.errors)) job.errors = [];
    return job;
  }
  async renew(token: string): Promise<boolean> {
    return (
      (await this.redis.eval(
        RENEW,
        [this.keys[2]!],
        [token, String(RETRY_LEASE_MS)],
      )) === 1
    );
  }
  async release(token: string): Promise<void> {
    await this.redis.eval(RELEASE, [this.keys[2]!], [token]);
  }
  async retry(
    job: RetryJob,
    token: string,
    error: RetryError,
    delay: number,
  ): Promise<void> {
    if (
      (await this.redis.eval(RESCHEDULE, this.keys, [
        token,
        job.id,
        JSON.stringify(error),
        String(delay),
      ])) !== 1
    )
      throw new Error('Redis retry lease was lost; original record retained.');
  }
  async finish(
    job: RetryJob,
    token: string,
    outcome: 'confirmed' | 'discarded',
  ): Promise<void> {
    if (
      (await this.redis.eval(FINISH, this.keys.concat(this.receipt(job.id)), [
        token,
        job.id,
        outcome,
        String(RECEIPT_TTL_MS),
      ])) !== 1
    )
      throw new Error('Redis retry lease was lost; original record retained.');
  }
  async outcomes(ids: string[]): Promise<RetryOutcome[]> {
    if (!ids.length) return [];
    return (await this.redis.eval(
      OUTCOMES,
      [this.keys[1]!, ...ids.map((id) => this.receipt(id))],
      [JSON.stringify(ids)],
    )) as RetryOutcome[];
  }
}
