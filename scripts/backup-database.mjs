import { mkdir, readdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

const source = process.env.NUXT_DATABASE_URL || process.env.DATABASE_URL
if (!source) throw new Error('NUXT_DATABASE_URL is required for database backup.')

const databaseUrl = new URL(source)
if (databaseUrl.protocol !== 'postgresql:' && databaseUrl.protocol !== 'postgres:') {
  throw new Error('Only PostgreSQL database URLs are supported.')
}

const backupDirectory = resolve(process.env.BACKUP_DIR || './backups')
const retention = Number.parseInt(process.env.BACKUP_RETENTION_COUNT || '14', 10)
if (!Number.isInteger(retention) || retention < 1 || retention > 365) {
  throw new Error('BACKUP_RETENTION_COUNT must be between 1 and 365.')
}

await mkdir(backupDirectory, { recursive: true })
const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
const filename = `billengine-${timestamp}.dump`
const destination = resolve(backupDirectory, filename)

await runPgDump(databaseUrl, destination)
await pruneOldBackups(backupDirectory, retention)
console.log(`Database backup created: ${destination}`)

function runPgDump(url, outputFile) {
  const databaseName = decodeURIComponent(url.pathname.slice(1))
  if (!databaseName) throw new Error('Database name is missing from NUXT_DATABASE_URL.')

  const args = [
    '--format=custom',
    '--no-owner',
    '--no-privileges',
    '--host',
    url.hostname,
    '--port',
    url.port || '5432',
    '--username',
    decodeURIComponent(url.username),
    '--file',
    outputFile,
    databaseName,
  ]
  const environment = {
    ...process.env,
    PGPASSWORD: decodeURIComponent(url.password),
  }

  return new Promise((resolveRun, rejectRun) => {
    const child = spawn('pg_dump', args, {
      env: environment,
      stdio: ['ignore', 'inherit', 'inherit'],
    })
    child.once('error', rejectRun)
    child.once('exit', (code) => {
      if (code === 0) resolveRun()
      else rejectRun(new Error(`pg_dump exited with code ${code ?? 'unknown'}.`))
    })
  })
}

async function pruneOldBackups(directory, keep) {
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^billengine-.*\.dump$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse()

  for (const filenameToDelete of entries.slice(keep)) {
    await rm(resolve(directory, filenameToDelete))
  }
}
