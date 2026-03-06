# ╔══════════════════════════════════════════════════════════════════════╗
# ║  delivery-api — Dockerfile multi-stage (AdonisJS v6, inspiré wave)  ║
# ╚══════════════════════════════════════════════════════════════════════╝

# ── Stage 1 : Dépendances de production ───────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN pnpm install --prod --frozen-lockfile

# ── Stage 2 : Builder (dépendances dev + build) ───────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/pnpm-lock.yaml ./pnpm-lock.yaml
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN pnpm install --frozen-lockfile
COPY . .
RUN node ace build --ignore-ts-errors

# ── Stage 3 : Image de production ────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copier le build AdonisJS (le dossier build/ est l'artefact final)
COPY --from=builder /app/build .
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml

RUN corepack enable && corepack prepare pnpm@latest --activate
RUN pnpm install --prod --frozen-lockfile

# Entrypoint (migrations auto + vérification des vars d'env)
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

RUN chown -R appuser:appgroup /app

ENV PORT=4001
ENV HOST=0.0.0.0
ENV NODE_ENV=production

HEALTHCHECK --interval=20s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --quiet --spider http://0.0.0.0:${PORT:-4001}/health || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "bin/server.js"]
