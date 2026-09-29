import { createHmac, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const env = Object.fromEntries(
  readFileSync(new URL('./.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=')
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()]
    }),
)

const pool = new pg.Pool({ connectionString: env.DATABASE_URL })
const token = randomUUID()

await pool.query(
  `insert into sessions (id, expires_at, token, user_id) values ($1, now() + interval '1 hour', $2, $3)`,
  [randomUUID(), token, '9d6568e1-c196-4447-8e35-745a1ea8e997'],
)
const signature = createHmac('sha256', env.BETTER_AUTH_SECRET).update(token).digest('base64')
process.stdout.write(encodeURIComponent(`${token}.${signature}`))
await pool.end()
