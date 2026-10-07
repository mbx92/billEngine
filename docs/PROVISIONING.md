# Deployment provisioning

BillEngine can create a Coolify application from a reusable deployment blueprint and process the
deployment outside the browser request. Open **Infrastructure → Blueprints** to manage deployment
recipes. Use **Infrastructure → Provisioning** only to queue an application, inspect its event log,
or retry a failed stage.

## Supported source

The first provisioning implementation supports public Git repositories with these Coolify build
packs:

- Nixpacks;
- Railpack;
- Static;
- Dockerfile;
- Docker Compose from Git.

Private GitHub App/deploy-key sources and raw Compose services are intentionally not included yet.

## Blueprint fields

A blueprint stores the repository and branch, Coolify connection, project UUID, target server UUID,
environment name, build pack, ports, healthcheck, resource layout, expected environment keys, and
optional custom labels. CPU and memory limits are taken from the selected BillEngine service plan at
provisioning time.

The Blueprint editor separates identity, source/build, Coolify target, runtime/environment, and
routing settings. Environment requirements are edited as key-only rows; secret values are supplied
per provisioning job and are never stored in the blueprint. Dockerfile and Docker Compose contents
remain in the configured Git repository and branch. The editor selects their path and, for Compose,
the target service so build files retain version history and code review.

Blueprints may be edited only while no runnable provisioning job is using them. An unused blueprint
can be deleted. Once a blueprint has job history it must be deactivated instead of deleted so old job
records remain auditable.

For a plan with database mode `shared`, the blueprint must select an active PostgreSQL cluster and
an environment key (default `DATABASE_URL`). BillEngine owns that key; operators cannot override it
through manual environment values.

When **billing gate** is enabled (the default for new blueprints), BillEngine injects Traefik
middleware at provision time. Standard build packs receive
`coolify.traefik.middlewares=billing-gate@file` through Coolify custom labels. Docker Compose apps
get the same reserved label written onto the public service in stored compose. Coolify reloads
compose from Git on each deploy, so keep that one label in the repository compose file as well. Do
not define `traefik.http.middlewares.*` billing chains in Compose; Coolify expands those onto the
router and returns HTTP 500. Configure `NUXT_BILLING_GATE_SHARED_KEY` and
`NUXT_BILLING_GATE_INTERNAL_URL` on BillEngine; the latter must be reachable from the Coolify proxy.

## Job lifecycle

```text
queued
→ provisioning_database (shared mode only)
→ importing_database (when a SQL file is supplied)
→ creating_application
→ configuring_environment
→ configuring_domain
→ deploying
→ verifying_health
→ verifying_ssl
→ active
```

Each transition is persisted. A background Nitro worker processes one runnable job under a PostgreSQL
advisory lock, so multiple BillEngine replicas do not execute the same queue concurrently. Transient
failures use bounded exponential retry. After five failed attempts the job becomes `failed` and can be
continued from the failed stage with **Retry**.

Application creation uses a unique `billengine-job-<job-id>` Coolify tag. If BillEngine loses the API
response after Coolify creates the application, the next attempt recovers the application by tag
instead of creating another one. Environment updates use Coolify's bulk upsert endpoint.

## Secrets

Environment values are encrypted with `NUXT_COOLIFY_CREDENTIALS_KEY`, falling back to
`NUXT_BETTER_AUTH_SECRET`, while a job is running. They are never returned by the BillEngine API and
the encrypted payload is removed after the job reaches `active`.

PostgreSQL provisioner and application passwords use `NUXT_INFRA_CREDENTIALS_KEY`, falling back to
the Coolify credential key and then the Better Auth secret during migration. Cluster list APIs only
return `hasCredential`; they never return a password or application DSN.

## Shared PostgreSQL and SQL import

Register the shared PostgreSQL resource in **Infrastructure → Database Clusters**. Creating a
cluster performs a live connection test before saving it. Each shared service receives deterministic
database and role names based on its immutable service number, plus an independent random password.
Retry checks the existing role/database and reuses the same BillEngine allocation.

The provisioning dialog accepts an optional `.sql` file up to 10 MB for shared database services.
The import:

- runs as the service application role, never the provisioner role;
- executes inside one transaction before the application is created;
- records a checksum marker inside `billengine_internal.sql_imports`, so a retry does not run a
  completed import twice;
- rejects psql meta commands, transaction-control statements, and cluster-level role/database,
  tablespace, `ALTER SYSTEM`, or `COPY ... PROGRAM` operations.

SQL dumps intended for import should contain application schema/data statements only. Do not include
`CREATE DATABASE`, `CREATE ROLE`, `BEGIN`, `COMMIT`, ownership for external roles, or psql `\\` commands.

## One-time prerequisites

- The Coolify connection must have a token that can create, update, and deploy applications.
- The target Coolify project, environment, server, and destination must already exist.
- Platform wildcard routing and Cloudflare for SaaS must be configured as described in
  [BILLING-GATE.md](./BILLING-GATE.md).
- Run database migrations before starting the new application release.
- Put BillEngine and the shared PostgreSQL resource on a reachable private network. The PostgreSQL
  host stored in the cluster must also be resolvable by provisioned customer applications because it
  is embedded in their managed `DATABASE_URL`.

API contracts used by the worker:

- [Create a public Coolify application](https://coolify.io/docs/api/endpoints/applications/create-public-application)
- [Bulk update application environments](https://coolify.io/docs/api/endpoints/applications/update-envs-by-application-uuid)
- [Deploy by application UUID](https://coolify.io/docs/api/endpoints/deployments/deploy-by-tag-or-uuid)
- [Get deployment status](https://coolify.io/docs/api/endpoints/deployments/get-deployment-by-uuid)
