# ---- api-build: compile the NestJS sync relay --------------------------------------
FROM node:24-alpine AS api-build
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY server/ ./
RUN npm run build && npm prune --omit=dev

# ---- api: the optional sync relay (`docker compose` builds it with target: api) -------
# NestJS; it only stores and forwards end-to-end encrypted messages, for apps that know
# the server secret (API_KEY).
FROM node:24-alpine AS api
WORKDIR /app/server
COPY --from=api-build /app/server/package.json ./
COPY --from=api-build /app/server/node_modules ./node_modules
COPY --from=api-build /app/server/dist ./dist
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
USER node
EXPOSE 8787
VOLUME /data
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8787/api/sync/v2/healthz || exit 1
CMD ["node", "dist/main.js"]

# ---- build: install, test, type-check and bundle the PWA -----------------------------
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
# The app's tests sync phones through the real relay, so it needs the server's packages too.
COPY server/package.json server/package-lock.json ./server/
RUN --mount=type=cache,target=/root/.npm npm ci --prefix server --no-audit --no-fund

COPY . .
RUN npm test && npm run build

# ---- runtime: static files served by nginx as a non-root user ------------------------
FROM nginxinc/nginx-unprivileged:1.29-alpine

LABEL org.opencontainers.image.title="Baby Utils" \
      org.opencontainers.image.description="Private, on-device baby helper PWA" \
      org.opencontainers.image.source="https://github.com/MkKiefer/baby-utils" \
      org.opencontainers.image.licenses="MIT"

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /srv/baby-utils

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
