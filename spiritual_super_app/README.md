# Spiritual-Tech Super App — Sprint 1

High-concurrency platform combining 1:1 astrologer consultations (Astrotalk-style), E-Puja / Sankalp
bookings (Sri Mandir-style) and Vedic Ayurveda diagnostics. Sprint 1 delivers the infrastructure
topology, the financial core and the astrological compute engine.

## Topology

| Service         | Image / Stack                          | Port(s)                 | Role |
| --------------- | -------------------------------------- | ----------------------- | ---- |
| `postgres-db`   | PostgreSQL 16 Alpine                   | internal 5432           | ACID store for wallets and the ledger |
| `redis-state`   | Redis 7 Alpine (AOF, `everysec`)       | internal 6379           | BullMQ queues, Redlock, WS fan-out |
| `fastapi-astro` | Python 3.11 + FastAPI + `pyswisseph`   | 8001                    | Ephemeris, Vimshottari dasha, Prakriti |
| `core-gateway`  | Node 20 + Fastify + Prisma             | 8000                    | Business engine, WS signalling, billing |
| `livekit-rtc`   | LiveKit SFU                            | 7880/7881, 50000-50100/udp | WebRTC media |
| `coturn`        | Coturn 4.6 (host network)              | 3478, 51000-51200/udp   | STUN/TURN relay |
| `nginx-proxy`   | Nginx 1.27 Alpine                      | 80/443                  | TLS termination and routing |

Routing performed by `nginx-proxy`:

- `/api/v1/astro` and `/api/v1/ayurveda` → `fastapi-astro:8001`
- `/api/v1` (including `/api/v1/ws`) → `core-gateway:8000`
- `/rtc` → `livekit-rtc:7880` (path stripped, WebSocket upgrade preserved)

## First run

```bash
cp .env.example .env          # then fill in every secret
# Swiss Ephemeris data files (see backend/astro-service/ephemeris/README.md)
docker compose build
docker compose up -d
docker compose logs -f core-gateway
```

`core-gateway` applies `prisma migrate deploy` on start, so the schema is created on first boot.
Health probes: `GET /healthz` on both the gateway (Postgres + Redis + socket count) and the astro
service (ephemeris path + ayanamsha in use).

Seed development data:

```bash
cd backend/core-gateway
npx tsx prisma/seed.ts
```

## Money and correctness invariants

`.cursorrules` encodes the rules the code is built to; the important ones in practice:

- Wallet mutations flow exclusively through `WalletService`, which runs
  `BEGIN → SELECT … FOR UPDATE → UPDATE → INSERT ledger → COMMIT` and writes a `WalletTransaction`
  for every movement. `wallets.balance` also carries `CHECK (balance >= 0)` as a backstop.
- Currency is `Decimal(12,2)` end to end (`Prisma.Decimal` in TypeScript, `numeric` in Postgres) and
  is serialised to clients as a 2-decimal string, never a JSON float.
- Billing ticks are idempotent: each minute carries the key `call:<sessionId>:minute:<n>`, so a
  BullMQ retry can never double-charge.
- Ephemeris output is Chitra Paksha (Lahiri) sidereal with `swe.TRUE_NODE`; Ketu is derived as the
  exact 180° opposite of Rahu.

## Call lifecycle

1. User joins an astrologer's FIFO queue (`POST /api/v1/calls/queue/:astrologerId/join` or the
   `USER_JOIN_QUEUE` WebSocket message). Entry requires `balance ≥ rate × 5`.
2. `AstrologerMatchingWorker` claims the head of the queue when the astrologer is `IDLE`, skipping
   users who went offline or insolvent while waiting.
3. `CallService.initiate` reserves the astrologer with a conditional `IDLE → IN_CALL` update, creates
   the `CallSession`, and mints room-scoped LiveKit JWTs for both sides.
4. Each client calls `POST /api/v1/calls/sessions/:id/activate` after joining the room; that flips the
   session to `ACTIVE` and schedules billing tick #1.
5. `PerMinuteBillingWorker` runs every `BILLING_TICK_SECONDS` under a Redlock keyed on the session,
   debiting `rate_per_minute` and rolling up `total_minutes` / `total_deducted` in one transaction.
6. If the balance falls below the rate, the session becomes `DROPPED_INSUFFICIENT_FUNDS`: a
   `FORCE_DISCONNECT` is published into the LiveKit room, the participant is removed and the room is
   deleted.

## In-call remedy upsell

An astrologer on an `ACTIVE` session pushes a `PujaRemedyCard` (WebSocket `ASTROLOGER_PUSH_REMEDY` or
`POST /api/v1/remedies/dispatch`). The card is held in Redis with a TTL and carries a one-click
authorisation endpoint; `POST /api/v1/remedies/:cardId/authorize` debits the wallet and creates the
`PujaBooking` with `referred_by_astrologer_id` attribution in a single transaction. The card is
consumed before the debit so a double click cannot produce two bookings.

## Compute service endpoints

| Endpoint | Purpose |
| -------- | ------- |
| `POST /api/v1/astro/natal-chart` | Lagna + 9 grahas: sidereal degrees, sign, nakshatra/pada, whole-sign house, speed, retrograde |
| `POST /api/v1/astro/vimshottari-dasha` | Nested dasha tree, `depth` 1–5 (Maha → Antar → Pratyantar → Sookshma → Prana) |
| `POST /api/v1/ayurveda/prakriti-score` | Weighted Vata/Pitta/Kapha distribution over 28 markers |
| `GET  /api/v1/ayurveda/prakriti-parameters` | The canonical 28-parameter questionnaire with weights |

All four require the `X-Internal-Token` header matching `INTERNAL_SERVICE_TOKEN`.

## Scaling notes

- `RUN_WORKERS_IN_API=false` moves BullMQ workers out of the API process; run
  `npm run start:worker` in as many replicas as needed. Redlock keeps billing exactly-once.
- WebSocket delivery is Redis pub/sub based (`ssa:events:client`), so any replica — including a
  worker-only process — can address a socket held elsewhere.
- LiveKit is configured with `room.auto_create: false`; rooms exist only when the gateway creates
  them, which prevents unbilled ad-hoc rooms.
