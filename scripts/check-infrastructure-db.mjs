import pg from 'pg'

const databaseUrl = process.env.NUXT_DATABASE_URL || process.env.DATABASE_URL

if (!databaseUrl) {
  console.error('NUXT_DATABASE_URL (or DATABASE_URL) is required.')
  process.exit(1)
}

const client = new pg.Client({ connectionString: databaseUrl })

try {
  await client.connect()

  const { rows: relationRows } = await client.query(`
    select
      to_regclass('public.infrastructure_nodes') as infrastructure_nodes,
      to_regclass('public.infrastructure_resources') as infrastructure_resources,
      to_regclass('drizzle.__drizzle_migrations') as migration_history
  `)

  const relations = relationRows[0]
  console.log(JSON.stringify(relations, null, 2))

  if (relations.migration_history) {
    const { rows: migrationRows } = await client.query(`
      select count(*)::integer as count, max(created_at) as latest
      from drizzle.__drizzle_migrations
    `)
    console.log(JSON.stringify({ migrations: migrationRows[0] }, null, 2))
  }

  const { rows: tableRows } = await client.query(`
    select tablename
    from pg_catalog.pg_tables
    where schemaname = 'public'
    order by tablename
  `)
  console.log(JSON.stringify({ publicTables: tableRows.map((row) => row.tablename) }, null, 2))

  if (relations.infrastructure_nodes) {
    const { rows: nodeRows } = await client.query(`
      select
        name,
        environment,
        status,
        is_active as "isActive",
        agent_version as "agentVersion",
        last_heartbeat_at as "lastHeartbeatAt"
      from infrastructure_nodes
      order by created_at desc
    `)
    console.log(JSON.stringify({ nodes: nodeRows }, null, 2))

    const { rows: resourceRows } = await client.query(`
      select
        r.name,
        r.image_reference as "imageReference",
        r.desired_state as "desiredState",
        r.observed_state as "observedState",
        r.desired_revision as "desiredRevision",
        r.observed_revision as "observedRevision",
        n.name as "nodeName",
        r.last_observed_at as "lastObservedAt"
      from infrastructure_resources r
      join infrastructure_nodes n on n.id = r.node_id
      where r.deleted_at is null
      order by r.created_at desc
    `)
    console.log(JSON.stringify({ resources: resourceRows }, null, 2))

    const { rows: operationRows } = await client.query(`
      select
        action,
        status,
        error_code as "errorCode",
        error_message as "errorMessage",
        created_at as "createdAt"
      from infrastructure_operations
      order by created_at desc
      limit 10
    `)
    console.log(JSON.stringify({ recentOperations: operationRows }, null, 2))
  }
} catch (error) {
  console.error(`${error.name}: ${error.message}`)
  process.exitCode = 1
} finally {
  await client.end().catch(() => {})
}
