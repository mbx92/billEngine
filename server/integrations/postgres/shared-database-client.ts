import { randomBytes } from 'node:crypto'
import pg from 'pg'

export interface SharedDatabaseConnection {
  host: string
  port: number
  database: string
  user: string
  password: string
  sslMode: 'disable' | 'prefer' | 'require'
}

export interface SharedDatabaseAllocation {
  databaseName: string
  roleName: string
  password: string
  connectionLimit: number
  resetPassword: boolean
}

const IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/
const FORBIDDEN_IMPORT = [
  /\b(?:create|drop|alter)\s+(?:database|role|user|tablespace)\b/i,
  /\balter\s+system\b/i,
  /\b(?:begin|start\s+transaction|commit|rollback|savepoint)\b/i,
  /\bcopy\b[\s\S]*\bprogram\b/i,
  /\b(?:drop|alter)\s+schema\s+(?:if\s+exists\s+)?billengine_internal\b/i,
  /\b(?:drop|alter)\s+table\s+(?:if\s+exists\s+)?billengine_internal\./i,
]

export function databaseIdentifiers(serviceNumber: string) {
  const suffix = serviceNumber.trim().toLowerCase().replaceAll('-', '_')
  const databaseName = `be_${suffix}`
  const roleName = `${databaseName}_app`
  assertIdentifier(databaseName)
  assertIdentifier(roleName)
  return { databaseName, roleName }
}

export function generateDatabasePassword() {
  return randomBytes(32).toString('base64url')
}

export function buildDatabaseUrl(
  connection: Pick<SharedDatabaseConnection, 'host' | 'port' | 'sslMode'>,
  allocation: Pick<SharedDatabaseAllocation, 'databaseName' | 'roleName' | 'password'>,
) {
  const auth = `${encodeURIComponent(allocation.roleName)}:${encodeURIComponent(allocation.password)}`
  const sslMode = connection.sslMode === 'disable' ? 'disable' : connection.sslMode
  return `postgresql://${auth}@${formatHost(connection.host)}:${connection.port}/${encodeURIComponent(allocation.databaseName)}?sslmode=${sslMode}`
}

export class SharedDatabaseClient {
  constructor(private readonly connection: SharedDatabaseConnection) {}

  async testConnection() {
    const inspection = await this.inspectConnection()
    return inspection.database
  }

  async inspectConnection() {
    const pool = this.pool(this.connection.database, this.connection.user, this.connection.password)
    try {
      const result = await pool.query<{
        current_database: string
        current_user: string
        database_count: number | string
      }>(`
        select
          current_database()::text as current_database,
          current_user::text as current_user,
          (
            select count(*)::int
            from pg_database
            where datallowconn = true and datistemplate = false
          ) as database_count
      `)
      const row = result.rows[0]
      return {
        database: row?.current_database ?? this.connection.database,
        user: row?.current_user ?? this.connection.user,
        databaseCount: Number(row?.database_count ?? 0),
      }
    } finally {
      await pool.end()
    }
  }

