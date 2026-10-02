# Coolify Billing Platform

Nuxt 4 billing control plane layered on top of Coolify. Coolify remains the infrastructure source of truth; this application owns customers, services, invoices, payments, and audit history.

## Local development

Requirements: Node.js 22.22.2+ and Docker.

```bash
cp .env.example .env
# Fill NUXT_BETTER_AUTH_SECRET (for example: openssl rand -base64 32)
npm install
npm run dev:db
npm run db:migrate
ADMIN_EMAIL=admin@example.test ADMIN_PASSWORD='replace-with-a-long-password' npm run db:create-admin
npm run dev
```

The application runs at `http://localhost:3000`; PostgreSQL binds only to `127.0.0.1:5432`.

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

## Application provisioning

The **Infrastructure → Provisioning** page creates Coolify applications from reusable deployment
blueprints and tracks create, environment, domain, deploy, health, and SSL stages in a retryable
background job. See [docs/PROVISIONING.md](docs/PROVISIONING.md) for prerequisites and supported
source types.

## Cloudflare Tunnel management

The **Infrastructure → Tunnels** page shows tunnel health and manages public-hostname ingress rules
for remotely managed Cloudflare Tunnels. See
[docs/CLOUDFLARE-TUNNELS.md](docs/CLOUDFLARE-TUNNELS.md) for token permissions and routing safety.

Do not use a production database for local development. Coolify tokens, auth secrets, and database credentials must remain in server-side environment variables.

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
that contract with the latest Coolify resource limits and marks it as matched,
under-allocated, over-allocated, mixed, unknown, or not configured.

The **Apply plan to infrastructure** action previews the exact changes, divides
the aggregate CPU/RAM quota deterministically across linked applications, and
then updates the applications through the Coolify API. Applying is blocked when
the linked resource count differs from the plan or an unsupported resource type
is present. Running applications can be restarted after the update so Coolify
recreates their containers with the new limits; stopped applications use the
new limits on their next start.

Every apply uses a preview fingerprint to reject stale changes, synchronizes
the affected Coolify server for verification, and writes both an audit entry
and a job result. Partial failures remain visible per resource. Automatic apply
during a normal sync is intentionally disabled: sync refreshes actual state,
while changing production limits always requires an explicit admin confirmation.
The current write path supports Coolify applications; database and compose
service resource writes remain unsupported.

## Monitoring and backups

`/api/metrics` exposes Prometheus text metrics for invoice/service status,
failed jobs, failed email deliveries, and PostgreSQL pool state. Protect it in
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

Schedule that container externally (for example, daily in Coolify), copy the
backup off-host, and regularly test restoration with `pg_restore` against a
non-production database. Backup creation fails rather than deleting unrelated
files; retention only removes older `billengine-*.dump` files in `BACKUP_DIR`.

Architecture and product decisions live in [`docs/`](./docs/).

## Overdue access gate

An opt-in Traefik ForwardAuth gate can show an overdue interstitial while a
customer application remains online. Setup, rollout safeguards, and local test
commands are documented in [`docs/BILLING-GATE.md`](./docs/BILLING-GATE.md).
