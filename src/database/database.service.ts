import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import pg from 'pg';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { runMigrations } from './migrate.js';

// Return BIGINT (int8) columns, e.g. messages.id, as JS numbers instead of strings.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

@Injectable()
export class DatabaseService implements OnModuleInit, OnApplicationShutdown {
  private readonly pool: pg.Pool;
  private readonly logger = new Logger('Database');

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.pool = new pg.Pool({ connectionString: config.DATABASE_URL });
  }

  async onModuleInit(): Promise<void> {
    await runMigrations(this.pool, (name) => this.logger.log(`applied migration ${name}`));
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }

  query<R extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params?: unknown[]): Promise<pg.QueryResult<R>> {
    return this.pool.query<R>(sql, params);
  }
}
