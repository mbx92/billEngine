# Coolify Billing Platform

Nuxt 4 billing control plane layered on top of Coolify. Coolify remains the infrastructure source of truth; this application owns customers, services, invoices, payments, and audit history.

## Local development

Requirements: Node.js 22.22.2+ and Docker.

```bash
cp .env.example .env
# Fill BETTER_AUTH_SECRET (for example: openssl rand -base64 32)
npm install
npm run dev:db
npm run db:migrate
ADMIN_EMAIL=admin@example.test ADMIN_PASSWORD='replace-with-a-long-password' npm run db:create-admin
npm run dev
```

The application runs at `http://localhost:3000`; PostgreSQL binds only to `127.0.0.1:5432`.

## Commands

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run db:generate
npm run db:migrate
npm run test:e2e
```

Do not use a production database for local development. Coolify tokens, auth secrets, and database credentials must remain in server-side environment variables.

Architecture and product decisions live in [`docs/`](./docs/).
