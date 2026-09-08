# syntax=docker/dockerfile:1

FROM node:24-alpine AS pruner
# damit wir nicht in das root linux dateisystem schreiben
WORKDIR /app
# turbo installieren
RUN npm i -g turbo@2.8.11
# alle Dateien reinkopieren, von repo root nach /app
COPY . .
# nur worker isolieren
RUN turbo prune worker --docker

FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=pruner /app/out/json .
RUN corepack enable && pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full .
RUN pnpm exec turbo run build --filter=worker
RUN pnpm --filter=worker --prod --legacy deploy /app/worker-out

FROM node:24-alpine AS runner
WORKDIR /app
COPY --from=builder /app/worker-out /app
ENV NODE_ENV=production

USER node
EXPOSE 10003
CMD ["node", "node_modules/fastify-cli/cli.js", "start", "-l", "info", "-p", "10003", "dist/app.js"]
