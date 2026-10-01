# syntax=docker/dockerfile:1
#
# Syntax Practice — one image serving the API and the built UI.
#
#   docker build -t syntax-practice .
#   docker run -p 4000:4000 -v sp-data:/data \
#     -e JWT_SECRET=$(openssl rand -hex 32) \
#     -e SEED_ADMIN_PASSWORD=... -e SEED_STUDENT_PASSWORD=... \
#     syntax-practice
#
# See docs/DEPLOYMENT.md.

# One base for every stage. better-sqlite3 is a native module compiled against
# a specific Node ABI in the deps stage, so the runtime stage must run the same
# Node major — change them together or the server fails to load it.
ARG NODE_IMAGE=node:22-bookworm-slim

# ------------------------------------------------------------------ build
# Everything, dev dependencies included, to compile the server and the client.
FROM ${NODE_IMAGE} AS build
WORKDIR /app

# Toolchain for any native module without a prebuilt binary (better-sqlite3).
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci

COPY . .
RUN npm run build

# ------------------------------------------------------------ server deps
# Only what the server needs at runtime. The client's dependencies — React,
# Monaco, Vite — are compiled into client/dist and are not needed again, and
# leaving out dev dependencies keeps the Vite and Vitest dev servers, and their
# advisories, out of the image entirely.
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci --omit=dev --workspace=server

# ---------------------------------------------------------------- runtime
FROM ${NODE_IMAGE} AS runtime

# Java, C and C++ questions need their compilers; without them those questions
# report a clear "toolchain unavailable" message and everything else works.
# Build with --build-arg TOOLCHAINS=false for a much smaller Python/SQL/JS image.
ARG TOOLCHAINS=true

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 \
 && if [ "$TOOLCHAINS" = "true" ]; then \
      apt-get install -y --no-install-recommends default-jdk-headless gcc g++ libc6-dev; \
    fi \
 && rm -rf /var/lib/apt/lists/*

# The sandbox caps processes with RLIMIT_NPROC to stop fork bombs, and the
# kernel does not enforce that limit for root. Running as root would silently
# switch that protection off, so the app runs as an unprivileged user.
# The UID is pinned so volume ownership and docker-compose.yml's tmpfs mounts
# can name it, rather than depending on what useradd happens to allocate.
RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --home /app --shell /usr/sbin/nologin app

WORKDIR /app
COPY --from=deps  /app/node_modules          ./node_modules
COPY --from=build /app/package.json          ./package.json
COPY --from=build /app/server/package.json   ./server/package.json
COPY --from=build /app/server/dist           ./server/dist
COPY --from=build /app/server/scripts        ./server/scripts
COPY --from=build /app/client/dist           ./client/dist

# /data holds the SQLite database and must be a volume, or every redeploy
# starts from an empty bank and loses every student's progress.
RUN mkdir -p /data /app/.tmp/sandbox && chown -R app:app /data /app/.tmp
VOLUME /data

ENV NODE_ENV=production \
    PORT=4000 \
    DATABASE_FILE=/data/syntax-practice.db \
    SANDBOX_DRIVER=subprocess \
    SANDBOX_WORKDIR=/app/.tmp/sandbox \
    RUNNING_IN_CONTAINER=true

USER app
EXPOSE 4000

# node rather than curl: the slim image has no curl, and adding it only for this
# would widen the image for no other reason.
# The start period covers first-boot seeding, which runs every reference solution
# and can take minutes on a small instance; give up sooner and an orchestrator
# would kill the container mid-seed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=300s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/scripts/docker-entrypoint.mjs"]
