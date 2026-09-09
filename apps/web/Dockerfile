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

FROM nginxinc/nginx-unprivileged:alpine AS runner
# default aus base image löschen
USER root
RUN rm -f /docker-entrypoint.d/10-listen-on-ipv6-by-default.sh
USER nginx
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 10001
