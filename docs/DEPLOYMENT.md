# Deployment

This platform runs **untrusted code submitted by students**. That shapes every
decision below: where it runs, as which user, and what it may touch.

## Before anything else

The server refuses to start in production (`NODE_ENV=production`) until these
are set. Its defaults exist so `npm run dev` works with no setup, and every one
of them is committed to this repository.

| Variable | Why it is required |
| --- | --- |
| `JWT_SECRET` | The fallback is public, so anyone could sign an admin token. At least 32 characters: `openssl rand -hex 32` |
| `SEED_ADMIN_PASSWORD`, `SEED_STUDENT_PASSWORD` | Needed only when an empty database is seeded. The demo passwords are printed in the README, so they are refused. |

It also warns — without refusing — about an open `CORS_ORIGIN`, about running
as root, and about the sandbox layout (below).

## The recommended layout: one container on one host

```bash
cp .env.production.example .env.production   # fill in JWT_SECRET and the seed passwords
docker compose up -d --build
docker compose logs -f app                   # first boot seeds 142 questions (~20 s)
```

Then put HTTPS in front of port 4000 (Caddy, nginx, or your platform's load
balancer) and set `CORS_ORIGIN` to the public origin.

What the image and `docker-compose.yml` do, and why:

- **Runs as an unprivileged user (UID 10001).** The sandbox limits student
  processes with `RLIMIT_NPROC`, and the kernel does not enforce that limit
  for root. Measured on this codebase: under a limit of 5, root forked 50 of
  50 processes; the unprivileged user forked none. Most Dockerfiles run as
  root by default, which would silently remove that protection.
- **Subprocess sandbox inside the container.** Each submission runs in a
  hardened child process; the container is the outer boundary. Do **not**
  switch to `SANDBOX_DRIVER=docker` inside a container: it needs the Docker
  socket mounted into a public web app, which gives that app root on the host.
- **`cap_drop: ALL`, `no-new-privileges`, a read-only root filesystem,** with
  writable space only in the `/data` volume and two tmpfs scratch mounts.
- **Only the server's production dependencies ship.** The client is compiled
  into static files; React, Monaco, Vite, Vitest and TypeScript are not in the
  image, and neither are their dev-server advisories.
- **Seeds only an empty database.** Restarts never re-seed, so an admin's
  edits to questions survive a redeploy.

### Java, C and C++

The image installs a JDK, gcc and g++ by default so every seeded question
works. For a much smaller image covering Python, SQL, JavaScript, HTML and CSS:

```bash
docker build --build-arg TOOLCHAINS=false -t syntax-practice .
```

Questions in the missing languages then report that the toolchain is
unavailable; nothing else is affected.

## Constraints that come from SQLite

- **Run exactly one instance.** SQLite lives on one disk. Two replicas would
  each have their own database, and students would see their progress appear
  and vanish between requests. Scale up (more CPU, a higher
  `SANDBOX_MAX_CONCURRENT`), not out. `docs/DATABASE.md` describes the path to
  PostgreSQL if you outgrow one machine.
- **The volume is the product.** Every account, submission and question edit
  lives in `/data`. A platform that recreates containers without a persistent
  volume will silently start from empty on every deploy.
- **Back it up.** Copying the `.db` file while the app runs can capture a torn
  page and misses the write-ahead log. Use the online backup instead:

  ```bash
  docker compose exec app node server/scripts/backup.mjs
  # ✓ /data/backup-2026-…db — 142 questions, 8 submissions, integrity ok
  ```

  It writes into the volume; copy the file somewhere off the host.

## Without Docker

On a VM with Node 22, Python 3 and (optionally) a JDK, gcc and g++:

```bash
npm ci
npm run build                      # compiles the server and client, copies runtime assets
export NODE_ENV=production JWT_SECRET=… DATABASE_FILE=/var/lib/syntax-practice/app.db
npm --workspace server run migrate:prod
SEED_ADMIN_PASSWORD=… SEED_STUDENT_PASSWORD=… npm --workspace server run seed:prod   # once
npm start
```

Run it as a dedicated unprivileged user, never root, for the reason above.
Without a container around it, `SANDBOX_DRIVER=docker` (on a host where the
app user may start containers) gives each submission its own throwaway
container with no network.

## After the first deploy

The seeded `admin@`, `teacher@` and `student*@syntaxpractice.dev` accounts use
the seed passwords you chose. Create your real admin account, then delete or
re-password the demo ones.

`ANTHROPIC_API_KEY` is optional. Without it the AI tutor falls back to
deterministic hints and the rest of the platform is unaffected.

## Health

`GET /api/health` answers `{"status":"ok","env":"production",…}`. The image's
`HEALTHCHECK` uses it. **Admin → Health** is a different check: it re-runs every
question's reference solution through the engine, and is worth running after
every upgrade — an engine change is when questions silently stop being
answerable.

## What has been verified, and how

`npm run test:build` compiles the server and boots the compiled output in
production mode. It exists because the compiled build once crashed on boot —
`tsc` did not copy the schema or the sandbox harnesses — and nothing noticed,
since development and every other test run from source.

The image's runtime layout was reproduced outside Docker and exercised end to
end: the pruned dependency set, the entrypoint, the unprivileged user, a
read-only application tree, first boot seeding, a restart that kept every
submission and did not re-seed, and a health sweep in which all 142 questions
passed across every language.

The image itself was **not** built in the environment this was prepared in:
its network policy blocks the Debian package mirror, so no `apt-get` step can
run there. The Dockerfile is conventional and should build on any ordinary
host; build it once and run `docker compose up` before relying on it.
