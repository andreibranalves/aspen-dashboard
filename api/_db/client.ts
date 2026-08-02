import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import * as schema from './schema.js';

export type AppDatabase = PostgresJsDatabase<typeof schema>;

export interface DatabaseConnection {
  db: AppDatabase;
  client: Sql;
}

/**
 * Creates a small postgres.js pool suitable for one serverless function
 * instance. Prepared statements are disabled for compatibility with common
 * transaction poolers; DATABASE_URL itself remains responsible for SSL and
 * provider-specific connection settings, so local PostgreSQL works unchanged.
 */
export function createDatabaseConnection(databaseUrl: string): DatabaseConnection {
  const client = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
  });

  return {
    db: drizzle(client, { schema }),
    client,
  };
}

let cachedConnection: DatabaseConnection | undefined;

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
