import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import { parsePostgresRuntimeUrl, postgresRuntimeOptions } from '../../_shared/postgres-target.js';
import * as schema from './schema.js';

export type AppDatabase = PostgresJsDatabase<typeof schema>;

export interface DatabaseConnection {
  db: AppDatabase;
  client: Sql;
}

export interface DatabaseConnectionOptions {
  idle_timeout?: number;
  strictTarget?: boolean;
}

/**
 * Creates a small postgres.js pool suitable for one serverless function
 * instance. Prepared statements are disabled for compatibility with common
 * transaction poolers; DATABASE_URL itself remains responsible for SSL and
 * provider-specific connection settings, so local PostgreSQL works unchanged.
 */
export function createDatabaseConnection(
  databaseUrl: string,
  options: DatabaseConnectionOptions = {}
): DatabaseConnection {
  const { strictTarget = false, ...poolOptions } = options;
  const targetOptions = strictTarget
    ? postgresRuntimeOptions(parsePostgresRuntimeUrl(databaseUrl))
    : {};
  const client = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
    ...poolOptions,
    ...targetOptions,
  });

  return {
    db: drizzle(client, { schema }),
    client,
  };
}

/**
 * Migration leases use session advisory locks, so their pool must not reap an
 * idle session while the migration is working between writes.
 */
export function createMigrationDatabaseConnection(databaseUrl: string): DatabaseConnection {
  return createDatabaseConnection(databaseUrl, { idle_timeout: 0 });
}

let cachedConnection: DatabaseConnection | undefined;
let cachedMigrationConnection: DatabaseConnection | undefined;

function postgresIdentity(value: string): string {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error('DATABASE_URL inválida.'); }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') throw new Error('DATABASE_URL deve usar PostgreSQL.');
  return [parsed.hostname.toLowerCase(), parsed.port || '5432', decodeURIComponent(parsed.pathname.replace(/^\//, ''))].join('|');
}

function assertPreviewIsolation(): void {
  if (String(process.env.APP_ENV || '').trim().toLowerCase() !== 'preview') return;
  if (String(process.env.EXTERNAL_WRITES_ENABLED || '').trim() !== '0') {
    throw new Error('Preview exige EXTERNAL_WRITES_ENABLED=0.');
  }
  const production = String(process.env.PRODUCTION_DATABASE_URL || '').trim();
  if (!production) throw new Error('Preview exige PRODUCTION_DATABASE_URL para provar isolamento.');
  if (postgresIdentity(process.env.DATABASE_URL || '') === postgresIdentity(production)) {
    throw new Error('Preview não pode usar o banco de produção.');
  }
}

function getDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL não configurada.');
  }
  assertPreviewIsolation();
  return databaseUrl;
}

/**
 * Module-level caching lets warm Vercel invocations reuse one conservative
 * connection pool instead of opening a new pool per request.
 */
export function getDatabase(options: { strictTarget?: boolean } = {}): AppDatabase {
  const databaseUrl = getDatabaseUrl();
  if (options.strictTarget) parsePostgresRuntimeUrl(databaseUrl);
  if (!cachedConnection) {
    cachedConnection = createDatabaseConnection(databaseUrl, options);
  }
  return cachedConnection.db;
}

/** Database dedicated to migration repositories and their session leases. */
export function getMigrationDatabase(): AppDatabase {
  if (!cachedMigrationConnection) {
    cachedMigrationConnection = createMigrationDatabaseConnection(getDatabaseUrl());
  }
  return cachedMigrationConnection.db;
}

/** Close the cached pools for one-shot workers and migration CLIs. */
export async function closeDatabase(): Promise<void> {
  const connections = [cachedConnection, cachedMigrationConnection].filter(
    (connection): connection is DatabaseConnection => connection !== undefined
  );
  cachedConnection = undefined;
  cachedMigrationConnection = undefined;
  await Promise.all(connections.map((connection) => connection.client.end({ timeout: 5 })));
}
