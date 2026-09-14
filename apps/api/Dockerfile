# syntax=docker/dockerfile:1

FROM node:24-alpine AS pruner
# damit wir nicht in das root linux dateisystem schreiben
WORKDIR /app
RUN npm i -g turbo@2.8.11
# alle Dateien reinkopieren, von repo root nach /app
COPY . .
RUN turbo prune api --docker

FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=pruner /app/out/json .
RUN corepack enable && pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full .
RUN pnpm exec turbo run build --filter=api
RUN pnpm --filter=api --prod --legacy deploy /app/api-out

FROM node:24-alpine AS runner
WORKDIR /app
COPY --from=builder /app/api-out /app

USER node
EXPOSE 10002
# `--import` laedt das Env-Profil, bevor fastify-cli seine Argumente parst —
# nur so sieht die CLI `FASTIFY_CLOSE_GRACE_DELAY` aus dem Profil (ADR-045).
CMD ["node", "--import", "@repo/env/preload", "node_modules/fastify-cli/cli.js", "start", "-o", "-p", "10002", "dist/app.js"]
