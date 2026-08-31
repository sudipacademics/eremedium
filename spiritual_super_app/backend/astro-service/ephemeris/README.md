# Ephemeris data files

This directory is mounted read-only into the `fastapi-astro` container at `/app/ephemeris` and is
what `swe.set_ephe_path()` points at.

Download the Swiss Ephemeris / JPL data files covering the birth-date range you need and place them
here (they are binary assets and are intentionally not committed):

The historical `https://www.astro.com/ftp/swisseph/ephe/` path now returns 404; fetch the files from
the upstream Swiss Ephemeris repository instead.

```bash
cd backend/astro-service/ephemeris
BASE=https://raw.githubusercontent.com/aloistr/swisseph/master/ephe
# 1800 CE – 2399 CE covers every realistic user birth date
curl -O "$BASE/sepl_18.se1"   # planets            (~473 KB)
curl -O "$BASE/semo_18.se1"   # high-precision moon (~1.2 MB)
curl -O "$BASE/seas_18.se1"   # main asteroids      (~218 KB)
```

Each file is a binary whose first bytes read `SWISSEPH` — a useful sanity check that a proxy did not
hand you an HTML error page instead.

Without these files `pyswisseph` silently falls back to its built-in Moshier analytical model, which
is accurate to only a few arc-seconds. `GET /healthz` reports the configured path so deployments can
assert the mount succeeded.
