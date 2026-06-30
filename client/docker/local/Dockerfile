FROM docker.io/node:20.20-alpine as base

# package-lock.json は npm 10.8.2 で生成されている (CI / host と同じ)。
# node イメージ同梱の npm (10.2.4 や 11.x) は transitive 依存の解決がズレ、
# npm ci が EUSAGE (lock 不一致) で失敗するため npm 世代を固定する。
RUN npm install -g npm@10.8.2

FROM base as node-build-stage

RUN apk add --no-cache libc6-compat

COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* .npmrc* ./

# production Dockerfile と同様、.npmrc の legacy-peer-deps 前提で生成された
# lock を再現するため --legacy-peer-deps を付ける。これが無いと peer 解決が
# ズレて npm ci が lock 不一致 (EUSAGE) で失敗する。
RUN \
  if [ -f yarn.lock ]; then yarn --frozen-lockfile; \
  elif [ -f package-lock.json ]; then npm ci --legacy-peer-deps; \
  elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm i; \
  else echo "Lockfile not found." && exit 1; \
  fi

FROM base as node-run-stage

ARG APP_HOME=/app
WORKDIR ${APP_HOME}

COPY --from=node-build-stage /node_modules ./node_modules

COPY . ${APP_HOME}

RUN addgroup -g 1001 -S nodejs && \
  adduser -S nextjs -u 1001 -G nodejs

RUN chown -R nextjs:nodejs ${APP_HOME}

USER nextjs

CMD [ "npm","run","dev" ]
