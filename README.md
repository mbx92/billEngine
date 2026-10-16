# OC Infrastructure Platform

Nuxt 4 billing and infrastructure control plane backed by OC Agent. The application owns customers,
services, invoices, releases, deployment templates, resources, operations, and audit history.

## Local development

Requirements: Node.js 22.22.2+ and Docker.

```bash
cp .env.example .env
# Fill NUXT_BETTER_AUTH_SECRET (for example: openssl rand -base64 32)
npm install
npm run dev:db
npm run db:migrate
npm run db:seed
ADMIN_EMAIL=admin@example.test ADMIN_PASSWORD='replace-with-a-long-password' npm run db:create-admin
npm run dev
```

The application runs at `http://localhost:3000`; PostgreSQL binds only to `127.0.0.1:5432`.

The development seed creates three customers, three plans, and three instances of the same
Customer Status Demo application: normal/running, invoice grace period, and suspended. It also
adds simulated application, release, resource, route, and deployment records so the complete
relationship can be inspected without an Ubuntu agent. The placeholder registry is deliberately
inactive and cannot be used for a real deployment. The demo application source lives in
[`examples/customer-demo-app`](examples/customer-demo-app).

Application runtime configuration uses `NUXT_*` variables, including in
production containers. `BETTER_AUTH_TRUSTED_ORIGINS` remains unprefixed because
it is consumed directly by Better Auth. Legacy unprefixed variables are only
accepted by `nuxt dev` to ease local migration and must not be used for a
production deployment.

## Commands

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run db:generate
npm run db:check
npm run db:migrate
npm run db:migrate:deploy
npm run db:backup
npm run test:e2e
```

## Application deployments

GitHub Actions publishes an immutable container image and registers it as an Application Release.
Alternatively, an OC Agent `0.11.0+` enrolled with the `builder` role can clone a public HTTPS
GitHub repository, build it through an isolated Docker Buildx worker, push it to the configured OCI
registry, and register the resulting digest without consuming GitHub Actions minutes.
The **Infrastructure → Templates** page deploys that release to an enrolled Ubuntu server. The
**Infrastructure → Deployments** page shows the resulting operation queue and execution history,
while **Resources** shows the desired and last-observed runtime state.

## Cloudflare Tunnel management

The **Infrastructure → Tunnels** page shows tunnel health and manages public-hostname ingress rules
for remotely managed Cloudflare Tunnels. See
[docs/CLOUDFLARE-TUNNELS.md](docs/CLOUDFLARE-TUNNELS.md) for token permissions and routing safety.

Do not use a production database for local development. Registry tokens, auth secrets, and database
credentials must remain in server-side environment variables.

OC Agent `0.8.0+` can receive verified remote upgrade and rollback operations from
**Infrastructure → Nodes**. Existing nodes need to rerun the installer once to bootstrap the
root-owned systemd updater; subsequent releases do not require SSH access. The updater retains the
previous compatible binary and restores it automatically when the new version does not report a
healthy heartbeat.

## Production deployment

Database migrations are a separate release step and must complete before the
new application container receives traffic. With the included multi-stage
Dockerfile, a deployment can use the same immutable source revision for both
steps:

```bash
docker build --target migrator -t billengine-migrator .
docker run --rm --env-file .env billengine-migrator

docker build --target runner -t billengine .
docker run --env-file .env -p 3000:3000 billengine
```

Configure the platform's liveness probe to use `/api/health` and its readiness
probe to use `/api/ready`. Readiness returns HTTP 503 until PostgreSQL is
reachable, all core relations exist, and the latest bundled Drizzle migration
has been applied.

For a multi-replica deployment, the hourly billing scheduler uses a PostgreSQL
advisory lock so only one instance performs a pass at a time. The recurring
invoice uniqueness constraint remains the final idempotency safeguard.

The GitHub Actions workflow runs migrations against an isolated PostgreSQL
service, then lint, type checking, unit/integration tests, and a production
build. Set production values through the deployment platform; never copy CI
credentials to a deployed environment.

## Email delivery

Invoice delivery and due/overdue reminders use the Resend HTTP API. Configure a
verified sender and API key at runtime:

```bash
NUXT_RESEND_API_KEY=re_xxx
NUXT_EMAIL_FROM='Billing Infra <billing@example.com>'
```

Admins can send an invoice from its detail page. The automation worker sends
new recurring invoices and daily idempotent reminders for invoices due within
three days or already overdue. Every attempt is stored in `email_deliveries`.

## Customer portal and access

Super admins can create admin or customer users under **Users & access**. A
customer user must be linked to one customer record and can only access
`/portal`, invoices belonging to that customer, and their PDF files. Changing a
user's access revokes all of that user's active sessions.

## Infrastructure and plan compliance

Plans can define structured infrastructure targets: resource count, aggregate
CPU cores, and aggregate RAM. These values are snapshotted onto a service when
the service is created or its plan is saved again. The Services page compares
that contract with the latest infrastructure resource limits and marks it as matched,
under-allocated, over-allocated, mixed, unknown, or not configured.

The **Apply plan to infrastructure** action previews the exact changes, divides
the aggregate CPU/RAM quota deterministically across linked applications, and
then queues update operations for OC Agent. Applying is blocked when
the linked resource count differs from the plan or an unsupported resource type
is present. Running applications are redeployed by the agent with the new limits; stopped applications use the
new limits on their next start.

Every apply uses a preview fingerprint to reject stale changes and writes both an audit entry and a
job result. Partial scheduling failures remain visible per resource. Changing production limits
always requires explicit admin confirmation.

## Monitoring and backups

`/api/metrics` exposes Prometheus text metrics for invoice/service status,
failed jobs, failed email deliveries, PostgreSQL pool state, node heartbeat age,
CPU/RAM/root-disk utilization, and stuck infrastructure operations. Protect it in
production with `NUXT_METRICS_TOKEN` and send `Authorization: Bearer <token>`
from the scraper.

Run a custom-format PostgreSQL backup locally with:

```bash
BACKUP_DIR=./backups BACKUP_RETENTION_COUNT=14 npm run db:backup
```

Or build the dedicated image and mount durable storage:

```bash
docker build --target backup -t billengine-backup .
docker run --rm --env-file .env -v /srv/billengine-backups:/backups billengine-backup
```

Schedule that container externally, copy the
backup off-host, and regularly test restoration with `pg_restore` against a
non-production database. Backup creation fails rather than deleting unrelated
files; retention only removes older `billengine-*.dump` files in `BACKUP_DIR`.

The command above protects the Billing metadata database. PostgreSQL databases
allocated to deployed workloads use **Infrastructure → Database Clusters** instead:
OC Agent 0.10.0+ creates a custom-format dump under
`/var/lib/oc-agent/backups/<allocation-id>/`, verifies it with `pg_restore --list`,
and records its SHA-256 and size in the control plane. Restore is an explicit,
audited operation and is never applied to the Billing metadata database.

Scheduled workload backups are configured from **Infrastructure → Backups**.
Policies upload directly from the node to an S3-compatible target (AWS S3,
Cloudflare R2, or MinIO), retain the configured number of successful artifacts,
and optionally deliver failure alerts through the configured Resend account.

Architecture and product decisions live in [`docs/`](./docs/).
