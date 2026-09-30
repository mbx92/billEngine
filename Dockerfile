FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM dependencies AS migrator
WORKDIR /app
ENV NODE_ENV=production
COPY drizzle.config.ts tsconfig.json ./
COPY drizzle ./drizzle
COPY server/database/schema ./server/database/schema
COPY scripts/seed-billing-gate-test.mjs ./scripts/seed-billing-gate-test.mjs
CMD ["npm", "run", "db:migrate:deploy"]

FROM node:22-alpine AS backup
WORKDIR /app
RUN apk add --no-cache postgresql-client
ENV NODE_ENV=production
ENV BACKUP_DIR=/backups
COPY scripts/backup-database.mjs ./scripts/backup-database.mjs
CMD ["node", "scripts/backup-database.mjs"]

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nuxt
COPY --from=builder --chown=nuxt:nodejs /app/.output ./.output
USER nuxt
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/ready').then((response)=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", ".output/server/index.mjs"]
