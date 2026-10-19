import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type pg from 'pg';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Applies the not-yet-applied `migrations/*.sql` files in name order, each in its own transaction. */
export async function runMigrations(pool: pg.Pool, onApplied: (name: string) => void): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const applied = new Set(
    (await pool.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
  );
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      onApplied(file);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
