import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { Kafka, logLevel, type Producer, type SASLOptions } from 'kafkajs';
import { REPORT_TOPIC } from '../../common/constants.js';
import { State, TransformerErrorCode } from '../../common/enums.js';
import { TransformerException } from '../../common/exceptions.js';
import type { TransformContext } from '../transformer.types.js';
import { ReportValidator } from '../report-validator.js';
import {
  RedisRetryQueue,
  RETRY_LEASE_MS,
  RETRY_POLL_MS,
  MAX_PUBLISH_ATTEMPTS,
  type RetryJob,
} from '../retry-queue.js';

interface Waiter {
  resolve: () => void;
  reject: (error: Error) => void;
}

@Injectable()
export class PublishingProcessor
  implements OnApplicationBootstrap, OnModuleDestroy
{
  readonly stage = State.Publishing;
  private readonly logger = new Logger(PublishingProcessor.name);
  private readonly waiters = new Map<string, Set<Waiter>>();
  private readonly validator: ReportValidator;
  private readonly retryIntervalMs: number;
  private timer?: NodeJS.Timeout;
  private ticking?: Promise<void>;
  private producer?: Producer;
  private connection?: Promise<void>;
  private closing = false;
  private background = false;

  constructor(
    private readonly config: ConfigService,
    private readonly queue: RedisRetryQueue,
  ) {
    this.validator = new ReportValidator(config);
    this.retryIntervalMs = Number(
      config.get('KAFKA_RETRY_INTERVAL_MS') ?? 60000,
    );
    if (
      !Number.isInteger(this.retryIntervalMs) ||
      this.retryIntervalMs < 1 ||
      this.retryIntervalMs > 2147483647
    )
      throw new TransformerException(
        TransformerErrorCode.PublicationFailed,
        'KAFKA_RETRY_INTERVAL_MS must be an integer between 1 and 2147483647.',
      );
  }

  onApplicationBootstrap(): void {
    if (
      !this.queue.isEnabled() ||
      !this.config.get<string>('KAFKA_BROKERS')?.trim()
    )
      return;
    this.background = true;
    this.kick(); // Also recovers jobs persisted by a previous application instance.
  }

  async execute(context: TransformContext): Promise<void> {
    if (!context.reports)
      throw new Error('Validation must produce reports before publishing.');
    if (this.closing) throw this.failure('Transformer is shutting down.');
    context.publishedReports = [];
    if (!context.reports.length) return;
    this.getProducer();
    // Validate and serialize the ENTIRE batch before any Redis write or Kafka publication.
    const values = context.reports.map((report) =>
      this.validator.serialize(report),
    );
    const snapshots = values.map((value) => JSON.parse(value));
    let ids: string[];
    try {
      ids = await this.queue.enqueue(values);
    } catch {
      throw this.failure(
        'Redis did not confirm durable admission; caller must retain the reports.',
      );
    }
    const confirmed = ids.map(
      (id, index) =>
        new Promise<void>((resolve, reject) => {
          const waiter = {
            resolve: () => {
              context.publishedReports!.push(snapshots[index]);
              resolve();
            },
            reject,
          };
          const listeners = this.waiters.get(id) ?? new Set<Waiter>();
          listeners.add(waiter);
          this.waiters.set(id, listeners);
        }),
    );
    this.kick();
    await Promise.all(confirmed);
  }

  private failure(message: string): TransformerException {
    return new TransformerException(
      TransformerErrorCode.PublicationFailed,
      message,
    );
  }

  private kick(): void {
    if (this.closing || this.ticking) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.ticking = this.tick()
      .catch(() => {
        this.logger.warn({ event: 'redis_publication_recovery_pending' });
      })
      .finally(() => {
        this.ticking = undefined;
        if (!this.closing && (this.background || this.waiters.size)) {
          this.timer = setTimeout(
            () => {
              this.timer = undefined;
              this.kick();
            },
            Math.min(RETRY_POLL_MS, this.retryIntervalMs),
          );
          this.timer.unref();
        }
      });
  }

  private async settle(): Promise<void> {
    const ids = [...this.waiters.keys()];
    const outcomes = await this.queue.outcomes(ids);
    ids.forEach((id, index) => {
      const outcome = outcomes[index];
      if (outcome === 'pending') return;
      const listeners = this.waiters.get(id);
      this.waiters.delete(id);
      for (const listener of listeners ?? []) {
        if (outcome === 'confirmed') listener.resolve();
        else
          listener.reject(
            this.failure(
              outcome === 'discarded'
                ? 'Kafka publication failed after the initial attempt and 3 retries; report discarded by user policy.'
                : 'Redis publication receipt is unavailable; publication outcome is uncertain.',
            ),
          );
      }
    });
  }

  private async tick(): Promise<void> {
    await this.settle();
    while (!this.closing) {
      const token = randomUUID();
      const job = await this.queue.claim(token);
      if (!job) return;
      try {
        await this.publish(job, token);
      } finally {
        await this.queue.release(token);
      }
      await this.settle();
    }
  }

  private async publish(job: RetryJob, token: string): Promise<void> {
    let leaseValid = true;
    let renewing = false;
    const heartbeat = setInterval(() => {
      if (renewing) return;
      renewing = true;
      void this.queue
        .renew(token)
        .then((valid) => {
          leaseValid = leaseValid && valid;
        })
        .catch(() => {
          leaseValid = false;
        })
        .finally(() => {
          renewing = false;
        });
    }, RETRY_LEASE_MS / 3);
    heartbeat.unref();
    try {
      if (job.exhausted) {
        await this.queue.finish(job, token, 'discarded');
        this.logger.error({
          event: 'kafka_report_discarded',
          reportId: job.report.report_id,
          attempts: job.attempts,
        });
        return;
      }
      try {
        const value = this.validator.serialize(job.report);
        const producer = await this.connect();
        if (!leaseValid || !(await this.queue.renew(token)))
          throw new Error('Publication lease lost.');
        const acknowledgment = await producer.send({
          topic: REPORT_TOPIC,
          acks: -1,
          timeout: 30000,
          messages: [{ key: String(job.report.report_id), value }],
        });
        if (
          !Array.isArray(acknowledgment) ||
          !acknowledgment.length ||
          acknowledgment.some(
            (record) =>
              record.topicName !== REPORT_TOPIC || record.errorCode !== 0,
          )
        )
          throw new Error('Kafka publication was not confirmed.');
      } catch (error) {
        this.connection = undefined;
        if (!leaseValid)
          throw new Error('Publication lease lost; record retained.');
        if (job.attempts >= MAX_PUBLISH_ATTEMPTS) {
          await this.queue.finish(job, token, 'discarded');
          this.logger.error({
            event: 'kafka_report_discarded',
            reportId: job.report.report_id,
            attempts: job.attempts,
          });
        } else {
          await this.queue.retry(
            job,
            token,
            {
              at: Date.now(),
              name: error instanceof Error ? error.name : 'Error',
              message:
                error instanceof Error
                  ? error.message.slice(0, 500)
                  : 'Unknown publication error',
            },
            this.retryIntervalMs,
          );
          this.logger.warn({
            event: 'kafka_publish_retry',
            reportId: job.report.report_id,
            retryCount: job.retryCount,
            retryInMs: this.retryIntervalMs,
          });
        }
        return;
      }
      // Redis acknowledgment errors MUST NOT be treated as Kafka send failures.
      // A lost reply may mean FINISH already succeeded. Otherwise recovery retains the head.
      if (!leaseValid)
        throw new Error(
          'Publication lease lost after acknowledgment; record retained.',
        );
      await this.queue.finish(job, token, 'confirmed');
    } finally {
      clearInterval(heartbeat);
    }
  }

  private getProducer(): Producer {
    if (!this.producer) {
      const brokers = this.config
        .get<string>('KAFKA_BROKERS')
        ?.split(',')
        .map((broker) => broker.trim())
        .filter(Boolean);
      if (!brokers?.length)
        throw new TransformerException(
          TransformerErrorCode.PublicationFailed,
          'KAFKA_BROKERS is required.',
        );
      for (const broker of brokers) {
        const address = /^(\[[\da-f:]+\]|[a-z\d._-]+):(\d+)$/i.exec(broker);
        if (!address || Number(address[2]) < 1 || Number(address[2]) > 65535)
          throw new TransformerException(
            TransformerErrorCode.PublicationFailed,
            'KAFKA_BROKERS must contain native Kafka host:port addresses.',
          );
      }
      const username = this.config.get<string>('KAFKA_SASL_USERNAME');
      const password = this.config.get<string>('KAFKA_SASL_PASSWORD');
      const mechanism =
        this.config.get<string>('KAFKA_SASL_MECHANISM') ?? 'plain';
      const ssl = this.config.get<string | boolean>('KAFKA_SSL') ?? false;
      if (![true, false, 'true', 'false'].includes(ssl)) {
        throw new TransformerException(
          TransformerErrorCode.PublicationFailed,
          'KAFKA_SSL must be true or false.',
        );
      }
      let sasl: SASLOptions | undefined;
      if (username || password) {
        if (
          !username ||
          !password ||
          !['plain', 'scram-sha-256', 'scram-sha-512'].includes(mechanism)
        )
          throw new TransformerException(
            TransformerErrorCode.PublicationFailed,
            'Invalid Kafka SASL configuration.',
          );
        sasl = {
          username,
          password,
          mechanism: mechanism as 'plain' | 'scram-sha-256' | 'scram-sha-512',
        };
      }
      const kafka = new Kafka({
        clientId:
          this.config.get<string>('KAFKA_CLIENT_ID') ?? 'blitz-transformer',
        brokers,
        ssl: ssl === true || ssl === 'true',
        sasl,
        logLevel: logLevel.NOTHING,
        requestTimeout: 30000,
        connectionTimeout: 5000,
        enforceRequestTimeout: true,
        retry: { retries: 0 }, // The queue owns retries and their interval.
      });
      this.producer = kafka.producer({
        allowAutoTopicCreation: false,
        idempotent: true,
        maxInFlightRequests: 1,
        retry: { retries: 1 },
      });
    }
    return this.producer;
  }

  private async connect(): Promise<Producer> {
    const producer = this.getProducer();
    if (!this.connection) {
      this.connection = producer.connect().catch((error: unknown) => {
        this.connection = undefined;
        throw error;
      });
    }
    await this.connection;
    return producer;
  }

  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    await this.ticking;
    // Complete only confirmed sends; all remaining data stays in Redis for restart recovery.
    await this.settle().catch(() => undefined);
    for (const listeners of this.waiters.values())
      for (const listener of listeners)
        listener.reject(
          this.failure(
            'Transformer shut down; pending reports remain persisted in Redis.',
          ),
        );
    this.waiters.clear();
    await this.producer?.disconnect();
  }
}
