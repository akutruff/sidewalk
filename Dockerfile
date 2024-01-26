FROM node:20-alpine AS base

# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine 
RUN <<EOF 
  apk add --no-cache libc6-compat bash 
  npm install -g pnpm
EOF

FROM base AS with-turbo
RUN npm install -g turbo

FROM with-turbo AS pruned-repo
WORKDIR /app

COPY . .
RUN turbo prune --scope=@acme/sidewalk --docker

FROM with-turbo as builder
WORKDIR /app

# First install dependencies (as they change less often)
COPY .gitignore .gitignore
COPY --from=pruned-repo /app/out/json/ .
COPY --from=pruned-repo /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile

# Build the project and its dependencies
COPY --from=pruned-repo /app/out/full/ .
COPY turbo.json turbo.json
RUN pnpm build

WORKDIR /app/packages/report
RUN <<EOF
  mkdir -p /sidewalk
  pnpm pack --pack-destination /sidewalk
  cd /sidewalk
  pnpm i ./*.tgz
EOF

FROM base as sidewalk
WORKDIR /sidewalk

COPY --from=builder /sidewalk .
ENV SERVICE_REQUEST_DEFINITIONS_PATH='/data/config/service-request-definitions.json' \
  DB_PATH="/db" \
  EVENTS_BASE_PATH="/data/events" \
  EVENT_STAGING_BASE_PATH="/data/events-staging"

CMD CI=true pnpm exec sidewalk webserver 
