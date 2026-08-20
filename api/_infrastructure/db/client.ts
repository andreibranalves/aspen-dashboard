import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import * as schema from './schema.js';

export type AppDatabase = PostgresJsDatabase<typeof schema>;

export interface DatabaseConnection {
  db: AppDatabase;
  client: Sql;
}

export interface DatabaseConnectionOptions {
  idle_timeout?: number;
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
  const client = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
    ...options,
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

function getDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL não configurada.');
  }
  return databaseUrl;
}

/**
 * Module-level caching lets warm Vercel invocations reuse one conservative
 * connection pool instead of opening a new pool per request.
 */
export function getDatabase(): AppDatabase {
  if (!cachedConnection) {
    cachedConnection = createDatabaseConnection(getDatabaseUrl());
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
