# 12 – Implementation Plan

Work is organised in milestones that each end with a deployable Worker.
Milestones are ordered by dependency, not by calendar time. Each work package
lists the components it touches and its acceptance criteria.

## M0 – Foundation

| WP | Scope | Done when |
|---|---|---|
| 0.1 Monorepo | pnpm workspaces `apps/worker`, `apps/web`, `packages/shared`; TypeScript strict; ESLint/Prettier; Vitest; `wrangler.jsonc` with `dev/staging/production` envs and all bindings (D1, R2, KV, DO, Queues, Browser, Images, Assets, Rate Limiting) | `wrangler dev` serves SPA + `/api/v1/health`; CI runs lint/test/typecheck |
| 0.2 Schema & migrations | Drizzle schema for all tables in `04-data-model.md`, triggers, seed migration (sequences, fallback category) | `wrangler d1 migrations apply` on local and staging |
| 0.3 Core middleware | Request id, JSON error envelope, Zod validation, i18n message resolver, structured logging | Error format matches `06-api.md` |
| 0.4 Auth | PBKDF2 hashing, login/logout/me, KV sessions + D1 mirror, CSRF, rate limiting, lockout, must-change-password, super-admin bootstrap from secrets | Login flow tested with vitest-pool-workers; SPA login page |
| 0.5 Settings | Settings table, cache, `GET/PUT /settings`, Zod schema per section, `settings_public` in `/auth/me` | Super admin can change `general` and see the audit row |
| 0.6 Audit | `audit()` helper that appends to batches, `GET /audit-logs` | Every M0 mutation writes audit rows |
| 0.7 SPA shell | React Router, `AuthContext`, role-aware navigation, language switch, connectivity banner, error boundary, design system (Tailwind + Radix primitives), mobile bottom nav | Deployed to staging behind login |

## M1 – Master data and vehicles

| WP | Scope |
|---|---|
| 1.1 Categories CRUD (+ meter mode, deactivate/reactivate with vehicle count) |
| 1.2 Companies & drivers (CRUD, typeahead, duplicates, two-step merge) |
| 1.3 Vehicles: create (announced), edit, list with filters/pagination, detail, QR code generation, `workflow-context`, `history` (status history only for now), capabilities & `next_actions` in `packages/shared` |
| 1.4 Users admin pages (create, roles, temporary password, deactivate, sessions) |
| 1.5 QR: `/qr/{code}` resolver, `/v/{code}` SPA route, single label print, bulk print sheet |

Acceptance: an admin can set up categories, companies, drivers, users and
vehicles entirely from the SPA; QR labels print; audit log shows every change.

## M2 – Media and the VehicleCoordinator

| WP | Scope |
|---|---|
| 2.1 Media upload (validation, Images re-encode, R2, staging, discard, download auth), `media.derive` queue job |
| 2.2 `MediaUploadField` (camera, client resize, captions, reorder) and `SignaturePad` |
| 2.3 `VehicleCoordinator` DO skeleton with request serialisation, `transitionVehicle`, batch builder, idempotency helper |
| 2.4 Workflow drafts API + `useWorkflowDraft` hook (autosave, resume/discard/conflict UI) |

## M3 – Arrival: import and check-in

| WP | Scope |
|---|---|
| 3.1 `ImportJobActor` DO: upload → validate (ExcelJS, aliases, diff, duplicates, supplier proposals) → rows in D1/R2 |
| 3.2 Import review UI (header report, row table, exclusions, remap dialog), commit with fingerprint, progress polling, CSV downloads, template download |
| 3.3 Check-in service (`complete`, `createAndComplete`), condition outcome resolution, damage reports, maintenance-from-outcome |
| 3.4 Check-in wizard (select announced vehicle / scan QR / create new → supplier → readings → condition & damages → photos → signature → review → receipt) |
| 3.5 Arrivals task group and dashboard counts |

Acceptance: import 500 rows, print labels, check in a vehicle on a phone with
photos; vehicle becomes `available`/`damaged`/`maintenance`; history and audit
complete.

