import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, logLevel, type Producer, type SASLOptions } from 'kafkajs';
import { REPORT_TOPIC } from '../../common/constants.js';
import { State, TransformerErrorCode } from '../../common/enums.js';
import { TransformerException } from '../../common/exceptions.js';
import type { RawReport } from '../../contracts/schema.js';
import type { TransformContext } from '../transformer.types.js';

@Injectable()
export class PublishingProcessor implements OnModuleDestroy {
  readonly stage = State.Publishing;
  private producer?: Producer;
  private connection?: Promise<void>;
  private closing = false;
  private readonly pending = new Set<Promise<void>>();

  constructor(private readonly config: ConfigService) {}

  async execute(context: TransformContext): Promise<void> {
    if (!context.reports)
      throw new Error('Validation must produce reports before publishing.');
    context.publishedReports = [];
    for (const report of context.reports) {
      await this.publish(report);
      context.publishedReports.push(report);
    }
  }

  private publish(report: RawReport): Promise<void> {
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

  private async send(report: RawReport): Promise<void> {
    try {
      const producer = await this.connect();
      await producer.send({
        topic: REPORT_TOPIC,
        acks: -1,
        messages: [
          { key: String(report.report_id), value: JSON.stringify(report) },
        ],
      });
    } catch (error) {
      if (error instanceof TransformerException) throw error;
      throw new TransformerException(
        TransformerErrorCode.PublicationFailed,
        'Kafka publication was not confirmed; some reports may already have been delivered.',
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
