# 13 – Testing, CI/CD and Operations

## Test strategy

| Level | Tooling | What |
|---|---|---|
| Unit (shared) | Vitest | Status machine, capability computation, reading validation, condition outcome resolution, import row normalisation/aliases/diff, snapshot builders, i18n key completeness |
| Worker integration | `@cloudflare/vitest-pool-workers` (Miniflare: D1, R2, KV, DO, Queues) | Every route: auth, role matrix (super admin / admin / user / read-only user), idempotency replay & conflict, DO serialisation (two concurrent checkouts → one `409`), batch atomicity (forced failure leaves no partial rows), media staging/attach/discard, import validate→commit, queue consumer with a mocked `BROWSER` binding, cron handlers |
| Frontend | Vitest + Testing Library | Wizards (step validation, draft resume/conflict), `MediaUploadField`, `SignaturePad`, capability-driven buttons, i18n switching, route guards |
| End-to-end | Playwright against `wrangler dev` (and nightly against staging) | Golden path: import → labels → check-in with photos → reservation → loan with signature → return with damage → maintenance → manufacturer check-out → archive; PDF downloaded and text-checked; audit log entries present |
| Non-functional | k6 (optional) | 50 concurrent operators listing/loaning; D1 query timings via `EXPLAIN QUERY PLAN` review |

Fixtures: a `seed` script (`pnpm seed:dev`) creates categories, companies,
drivers, users per role and vehicles in every status, mirroring the old
`seed_demo_data` command. It is refused when `ENVIRONMENT=production`.

## CI/CD (GitHub Actions)

```text
pull_request:  lint → typecheck → unit → worker integration → web build → i18n check → playwright (wrangler dev)
main:          all of the above → wrangler deploy --env staging → d1 migrations apply --env staging → smoke test
release tag:   wrangler deploy --env production → d1 migrations apply --env production → smoke test → GitHub release notes
```

- Secrets in GitHub: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
  Application secrets (`SESSION_SIGNING_KEY`, `SUPER_ADMIN_EMAIL`,
  `SUPER_ADMIN_INITIAL_PASSWORD`, `EMAIL_API_KEY`, `ACCESS_TEAM_DOMAIN`) are
  set with `wrangler secret put` per environment.
- Migrations are forward-only; each PR that changes the schema adds a numbered
  migration; CI applies all migrations to a fresh local D1 to catch errors.
- Preview: `wrangler versions upload` creates a preview URL per PR (Workers
  Versions) against the staging D1.

## Environments

| Env | Worker name | D1 | R2 | Domain |
|---|---|---|---|---|
| dev (local) | `flarefleet-dev` | local Miniflare | local | `http://localhost:5173` (Vite plugin) |
| staging | `flarefleet-staging` | `flarefleet-db-staging` | `flarefleet-media-staging` | `fleet-staging.example.com` |
| production | `flarefleet` | `flarefleet-db` | `flarefleet-media` | `fleet.example.com` |

Custom domain via Workers Routes; Cloudflare WAF managed rules and Bot Fight
Mode enabled; optional Cloudflare Access policy in front of the whole
hostname for defence in depth.

## Observability

- Structured JSON logs (`request_id`, `user_id`, `route`, `duration_ms`,
  `d1_queries`, `outcome`) via Workers Logs; `wrangler tail` for live
  debugging.
- Analytics Engine dataset `flarefleet_metrics` (optional): counts per
  workflow type, PDF render duration, import sizes, error codes → dashboard in
  the Cloudflare UI or Grafana.
- Alerts (Cloudflare Notifications): Worker error rate, Queue DLQ depth > 0,
  D1 storage > 80 %, Cron failures.
- `GET /api/v1/health` performs cheap probes (D1 `SELECT 1`, R2 `head` of a
  marker object, KV read) and reports the last successful cron/queue run.

## Backup and restore

| Data | Mechanism |
|---|---|
| D1 | Time Travel (30 days PITR, paid plan) + weekly `wrangler d1 export` written to R2 `backups/d1/{date}.sql` by a scheduled GitHub Action (the export API is not available inside Workers) |
| R2 | Objects are immutable; optional cross-bucket replication via a nightly `rclone` job or R2 Sippy for migration. Object deletion only through the retention cron, always audited |
| KV | Ephemeral; no backup needed |
| Settings | Included in D1; additionally exported as JSON to R2 on every change |

Restore drill: `wrangler d1 time-travel restore --timestamp …` on a staging
copy, verify counts against the audit log, then promote.

## Operational runbooks (to be written during M7)

1. Rotate session signing key.
2. Recover a failed PDF batch (DLQ → retry).
3. Re-run an import that was aborted mid-commit.
4. Unlock a user / reset super admin password via `wrangler secret` bootstrap.
5. Move to a new custom domain (`public_base_url`, reprint QR labels?).
6. Enable Cloudflare Access mode.

## Local development

```bash
pnpm install
pnpm dev            # vite + wrangler dev (worker with local D1/R2/KV/DO, queues, cron via /__scheduled)
pnpm db:migrate     # wrangler d1 migrations apply --local
pnpm seed:dev
pnpm test           # unit + worker integration
pnpm e2e            # playwright
```

The Cloudflare Vite plugin runs the Worker in the real `workerd` runtime
during development, so DO, Queues (`--local`), Browser Rendering (remote
binding) and Images (low-fidelity local) behave like production.
