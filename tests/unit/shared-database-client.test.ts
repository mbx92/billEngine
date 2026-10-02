import { describe, expect, it } from 'vitest'
import {
  assertSafeSqlImport,
  buildDatabaseUrl,
  databaseIdentifiers,
  generateDatabasePassword,
} from '../../server/integrations/postgres/shared-database-client'

describe('shared database provisioning helpers', () => {
  it('derives deterministic safe identifiers from the immutable service number', () => {
    expect(databaseIdentifiers('SVC-000123')).toEqual({
      databaseName: 'be_svc_000123',
      roleName: 'be_svc_000123_app',
    })
  })

  it('generates a 32-byte base64url password', () => {
    const password = generateDatabasePassword()
    expect(password).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(generateDatabasePassword()).not.toBe(password)
  })

  it('builds an encoded connection URL without losing the SSL mode', () => {
    expect(
      buildDatabaseUrl(
        { host: 'postgres.internal', port: 5432, sslMode: 'require' },
        {
          databaseName: 'be_svc_000123',
          roleName: 'be_svc_000123_app',
          password: 'a/b+c?d',
        },
      ),
    ).toBe(
      'postgresql://be_svc_000123_app:a%2Fb%2Bc%3Fd@postgres.internal:5432/be_svc_000123?sslmode=require',
    )
  })

  it('allows application DDL and rejects cluster or transaction control', () => {
    expect(() => assertSafeSqlImport('create table posts (id uuid primary key);')).not.toThrow()
    expect(() => assertSafeSqlImport('create database escaped;')).toThrow(/tidak diizinkan/)
    expect(() => assertSafeSqlImport('begin; create table posts (id int); commit;')).toThrow(
      /tidak diizinkan/,
    )
    expect(() => assertSafeSqlImport('\\i another-file.sql')).toThrow(/meta psql/)
  })

  it('ignores forbidden words inside comments and string literals', () => {
    expect(() =>
      assertSafeSqlImport("-- create database nope\ninsert into notes(value) values ('commit');"),
    ).not.toThrow()
  })
})
