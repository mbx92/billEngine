# Coolify Billing Platform

Nuxt 4 billing engine and access gateway for applications managed in Coolify. Coolify owns deployment and infrastructure operations; BillEngine owns customers, service subscriptions, invoices, payments, access decisions, and audit history.

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

## Operating workflow

1. Create and deploy applications in Coolify. Configure environment variables,
   domains, databases, resource limits, and proxy routing there.
2. Connect Coolify under **Servers**, then synchronize **Resources**. This reads
   provider state; it does not deploy or change running applications. Prefer a
   Coolify API token with read-only access for synchronization. Saving gateway
   labels also needs write access and permission to read existing labels.
   The per-server proxy editor needs read:sensitive, write, and deploy with a
   team admin/owner token. Scope the token to the intended Coolify team.
3. Mark chargeable resources as **billable**. Create a customer and plan, then
   link the synced resources to a service. A service can be created before its
   resources exist and linked after deployment and synchronization.
4. Generate invoices and record payments in BillEngine. Configure recurring
   billing and reminders in Settings.
5. Save the gateway check URL in Settings and install `billing-gate.yaml` manually
   in Coolify. On supported Traefik applications, use **Resources → Konfigurasi
   gate → Simpan ke Coolify** to attach the middleware reference. Redeploy in
   Coolify, then select **Periksa gate** and enable **Billing access gateway**.
   For Compose or a shared server-wide gate, use **Servers → node → Gate proxy**
   instead: configure a direct internal check URL, save the entrypoint settings,
   and restart the proxy manually in Coolify. No application Compose edits are
   needed. All applications on selected entrypoints depend on BillEngine availability.
   See [the gateway setup](docs/BILLING-GATE.md).

Suspend/cancel updates billing and gateway access only. Reactivation resumes
billing and reevaluates unpaid invoices. Deployment, start/stop/restart,
CPU/RAM changes, domain/SSL configuration, database provisioning, and tunnel
operations are performed outside BillEngine through Coolify and the relevant
infrastructure provider. The billing application's own deployment also stays
in Coolify.

The former provisioning, blueprint, database-cluster, tunnel, domain-management,
and apply-plan API routes and pages have been removed. The provisioning worker
no longer starts, so queued legacy jobs will not execute or retry. Existing
schema and migration history are retained; no database reset is needed. Review
unfinished legacy jobs and any previously stopped applications in Coolify when
rolling out this revision. Old operational documentation is marked historical.

Do not use a production database for local development. Coolify tokens, auth
secrets, and database credentials must remain in server-side environment variables.

## Production deployment

Use **Servers → Hapus server** to remove a Coolify connection, its stored token,
and synced inventory from BillEngine. Confirm the target connection in the dialog.
Deletion is refused while resources are linked to billing services or other
dependent records. Coolify infrastructure and proxy configuration are unchanged.
Coolify URLs and API tokens are managed only through **Servers** and stored in
the database. Connections are never recreated from environment variables.

If sync returns **Token koneksi Coolify ditolak (HTTP 401)**, use **Servers →
Perbarui token** on that exact connection. Generate the replacement in the
corresponding Coolify instance and paste only the token, without `Bearer`.
BillEngine checks application/server read access before encrypting and saving it;
an invalid replacement does not overwrite the previous credential. Existing
resource IDs and billing assignments are preserved. Then run **Sync**.
Existing connections that previously used an environment token need **Perbarui
token** once to save their token in the database, preserving their resource IDs
and billing assignments. Keep the existing credential encryption key (or auth
secret used as its fallback). The upstream 401 is surfaced as a
BillEngine HTTP 502 external-service error, not as an expired BillEngine login.

Deployments using `compose.production.yaml` can keep that file and their existing
database volume. It no longer requires or passes Coolify API URL/token variables.
Remove `COOLIFY_API_URL`, `COOLIFY_API_TOKEN`, `NUXT_COOLIFY_API_URL`, and
`NUXT_COOLIFY_API_TOKEN` from Coolify's deployment environment, including build-time
variables. Keep `COOLIFY_CREDENTIALS_KEY` and the other auth/gate secrets unchanged.
The connection-test API (`POST /api/coolify/test-connection`) now requires a JSON
body with the stored connection's `serverId`.

For this Coolify branch, use **Docker Compose** with `/compose.coolify.yaml`.
Copy the contents of the local, Git-ignored `.env.coolify` into Coolify's runtime
Environment Variables. `.env.coolify.example` is the shareable template and has
no credentials. These variables are not build arguments. Set the domain of the
`app` service to the same HTTPS domain used by `NUXT_PUBLIC_APP_URL` and
`NUXT_BETTER_AUTH_URL`; its container port is **3000**.

The Compose deployment uses the existing `bill_engine_coolify` database via
`NUXT_DATABASE_URL`. It does not create PostgreSQL, seed data, or reset users.
The server must be able to reach that database. The one-shot `migrate` service
runs before `app`; existing data and login accounts are retained. Keep the old
auth/encryption and gate secrets when using that database. Coolify connections
and company/billing settings already stored in the database do not need to be
duplicated in environment variables. Saved Settings take precedence over env
defaults, including switches set to `false`.

`APP_PORT=8010` publishes container port 3000 on the Coolify host, allowing that
host's proxy to use `http://host.docker.internal:8010/api/billing-gate/check`.
Keep that address consistent with the saved Gate proxy setting and the manual
`billing-gate.yaml`. This address applies only when BillEngine and the proxy
run on the same host. Application tunnels must route through Traefik. Follow
[the gate setup](docs/BILLING-GATE.md) and verify after deployment. No Cloudflare
provisioning or infrastructure credentials are needed in this billing-only env.

Validate the deployment configuration locally without starting containers:

```bash
docker compose --env-file .env.coolify -f compose.coolify.yaml config --quiet
```

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

## Recurring and manual invoices

Saved Settings take precedence over environment defaults, including explicit
`false` for billing automation and the access gateway. Disabling automation
waits for an invoice transaction already in progress, then prevents subsequent
recurring invoices from the worker or the generation API.

Recurring checks both billing-run history and existing invoice items. Link manual
invoice items to the correct service and fill both service-period dates. A period
overlapping an existing issued invoice (including paid or cancelled dated invoices)
is skipped; the schedule advances without creating another invoice. This also
recognizes manual invoices recorded before this fix. An issued service-linked
invoice without complete dates pauses recurring for that service without advancing
its schedule. Unlinked custom items cannot identify a subscription and do not block
its recurring invoices. Other services and later uncovered periods bill normally.

Existing duplicate invoices are not automatically cancelled or deleted by this
change; review them through the normal invoice workflow.

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

Resource targets are commercial reference values only. Adjust actual limits
in Coolify, then synchronize to refresh compliance. Changing a plan or service
never changes CPU/RAM or restarts an application.

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
