# syntax=docker/dockerfile:1
# Build-Kontext: Repository-Wurzel (siehe docker-compose.yml)
FROM node:22-alpine AS build
RUN corepack enable && apk add --no-cache openssl
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --filter "@gameserver/server..."
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN pnpm --filter @gameserver/shared build \
 && pnpm --filter @gameserver/server exec prisma generate \
 && pnpm --filter @gameserver/server build \
 && pnpm --filter @gameserver/server deploy --prod --legacy /out \
 && cd /out && ./node_modules/.bin/prisma generate

FROM node:22-alpine
# pg_dump für Backups (Version passend zum Postgres-Container), tar, su-exec für Rechteabgabe
RUN apk add --no-cache openssl tar tini su-exec postgresql17-client
WORKDIR /app
COPY --from=build /out ./
COPY apps/server/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /data && chown node:node /data
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--", "docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
