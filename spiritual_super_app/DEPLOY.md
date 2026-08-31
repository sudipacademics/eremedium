# Hetzner deployment runbook

All commands run from the project directory, **not** the repository root:

```bash
cd /opt/eremedium/spiritual_super_app
```

The app is a subdirectory of the `eremedium` repository, so `docker compose` must be invoked here
(or with `-f spiritual_super_app/docker-compose.yml --project-directory spiritual_super_app`).

## 0. One-time server preparation

```bash
# Docker Engine + Compose plugin
curl -fsSL https://get.docker.com | sh
docker compose version

# Create the environment file (never committed) and fill in every secret
cp .env.example .env
"${EDITOR:-vi}" .env
```

Generate strong values rather than typing them by hand:

```bash
openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 32   # INTERNAL_SERVICE_TOKEN
openssl rand -hex 32   # LIVEKIT_API_SECRET
openssl rand -hex 24   # POSTGRES_PASSWORD
openssl rand -hex 24   # REDIS_PASSWORD
openssl rand -hex 24   # TURN_SHARED_SECRET
```

`docker-compose.yml` uses `${VAR:?...}` guards, so a missing secret aborts the run with a named
error instead of booting a service with an empty password.

TLS material goes in `nginx/certs/` as `fullchain.pem` and `privkey.pem`:

```bash
certbot certonly --standalone -d "$PUBLIC_DOMAIN"
cp /etc/letsencrypt/live/$PUBLIC_DOMAIN/{fullchain.pem,privkey.pem} nginx/certs/
```

Firewall — Coturn runs on the host network, so its ports are not covered by Docker's rules:

```bash
ufw allow 80,443/tcp
ufw allow 3478/tcp && ufw allow 3478/udp
ufw allow 51000:51200/udp     # Coturn relay range
ufw allow 50000:50100/udp     # LiveKit RTC range
ufw allow 7881/tcp            # LiveKit TCP fallback
```

## 1. Sync the repository

```bash
git pull origin main
```

## 2. Populate ephemeris data

```bash
chmod +x ./download_ephe.sh && ./download_ephe.sh
```

Idempotent and safe to re-run: valid files are skipped. Each download is verified to begin with the
`SWISSEPH` marker, because a proxy-returned HTML error page would otherwise leave Swiss Ephemeris
silently falling back to the lower-precision Moshier model. Override the source with
`EPHE_BASE_URL=... ./download_ephe.sh` if you mirror the files internally.

## 3. Build and start the topology

```bash
docker compose up -d --build
```

`core-gateway` runs `prisma migrate deploy` on start, so the schema is created or advanced
automatically. It waits on the Postgres and Redis healthchecks before booting.

## 4. Monitor initialisation

```bash
docker compose logs -f --tail=50
```

Expected markers:

- `fastapi-astro` — `Swiss Ephemeris ready (path=/app/ephemeris, files=sepl_18.se1,semo_18.se1,seas_18.se1, ayanamsha=SIDM_LAHIRI, node=TRUE_NODE, ...)`
- `core-gateway` — `Core gateway listening`, plus `Per-minute billing worker started` and
  `Astrologer matching worker started`
- `postgres-db` / `redis-state` — `healthy` in `docker compose ps`

## 5. Verify

```bash
docker compose ps                                   # every service healthy/running
curl -fsS http://127.0.0.1:8000/healthz | jq        # postgres: up, redis: up
curl -fsS http://127.0.0.1:8001/healthz | jq        # ephemeris_status: ok, 3 files listed
curl -fsS https://$PUBLIC_DOMAIN/healthz | jq       # through Nginx + TLS
```

Smoke-test the compute path end to end (the internal token is required):

```bash
curl -fsS -X POST http://127.0.0.1:8001/api/v1/astro/natal-chart \
  -H 'content-type: application/json' \
  -H "x-internal-token: $INTERNAL_SERVICE_TOKEN" \
  -d '{"dob_utc":"1994-08-17T03:45:00Z","latitude":25.317645,"longitude":83.005495}' | jq '.ascendant, .planets[0]'
```

Seed development data if this is a fresh database:

```bash
docker compose exec core-gateway npx tsx prisma/seed.ts
```

## Rollback

```bash
git log --oneline -5
git checkout <previous-sha>
docker compose up -d --build
```

Prisma migrations are forward-only; roll the schema back with a new compensating migration rather
than reverting a migration file. The `postgres-data` and `redis-data` volumes survive
`docker compose down` — only `docker compose down -v` destroys them, which also destroys the wallet
ledger.

## Scaling the billing workers off the API

```bash
# in .env
RUN_WORKERS_IN_API=false
```

```bash
docker compose up -d --scale core-gateway=3
```

Redlock keeps each per-minute billing tick exactly-once across replicas.