  async provision(allocation: SharedDatabaseAllocation) {
    assertIdentifier(allocation.databaseName)
    assertIdentifier(allocation.roleName)
    if (!/^[A-Za-z0-9_-]{43}$/.test(allocation.password)) {
      throw new Error('Generated database password has an invalid format.')
    }

    const admin = this.pool(
      this.connection.database,
      this.connection.user,
      this.connection.password,
    )
    try {
      const role = await admin.query<{
        rolsuper: boolean
        rolcreatedb: boolean
        rolcreaterole: boolean
        rolreplication: boolean
        is_member: boolean
      }>(
        `
          select
            target_role.rolsuper,
            target_role.rolcreatedb,
            target_role.rolcreaterole,
            target_role.rolreplication,
            exists (
              select 1
              from pg_auth_members membership
              where membership.roleid = target_role.oid
                and membership.member = (
                  select current_user_role.oid
                  from pg_roles current_user_role
                  where current_user_role.rolname = current_user
                )
            ) as is_member
          from pg_roles target_role
          where target_role.rolname = $1
        `,
        [allocation.roleName],
      )
      const existingRole = role.rows[0]
      if (
        existingRole &&
        (existingRole.rolsuper ||
          existingRole.rolcreatedb ||
          existingRole.rolcreaterole ||
          existingRole.rolreplication)
      ) {
        throw new Error('Existing application role has unsafe PostgreSQL privileges.')
      }
      const roleSql = existingRole
        ? `alter role ${quoteIdentifier(allocation.roleName)} with login connection limit ${allocation.connectionLimit}${allocation.resetPassword ? ` password ${quoteLiteral(allocation.password)}` : ''}`
        : `create role ${quoteIdentifier(allocation.roleName)} with login nosuperuser nocreatedb nocreaterole noreplication connection limit ${allocation.connectionLimit} password ${quoteLiteral(allocation.password)}`
      await admin.query(roleSql)
      // CREATE DATABASE ... OWNER requires the creator to be able to SET ROLE
      // to the target owner. Keeping this membership also lets the dedicated
      // provisioner reconcile ownership without granting access to customer apps.
      const serverVersion = Number(
        (await admin.query<{ server_version_num: string }>('show server_version_num')).rows[0]
          ?.server_version_num ?? 0,
      )
      if (serverVersion >= 160_000) {
        const canSetRole = await admin.query<{ can_set_role: boolean }>(
          `select pg_has_role(current_user, ${quoteLiteral(allocation.roleName)}, 'SET') as can_set_role`,
        )
        if (!canSetRole.rows[0]?.can_set_role) {
          await admin.query(
            `grant ${quoteIdentifier(allocation.roleName)} to current_user with set true, inherit false`,
          )
        }
      } else if (!existingRole?.is_member) {
        await admin.query(
          `grant ${quoteIdentifier(allocation.roleName)} to current_user with admin option`,
        )
      }

      const database = await admin.query('select 1 from pg_database where datname = $1', [
        allocation.databaseName,
      ])
      if (!database.rowCount) {
        await admin.query(
          `create database ${quoteIdentifier(allocation.databaseName)} owner ${quoteIdentifier(allocation.roleName)}`,
        )
      }
    } finally {
      await admin.end()
    }

    const application = this.pool(allocation.databaseName, allocation.roleName, allocation.password)
    try {
      await application.query(
        `revoke connect on database ${quoteIdentifier(allocation.databaseName)} from public`,
      )
      await application.query(
        `grant connect on database ${quoteIdentifier(allocation.databaseName)} to ${quoteIdentifier(allocation.roleName)}`,
      )
      await application.query('revoke all on schema public from public')
      await application.query('grant all on schema public to current_user')
      await application.query('alter default privileges revoke all on tables from public')
      await application.query('alter default privileges revoke all on sequences from public')
      await application.query('select 1')
    } finally {
      await application.end()
    }
  }

  async importSql(input: {
    databaseName: string
    roleName: string
    password: string
    jobId: string
    checksum: string
    sql: string
  }) {
    assertIdentifier(input.databaseName)
    assertIdentifier(input.roleName)
    assertSafeSqlImport(input.sql)
    const pool = this.pool(input.databaseName, input.roleName, input.password)
    const client = await pool.connect()
    try {
      await client.query('begin')
      await client.query('create schema if not exists billengine_internal')
      await client.query(`
        create table if not exists billengine_internal.sql_imports (
          job_id uuid primary key,
          checksum varchar(64) not null,
          imported_at timestamptz not null default now()
        )
      `)
      const existing = await client.query<{ checksum: string }>(
        'select checksum from billengine_internal.sql_imports where job_id = $1',
        [input.jobId],
      )
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== input.checksum) {
          throw new Error('SQL import checksum differs from the completed import.')
        }
        await client.query('rollback')
        return { imported: false }
      }

      await client.query(input.sql)
      await client.query(
        'insert into billengine_internal.sql_imports (job_id, checksum) values ($1, $2)',
        [input.jobId, input.checksum],
      )
      await client.query('commit')
      return { imported: true }
    } catch (error) {
      await client.query('rollback').catch(() => undefined)
      throw error
    } finally {
      client.release()
      await pool.end()
    }
  }

  private pool(database: string, user: string, password: string) {
    return new pg.Pool({
      host: this.connection.host,
      port: this.connection.port,
      database,
      user,
      password,
      max: 2,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 5_000,
      ssl: this.connection.sslMode === 'require' ? { rejectUnauthorized: false } : undefined,
    })
  }
}

export function assertSafeSqlImport(sql: string) {
  if (!sql.trim()) throw new Error('SQL import is empty.')
  if (/^\s*\\/m.test(sql)) throw new Error('Perintah meta psql tidak didukung oleh import SQL.')
  const normalized = stripSqlCommentsAndStrings(sql)
  if (FORBIDDEN_IMPORT.some((pattern) => pattern.test(normalized))) {
    throw new Error('SQL import berisi perintah administratif atau transaksi yang tidak diizinkan.')
  }
}

function assertIdentifier(value: string) {
  if (!IDENTIFIER_PATTERN.test(value)) throw new Error('Unsafe PostgreSQL identifier.')
}

function quoteIdentifier(value: string) {
  assertIdentifier(value)
  return `"${value}"`
}

function quoteLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

function formatHost(host: string) {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
}

function stripSqlCommentsAndStrings(value: string) {
  return value
    .replace(/--[^\n\r]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/"(?:""|[^"])*"/g, '""')
}
