import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

const databaseUrl = process.env.NUXT_DATABASE_URL || process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('NUXT_DATABASE_URL (or legacy DATABASE_URL) is required.')
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/database/schema/index.ts',
  out: './drizzle/migrations',
  dbCredentials: {
    url: databaseUrl,
  },
  strict: true,
  verbose: true,
})
