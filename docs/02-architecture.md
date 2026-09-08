# 02 – Architecture on Cloudflare Workers

## Building blocks

| Concern | Cloudflare product | Binding | Notes |
|---|---|---|---|
| HTTP API + SPA hosting | **Workers** with Static Assets | `ASSETS` | One Worker `flarefleet`. Hono router for `/api/*`; assets serve the Vite-built React SPA with `not_found_handling: single-page-application` |
| Relational data | **D1** (SQLite) | `DB` | Single database `flarefleet-db` (well below the 10 GB limit for a fleet of thousands of vehicles). Drizzle ORM + `wrangler d1 migrations` |
| Files | **R2** | `MEDIA` | Photos, signatures, generated PDFs, import workbooks, CSV exports. Never public; every download passes through the Worker |
| Sessions, settings cache, idempotency, rate limits | **KV** | `KV` | Short-lived, eventually consistent data only |
| Per-vehicle serialisation & workflow transactions | **Durable Objects** | `VEHICLE_DO`, `IMPORT_DO` | Replace PostgreSQL row locks; guarantee one workflow mutation at a time per vehicle |
| Background jobs | **Queues** | `JOBS` (+ `JOBS_DLQ`) | PDF rendering, image derivatives, CSV exports, notifications |
| Scheduled work | **Cron Triggers** | – | Draft/staged-media expiry, overdue detection, retention, register reconciliation |
| PDF rendering | **Browser Rendering** | `BROWSER` | HTML template → PDF (`page.pdf`). pdf-lib is used for post-processing (metadata, page numbers) and as text-only fallback |
| Image processing | **Images binding** | `IMAGES` | Re-encode, strip EXIF, resize thumbnails/contact-sheet images |
| Optional SSO | **Cloudflare Access** | – | If enabled, Access JWT identity is mapped to a local user; local password login can be disabled by super admin |
| Logs/metrics | **Workers Logs**, Tail, Analytics Engine (optional) | `METRICS` | Structured JSON logs with request id |

Everything is declared in a single `wrangler.jsonc` with three environments
(`dev`, `staging`, `production`).

## Runtime topology

```text
Browser (React SPA, PWA manifest, camera, canvas signature)
   │  HTTPS, same origin
   ▼
Cloudflare edge ──► Worker "flarefleet"
   ├── /assets/*, /, /vehicles/…, /v/{qr}   → Static Assets (SPA, index.html fallback)
   └── /api/v1/*  (run_worker_first)        → Hono app
          ├── auth middleware (session cookie ← KV) + CSRF/Origin check
          ├── read handlers        → D1 (Sessions API, read replicas allowed)
          ├── write handlers ──────► Durable Object VehicleCoordinator(vehicleId)
          │                             ├── validate business rules (reads D1)
          │                             ├── D1 batch(): domain rows + audit rows + media attach (atomic)
          │                             └── JOBS.send({type:"pdf.render", …})
          ├── media handlers       → R2 (put/get), IMAGES (derivatives)
          └── import handlers ─────► Durable Object ImportJobActor(jobId) → R2 (workbook) + D1
Queue consumer (same Worker, `queue()` handler)
          ├── pdf.render      → D1 snapshot → HTML → BROWSER.pdf() → R2 → D1 (document row) → audit
          ├── media.derive    → R2 original → IMAGES → R2 thumbnail
          └── export.csv      → D1 → R2 → D1 export row
Cron (`scheduled()` handler)
          ├── */15 min  expire drafts, purge staged media, overdue loan flags
          └── daily     retention, register reconciliation, session GC, KV hygiene
```

## Request lifecycle for a workflow write (example: loan checkout)

1. SPA `POST /api/v1/loans` with JSON body and `Idempotency-Key` header.
2. Hono middleware: resolve session (KV) → user; check `Origin` and
   `X-Requested-With`; check role capability `loan.checkout`.
3. Handler validates the *shape* of the payload with Zod (types, required
   fields, enum values) and resolves the language.
4. Handler calls `env.VEHICLE_DO.idFromName(vehicleId)` →
   `stub.fetch("/loan-checkout", body)`. The DO runs one request at a time per
   vehicle, so two operators cannot loan the same vehicle concurrently.
5. Inside the DO (`LoanService.checkout`):
   - read vehicle, category, active loan, open damages, active reservations,
     staged media rows from D1;
   - run business validation (`05-workflows.md`);
   - build the immutable `checkout_snapshot`;
   - execute **one** `DB.batch([...])` containing: insert loan, update
     vehicle status/readings, update reservation (if fulfilled), insert
     damage reports, attach media rows (`attached_at`, relations), insert
     `vehicle_status_history`, insert audit rows, insert `documents` row with
     status `pending`;
   - enqueue `{type: "pdf.render", documentId}`.
6. Response `201` with the loan, `capabilities`, `next_actions`, `warnings`.
7. Queue consumer renders the PDF; the SPA receipt polls the document status
   (`pending → generated | failed`).

D1 `batch()` executes all statements in a single implicit transaction and
rolls back if any statement fails, which gives the same atomicity guarantee the
old Django `transaction.atomic()` provided. Interactive transactions are not
needed because all reads-before-write happen inside the serialised DO.

## Durable Objects

### `VehicleCoordinator` (one instance per vehicle, `idFromName(vehicleId)`)

