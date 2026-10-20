import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config/app-config.js';

afterEach(() => vi.unstubAllEnvs());

describe('Transformer environment configuration', () => {
  it('allows an empty broker address without requiring a Kafka connection at startup', () => {
    expect(loadConfig({ KAFKA_BROKERS: '' }).KAFKA_BROKERS).toBe('');
    expect(loadConfig({}).KAFKA_RETRY_INTERVAL_MS).toBe(60000);
  });

  it.each(['0', '-1', '1.5', 'invalid', '', '2147483648'])(
    'rejects an invalid retry interval from the environment (%s)',
    (interval) => {
      expect(() => loadConfig({ KAFKA_RETRY_INTERVAL_MS: interval })).toThrow();
    },
  );

  it('retains Transformer settings when validating a .env file through Nest', async () => {
    const values = {
      KAFKA_BROKERS: 'broker-a:9092,broker-b:9092',
      KAFKA_CLIENT_ID: 'blitz-config-test',
      KAFKA_RETRY_INTERVAL_MS: '2500',
      KAFKA_SSL: 'true',
      KAFKA_SASL_MECHANISM: 'plain',
      KAFKA_SASL_USERNAME: 'test-user',
      KAFKA_SASL_PASSWORD: 'test-password',
      DE_RAW_REPORT_SCHEMA_PATH: 'contracts/raw-report.json',
    };
    for (const key of Object.keys(values)) vi.stubEnv(key, undefined);
    const directory = mkdtempSync(join(tmpdir(), 'blitz-transformer-config-'));
    const envFile = join(directory, '.env');
    writeFileSync(
      envFile,
      Object.entries(values)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n'),
    );
    try {
      const module = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            envFilePath: envFile,
            ignoreEnvVars: true,
            validate: (env) => loadConfig(env),
          }),
        ],
      }).compile();
      try {
        const config = module.get(ConfigService);
        for (const [key, value] of Object.entries(values))
          expect(config.get(key)).toBe(
            key === 'KAFKA_RETRY_INTERVAL_MS' ? Number(value) : value,
          );
      } finally {
        await module.close();
      }
    } finally {
      unlinkSync(envFile);
      rmdirSync(directory);
    }
  });
});
