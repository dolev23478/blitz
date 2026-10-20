import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, logLevel, type Producer, type SASLOptions } from 'kafkajs';
import { REPORT_TOPIC } from '../../common/constants.js';
import { KafkaMirror } from './kafka-mirror.js';
import { State, TransformerErrorCode } from '../../common/enums.js';
import { TransformerException } from '../../common/exceptions.js';
import type { RawReport } from '../../contracts/schema.js';
import type { TransformContext } from '../transformer.types.js';

interface PendingReport {
  report: RawReport;
  value: string;
  resolve: () => void;
  reject: (error: Error) => void;
}

@Injectable()
export class PublishingProcessor implements OnModuleDestroy {
  readonly stage = State.Publishing;
  private readonly logger = new Logger(PublishingProcessor.name);
  private readonly queue: PendingReport[] = [];
  private readonly retryIntervalMs: number;
  private retryTimer?: NodeJS.Timeout;
  private draining?: Promise<void>;
  private producer?: Producer;
  private connection?: Promise<void>;
  private closing = false;
  private readonly mirror: KafkaMirror | null;

  constructor(private readonly config: ConfigService) {
    this.mirror = KafkaMirror.fromConfig(config);
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

  async execute(context: TransformContext): Promise<void> {
    if (!context.reports)
      throw new Error('Validation must produce reports before publishing.');
    if (this.closing)
      throw new TransformerException(
        TransformerErrorCode.PublicationFailed,
        'Transformer is shutting down.',
      );
    context.publishedReports = [];
    if (!context.reports.length) return;

    // Reject invalid configuration before accepting responsibility for a batch.
    this.getProducer();
    const reports = context.reports.map((original) => {
      const report = structuredClone(original);
      return { report, value: JSON.stringify(report) };
    });
    for (const { report, value } of reports) this.mirror?.enqueue(String(report.report_id), value);
    // Enqueue the entire batch before starting, so concurrent calls cannot overtake it.
    const confirmed = reports.map(
      ({ report, value }) =>
        new Promise<void>((resolve, reject) => {
          this.queue.push({
            report,
            value,
            resolve: () => {
              context.publishedReports!.push(report);
              resolve();
            },
            reject,
          });
        }),
    );
    this.startDrain();
    await Promise.all(confirmed);
  }

  private startDrain(): void {
    if (this.draining || this.retryTimer || this.closing || !this.queue.length)
      return;
    this.draining = this.drain().finally(() => {
      this.draining = undefined;
      this.startDrain();
    });
  }

  private async drain(): Promise<void> {
    while (this.queue.length && !this.closing) {
      const entry = this.queue[0]!;
      try {
        const producer = await this.connect();
        const acknowledgment = await producer.send({
          topic: REPORT_TOPIC,
          acks: -1,
          timeout: 30000,
          messages: [
            { key: String(entry.report.report_id), value: entry.value },
          ],
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
      } catch {
        this.connection = undefined;
        if (!this.closing) {
          this.logger.warn({
            event: 'kafka_publish_retry',
            reportId: entry.report.report_id,
            queuedReports: this.queue.length,
            retryInMs: this.retryIntervalMs,
          });
          this.retryTimer = setTimeout(() => {
            this.retryTimer = undefined;
            this.startDrain();
          }, this.retryIntervalMs);
        }
        return; // Keep the failed head in place; newer reports must wait behind it.
      }
      this.queue.shift();
      entry.resolve();
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
        enforceRequestTimeout: true,
        retry: { retries: 0 }, // The queue owns retries and their interval.
      });
      this.producer = kafka.producer({ allowAutoTopicCreation: false });
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
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    await this.draining;
    if (this.queue.length) {
      this.logger.warn({
        event: 'kafka_queue_shutdown',
        queuedReports: this.queue.length,
      });
      const error = new TransformerException(
        TransformerErrorCode.PublicationFailed,
        'Transformer shut down before Kafka confirmed publication; the in-memory queue is not persisted.',
      );
      for (const entry of this.queue) entry.reject(error);
      this.queue.length = 0;
    }
    await this.producer?.disconnect();
    await this.mirror?.close();
  }
}
