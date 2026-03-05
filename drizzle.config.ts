import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // Be explicit about what Drizzle manages vs custom SQL:
  // - Table DDL: Drizzle (this config)
  // - pgvector columns, triggers, functions, views: custom SQL in databaseService.ts
  verbose: true,
  strict: true,
});
