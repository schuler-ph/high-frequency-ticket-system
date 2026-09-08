# syntax=docker/dockerfile:1

FROM node:24-alpine AS pruner
# damit wir nicht in das root linux dateisystem schreiben
WORKDIR /app
# turbo installieren
RUN npm i -g turbo@2.8.11
# alle Dateien reinkopieren, von repo root nach /app
COPY . .
# nur web isolieren
RUN turbo prune web --docker

FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=pruner /app/out/json .
RUN corepack enable && pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full .
RUN pnpm exec turbo run build --filter=web
RUN pnpm --filter=web --prod --legacy deploy /app/web-out

FROM nginxinc/nginx-unprivileged:alpine AS runner
COPY --from=builder /app/web-out /app

EXPOSE 10001
