import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { Kafka, logLevel, type Producer, type SASLOptions } from 'kafkajs';
import { REPORT_TOPIC } from '../../common/constants.js';

const MAX_QUEUE = 5000;
const BATCH_SIZE = 100;

type Mechanism = 'plain' | 'scram-sha-256' | 'scram-sha-512';

/**
 * Best-effort copy of every published report to a second (remote) Kafka cluster.
 * It has its own bounded in-memory queue and retries, so an unreachable remote never blocks the primary publisher.
 */
export class KafkaMirror {
  private readonly logger = new Logger(KafkaMirror.name);
  private readonly queue: Array<{ value: string }> = [];
  private readonly producer: Producer;
  private readonly topic: string;
  private readonly retryIntervalMs: number;
  private connected?: Promise<void>;
  private draining?: Promise<void>;
  private retryTimer?: NodeJS.Timeout;
  private closing = false;

  private constructor(config: ConfigService, brokers: string[]) {
    this.topic = config.get<string>('KAFKA_REMOTE_TOPIC') || REPORT_TOPIC;
    this.retryIntervalMs = Number(config.get('KAFKA_RETRY_INTERVAL_MS') ?? 60000);

    const username = config.get<string>('KAFKA_REMOTE_SASL_USERNAME');
    const password = config.get<string>('KAFKA_REMOTE_SASL_PASSWORD');
    const mechanism = (config.get<string>('KAFKA_REMOTE_SASL_MECHANISM') || 'scram-sha-512') as Mechanism;
    const caFile = config.get<string>('KAFKA_REMOTE_SSL_CA_FILE');

    const kafka = new Kafka({
      clientId: `${config.get<string>('KAFKA_CLIENT_ID') ?? 'blitz-transformer'}-remote`,
      brokers,
      ssl: caFile ? { ca: [readFileSync(caFile, 'utf8')] } : true,
      sasl: username && password ? ({ mechanism, username, password } as SASLOptions) : undefined,
      logLevel: logLevel.NOTHING,
      requestTimeout: 30000,
      enforceRequestTimeout: true,
      retry: { retries: 0 },
    });
    this.producer = kafka.producer({ allowAutoTopicCreation: false });
  }

  /** Returns a mirror when KAFKA_REMOTE_BROKERS is set; null (and a warning) when it is unset or misconfigured. */
  static fromConfig(config: ConfigService): KafkaMirror | null {
    const brokers = (config.get<string>('KAFKA_REMOTE_BROKERS') ?? '')
      .split(',')
      .map((b) => b.trim())
      .filter(Boolean);
    if (!brokers.length) return null;
    try {
      return new KafkaMirror(config, brokers);
    } catch (err) {
      new Logger(KafkaMirror.name).error(
        `Remote Kafka disabled: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  enqueue(value: string): void {
    if (this.closing) return;
    if (this.queue.length >= MAX_QUEUE) this.queue.shift();
    this.queue.push({ value });
    this.startDrain();
  }

  private startDrain(): void {
    if (this.draining || this.retryTimer || this.closing || !this.queue.length) return;
    this.draining = this.drain().finally(() => {
      this.draining = undefined;
      this.startDrain();
    });
  }

  private async drain(): Promise<void> {
    while (this.queue.length && !this.closing) {
      const batch = this.queue.slice(0, BATCH_SIZE);
      try {
        this.connected ??= this.producer.connect().catch((err: unknown) => {
          this.connected = undefined;
          throw err;
        });
        await this.connected;
        const ack = await this.producer.send({
          topic: this.topic,
          acks: -1,
          timeout: 30000,
          messages: batch.map(({ value }) => ({ value })),
        });
        if (!ack.length || ack.some((r) => r.errorCode !== 0)) throw new Error('Kafka publication was not confirmed.');
      } catch (err) {
        this.connected = undefined;
        if (!this.closing) {
          this.logger.warn({
            event: 'remote_kafka_retry',
            queuedReports: this.queue.length,
            retryInMs: this.retryIntervalMs,
            error: err instanceof Error ? err.message : String(err),
          });
          this.retryTimer = setTimeout(() => {
            this.retryTimer = undefined;
            this.startDrain();
          }, this.retryIntervalMs);
        }
        return;
      }
      this.queue.splice(0, batch.length);
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    clearTimeout(this.retryTimer);
    await this.draining;
    await this.producer.disconnect().catch(() => undefined);
  }
}