- Purpose: mutual exclusion for all mutations that depend on the vehicle's
  current state (check-in, loan, return, manufacturer check-out, maintenance,
  reservation create/edit, damage resolve, admin correction, archive).
- Holds no authoritative state; D1 is the source of truth. It may cache the
  vehicle row for the duration of one request.
- Alarms: none (overdue detection is Cron based).

### `ImportJobActor` (one instance per import job)

- Parses the workbook (ExcelJS, `nodejs_compat`), validates rows, stores the
  result JSON in R2 (large) and a summary in D1.
- Commit: locks the job, re-validates fingerprints, creates/updates vehicles
  in chunks of 50 rows with `DB.batch()`, writes progress to its own storage
  so the SPA can poll `GET /imports/{id}` for `progress`.
- Because vehicles created by import are `announced` and not yet subject to
  workflows, import commit does not need the `VehicleCoordinator`; updates to
  existing vehicles touch only master-data columns, never status/readings.

### Sequence allocation

Internal numbers (`FZ-00001`) use a D1 counter table updated with
`UPDATE sequences SET next_value = next_value + 1 WHERE name='fleet' RETURNING next_value`,
which is atomic in SQLite; no DO needed.

## Authentication and session model

- **Login**: username or e-mail + password. Passwords hashed with
  PBKDF2-HMAC-SHA256 (600 000 iterations, 16-byte salt) via WebCrypto;
  hash format `pbkdf2$<iter>$<salt>$<hash>` so parameters can be raised later.
- **Session**: 256-bit random id → KV key `sess:<id>` with
  `{userId, role, createdAt, lastSeenAt, ip, ua, csrf}`, TTL 12 h sliding,
  absolute maximum 7 days. Cookie `ff_session`, `HttpOnly; Secure;
  SameSite=Lax; Path=/`.
- **CSRF**: mutating requests must carry `X-CSRF-Token` equal to the session's
  `csrf` value (exposed via `GET /auth/me`) and a matching `Origin`.
- **Rate limiting**: Workers Rate Limiting binding on `/auth/login`
  (10/min/IP and 20/min/username) and on media upload.
- **Must-change-password**: session carries `mustChangePassword`; API allows
  only `/auth/*` and `/users/me/password` until cleared.
- **Cloudflare Access (optional)**: when `auth.mode = access`, the Worker
  validates the `Cf-Access-Jwt-Assertion` header against the team's JWKS,
  matches `email` to a local user, and creates the session without a password.
- **Super admin bootstrap**: `SUPER_ADMIN_EMAIL` + `SUPER_ADMIN_INITIAL_PASSWORD`
  Wrangler secrets create the first super admin on first request if the
  `users` table is empty (`must_change_password = true`).

## Data placement rules

- D1: all structured data, snapshots (JSON ≤ 2 MB/row), audit log.
- R2: every binary. Key layout in `04-data-model.md`.
- KV: sessions, settings cache (`settings:v<n>`), idempotency replay bodies
  (`idem:<userId>:<key>`, TTL 24 h), export download tickets.
- DO storage: import progress, per-vehicle in-flight marker for diagnostics.

## Localisation

- Frontend: `i18next` with `de` and `en` JSON bundles; language stored on the
  user profile and mirrored in `localStorage`.
- API: `Accept-Language` or user preference determines message language.
  Error payloads contain stable `code` plus localised `message`. Enum values
  are stable English codes.
- PDFs: rendered from a Handlebars/JSX template per language; language stored
  on the document row.

## Limits taken into account

| Limit | Impact | Mitigation |
|---|---|---|
| Worker CPU 30 s (paid), 128 MB memory | Large imports / PDFs | Import parsing in DO with chunked commit; PDF rendered by Browser Rendering; photos downscaled before embedding |
| D1 row 2 MB, statement 100 KB, 100 bound params | Snapshots, batch size | Snapshots hold hashes + metadata, not images; batch inserts ≤ 50 rows / statement group |
| D1 single writer | Throughput | Reads use Sessions API/replicas; writes are short batches |
| Request body 100 MB (paid) | Photo upload | Client resizes to ≤ 2048 px before upload; server limit 10 MB/photo, 1 MB/signature, 20 MB/xlsx |
| Browser Rendering concurrency | PDF bursts | Rendering via Queue with concurrency 2, retries with backoff, DLQ |
| KV eventual consistency | Session revocation lag | Revoked sessions are also written to D1 `session_revocations` checked on privileged actions |

## Repository layout (target)

```text
.
├── wrangler.jsonc
├── package.json                 # workspaces: apps/worker, apps/web, packages/shared
├── apps/
│   ├── worker/                  # Hono API, DOs, queue + cron handlers
│   │   ├── src/index.ts         # fetch / queue / scheduled entrypoints
│   │   ├── src/routes/          # one file per resource
│   │   ├── src/services/        # domain services (pure functions + D1 access)
│   │   ├── src/durable/         # VehicleCoordinator, ImportJobActor
│   │   ├── src/jobs/            # queue consumers
│   │   ├── src/pdf/             # templates, renderer
│   │   ├── src/db/              # drizzle schema, migrations
│   │   └── test/                # vitest + @cloudflare/vitest-pool-workers
│   └── web/                     # React + Vite + TypeScript SPA
│       └── src/{routes,pages,components,api,i18n,hooks}
├── packages/shared/             # Zod schemas, enums, capability logic, types shared by both
└── docs/                        # this specification
```
