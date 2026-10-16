FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM golang:1.24-alpine AS agent-builder
WORKDIR /src/agent
COPY agent/go.mod ./
RUN go mod download
COPY agent ./
RUN mkdir -p /out \
  && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -o /out/oc-agent-linux-amd64 ./cmd/oc-agent \
  && CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -o /out/oc-agent-linux-arm64 ./cmd/oc-agent \
  && agent_version="$(tr -d '\r\n' <internal/version/VERSION)" \
  && amd64_sha="$(sha256sum /out/oc-agent-linux-amd64 | cut -d' ' -f1)" \
  && arm64_sha="$(sha256sum /out/oc-agent-linux-arm64 | cut -d' ' -f1)" \
  && amd64_size="$(wc -c </out/oc-agent-linux-amd64 | tr -d ' ')" \
  && arm64_size="$(wc -c </out/oc-agent-linux-arm64 | tr -d ' ')" \
  && printf '{"version":"%s","artifacts":{"amd64":{"filename":"oc-agent-linux-amd64","sha256":"%s","size":%s},"arm64":{"filename":"oc-agent-linux-arm64","sha256":"%s","size":%s}}}\n' \
    "$agent_version" "$amd64_sha" "$amd64_size" "$arm64_sha" "$arm64_size" \
    >/out/oc-agent-manifest.json

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

FROM dependencies AS admin
WORKDIR /app
ENV NODE_ENV=production
COPY tsconfig.json ./
COPY server/database/create-admin.ts ./server/database/create-admin.ts
COPY server/database/schema ./server/database/schema
CMD ["sh", "-c", "if [ -n \"$ADMIN_EMAIL\" ] && [ -n \"$ADMIN_PASSWORD\" ]; then exec npx tsx server/database/create-admin.ts; else echo 'Admin bootstrap skipped.'; fi"]

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
COPY --from=agent-builder --chown=nuxt:nodejs /out ./dist
USER nuxt
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/ready').then((response)=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", ".output/server/index.mjs"]
