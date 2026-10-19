import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, logLevel, type Producer, type SASLOptions } from 'kafkajs';
import { REPORT_TOPIC } from '../../../common/constants.js';
import { State, TransformerErrorCode } from '../../../common/enums.js';
import { TransformerException } from '../../../common/exceptions.js';
import type { RawReport } from '../../../contracts/schema.js';
import { DeduplicationStore } from '../deduplication.store.js';
import type {
  PublicationResult,
  TransformContext,
} from '../transformer.types.js';

@Injectable()
export class PublishingProcessor implements OnModuleDestroy {
  readonly stage = State.Publishing;
  private producer?: Producer;
  private connection?: Promise<void>;
  private closing = false;
  private readonly pending = new Set<Promise<PublicationResult>>();

  constructor(
    private readonly config: ConfigService,
    private readonly deduplication: DeduplicationStore,
  ) {}

  async execute(context: TransformContext): Promise<void> {
    if (!context.report)
      throw new Error('Validation must produce a report before publishing.');
    context.publication = await this.publish(context.report);
  }

  private publish(report: RawReport): Promise<PublicationResult> {
    if (this.closing)
      return Promise.reject(
        new TransformerException(
          TransformerErrorCode.PublicationFailed,
          'Transformer is shutting down.',
        ),
      );
    const operation = this.send(report);
    this.pending.add(operation);
    void operation.then(
      () => this.pending.delete(operation),
      () => this.pending.delete(operation),
    );
    return operation;
  }

  private async send(report: RawReport): Promise<PublicationResult> {
    if (!(await this.deduplication.reserve(report))) return 'duplicate';
    try {
      const producer = await this.connect();
      await producer.send({
        topic: REPORT_TOPIC,
        acks: -1,
        messages: [{ key: report.report_id, value: JSON.stringify(report) }],
      });
      this.deduplication.markPublished(report);
      return 'published';
    } catch (error) {
      this.deduplication.release(report);
      if (error instanceof TransformerException) throw error;
      throw new TransformerException(
        TransformerErrorCode.PublicationFailed,
        'Kafka publication failed; the caller can retry this input.',
      );
    }
  }

  private async connect(): Promise<Producer> {
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
        retry: { retries: 3 },
      });
      this.producer = kafka.producer({ allowAutoTopicCreation: false });
    }
    if (!this.connection) {
      this.connection = this.producer.connect().catch((error: unknown) => {
        this.connection = undefined;
        throw error;
      });
    }
    await this.connection;
    return this.producer;
  }

  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    await Promise.allSettled(this.pending);
    await this.connection?.catch(() => undefined);
    await this.producer?.disconnect();
  }
}