## M4 – Loan, reservation, return

| WP | Scope |
|---|---|
| 4.1 Reservation service + calendar/list UI, conflict logic |
| 4.2 Loan checkout service (reservation fulfilment, party validation, mandatory signature) + wizard |
| 4.3 Loan return service (deltas, outcome, open-damage rule, policy signature) + wizard with return context |
| 4.4 Maintenance start/complete services + task page; damage create/edit/resolve |
| 4.5 Dashboard summary and all task groups; navigation badges |

## M5 – PDF protocols and document register

| WP | Scope |
|---|---|
| 5.1 `pdf.render` queue consumer, HTML templates DE/EN, Browser Rendering integration, pdf-lib post-processing, retries/DLQ |
| 5.2 Documents API (register, download, retry single/bulk, generate other language), reconciliation cron |
| 5.3 Receipt component polling document status; document register page; failed-documents task group |

## M6 – Manufacturer check-out, archive, corrections

| WP | Scope |
|---|---|
| 6.1 Manufacturer check-out service + wizard; reservation auto-cancel |
| 6.2 Archive/unarchive, admin correction (status/meters/reason), loan cancel |
| 6.3 Archive page, vehicle detail admin panel, full vehicle timeline (all kinds) |

## M7 – Hardening and operations

| WP | Scope |
|---|---|
| 7.1 Cron jobs (drafts/media expiry, no-show, retention, integrity sample, weekly D1 export to R2) |
| 7.2 Exports (audit, register, vehicles) via queue + one-time tickets |
| 7.3 Notifications (optional e-mail provider), overdue digest |
| 7.4 Cloudflare Access mode, maintenance mode, danger zone |
| 7.5 Setup readiness, health checks, Workers Logs dashboards, alerting on DLQ depth |
| 7.6 Performance pass: D1 indexes verified with `EXPLAIN QUERY PLAN`, Sessions API for reads, bundle splitting, PWA manifest + offline shell |
| 7.7 Security review: CSRF, upload magic-byte tests, authorisation matrix tests, dependency audit |

## M8 – Data migration from the old system (optional)

- Export PostgreSQL tables to CSV; a one-off migration Worker script maps
  users (`admin→admin`, `operations→user`, `readonly→user` with
  `can_execute_workflows=false`, superuser→`super_admin`), master data,
  vehicles, loans, protocols, damages, audit log.
- Copy media from the old volume/S3 into R2 preserving SHA-256; regenerate
  PDFs from snapshots where the old PDF is missing.
- Dry-run mode producing a reconciliation report (counts per table, hash
  mismatches).

## Cross-cutting definition of done

- Shared Zod schema for every request/response used by Worker and SPA.
- Unit tests for services (pure logic) and integration tests with
  `@cloudflare/vitest-pool-workers` (real D1/R2/KV/DO in Miniflare).
- SPA component tests for wizards and role-gated navigation; Playwright
  end-to-end for the happy path (import → check-in → loan → return →
  manufacturer check-out → archive) on staging.
- DE and EN bundles complete (CI check compares keys).
- Every mutation has an audit action in `10-protocol-and-audit.md`.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Browser Rendering not available or too slow on the account plan | Renderer setting with pdf-lib fallback; PDF generation is asynchronous so workflows never block |
| D1 single-writer contention under bursty imports | Import commit in chunks in the DO; workflow writes are short batches; reads via Sessions API |
| Large photo uploads on poor mobile networks | Client-side resize, sequential uploads with retry, drafts keep staged ids |
| KV eventual consistency for session revocation | D1 `sessions` mirror is checked on privileged routes; short KV TTL |
| ExcelJS bundle size (~1 MB) | Loaded only inside the `ImportJobActor` via dynamic import; Worker bundle limit is 10 MB on paid plan |
| Clock skew on devices when `performed_at` is entered manually | Server accepts ≤ 5 min future tolerance, otherwise rejects with a clear message |
| Loss of atomicity if a batch exceeds D1 limits | Batch builder enforces ≤ 100 params per statement and splits inserts; snapshots exclude binary data |
