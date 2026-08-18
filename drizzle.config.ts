import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './api/infrastructure/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    // TEST_DATABASE_URL lets the committed migration be verified without ever
    // pointing Drizzle's CLI at the application's runtime database.
    url: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || '',
  },
  verbose: true,
  strict: true,
});
