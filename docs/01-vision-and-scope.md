# 01 – Vision and Scope

## Purpose

FlareFleet is a rewrite of the existing `fleet-tracking` application
(Django + React + PostgreSQL on Docker) as a **Cloudflare Workers native**
application. It manages a pool of vehicles and equipment (aerial work
platforms / "Steiger", golf cars, loaders, telehandlers, lifting platforms,
and configurable further categories) through their complete lifecycle at the
operator's site:

```text
 Excel import          Delivery            Pool               Loan                Return             Back to manufacturer
┌────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌────────────────────────┐
│ announced  │──▶│  check-in    │──▶│  available   │──▶│   loaned     │──▶│ loan return  │──▶│ manufacturer check-out │──▶ archived
│ (imported) │   │ (protocol +  │   │              │   │ (protocol +  │   │ (protocol +  │   │ (protocol + photos)    │
│            │   │  photos)     │   │              │   │  photos +    │   │  photos)     │   │                        │
└────────────┘   └──────────────┘   └──────────────┘   │  signature)  │   └──────────────┘   └────────────────────────┘
                                          ▲            └──────────────┘          │
                                          └──────────── available / damaged / maintenance
```

Every step produces an immutable **protocol** (workflow record + snapshot +
photos + optional signature + generated PDF) and an **audit-log entry**. The
old repository is used as the functional guideline; this document set is the
specification for the new implementation.

## Goals

1. **100 % Cloudflare**: one Worker serves the API and the React SPA; data in
   D1, files in R2, sessions/settings cache in KV, per-vehicle serialisation in
   Durable Objects, background jobs in Queues and Cron Triggers, PDFs via
   Browser Rendering. No servers, containers or third-party hosting.
2. **Same functional coverage as the old app**, simplified where the old
   implementation grew complex (see "Deliberate simplifications").
3. **Three user levels**: Super Admin (global/general settings, tenancy-wide
   configuration), Admin (master data, users, imports, corrections), User
   (daily operations: check-in, loan, return, manufacturer check-out).
4. **Full traceability**: every state change and every workflow is
   protocolled with actor, timestamp, before/after and evidence hashes.
5. **Mobile-first operator UX**: workflows are run on phones/tablets in the
   yard, with camera capture and touch signature.
6. **German and English** UI, validation messages and PDFs.

## Functional scope (feature inventory)

| Area | Features |
|---|---|
| Vehicles | Master data, categories with meter mode, QR code per vehicle, status machine, history timeline, archive |
| Arrival | Excel import of announced vehicles (validate → review → commit), manual creation, arrival task list |
| Check-in | Wizard: identity, supplier, readings, condition outcome, damages, photos, signature → protocol + PDF; vehicle becomes available/damaged/maintenance |
| Pool | Filterable pool view (status, category, location, availability), typeahead search, QR quick access |
| Loan | Wizard: borrower (company/driver/manual), expected return, readings, damages, photos, **mandatory signature** → loan + PDF; vehicle becomes loaned |
| Reservation | Book a vehicle for a time window; checkout fulfils reservation; conflicts block checkout |
| Return | Wizard: explicit condition outcome, readings ≥ checkout readings, damages, photos, optional signature → loan closed + PDF |
| Maintenance | Send to / complete maintenance with reason, readings, photos; open damage keeps vehicle damaged |
| Damages | Damage reports with severity, photos, workflow phase; resolve with notes |
| Manufacturer check-out | Wizard: recipient manufacturer/supplier, readings, damages, photos, signature → protocol + PDF; vehicle leaves the pool; admin archive |
| Media | Photo upload (camera), signature capture, staged → attached lifecycle, SHA-256 integrity, authorised downloads, thumbnails |
| Documents | Generated PDFs per protocol in DE/EN, document register with missing/failed/generated state, retry |
| Protocol / Audit | Append-only audit log of every action, per-vehicle timeline, CSV export |
| Tasks & Dashboard | Status counts, overdue returns, arrivals awaiting check-in, reservation handovers, condition attention, failed documents, manufacturer returns due |
| Master data | Companies (subcontractor, manufacturer, supplier, internal), drivers, categories, duplicates/merge |
| Users | Super admin / admin / user roles, invitations, password reset, must-change-password, deactivation, session management |
| Settings | Super-admin global settings (branding, languages, signature policy, reservation window, media limits, retention, PDF footer, QR base URL) |
| Import/Export | Excel import (xlsx), CSV exports (audit, documents, import errors/generated IDs), xlsx template download |
| Ops | Health endpoint, setup readiness checklist, scheduled cleanup, D1 Time Travel + R2 lifecycle as backup strategy |

## Deliberate simplifications versus the old application

| Old behaviour | New behaviour | Reason |
|---|---|---|
| Separate Django admin UI | None; everything in the SPA | Workers have no Django admin |
| Pluggable media backends (local, SFTP, S3) | R2 only | Platform native |
| Django session + CSRF cookie | Signed, HttpOnly session cookie (KV-backed) + double-submit CSRF header; optional Cloudflare Access in front | Simpler, still same-origin |
| Synchronous PDF render inside the DB transaction | Workflow commits first; PDF job is queued and rendered asynchronously; register shows `pending → generated / failed` | D1 has no long transactions; Workers have CPU limits |
| Row-level `SELECT … FOR UPDATE` locking | One Durable Object per vehicle serialises all workflow mutations for that vehicle; D1 `batch()` provides atomic multi-statement writes | D1 has no interactive transactions |
| Legacy alias routes (`manufacturer-checkouts`) | Single canonical route set | Greenfield |
| Read-only role | Not a separate role at launch; **User** may be flagged `can_execute_workflows=false` to get read-only behaviour | Requested roles are super admin / admin / user |

## Out of scope

- GPS / telematics, billing, native apps, offline-first synchronisation,
  predictive maintenance, manufacturer API integrations, multi-tenant SaaS
  billing.

## Document map

| File | Content |
|---|---|
| `02-architecture.md` | Cloudflare building blocks, request flow, concurrency model, deployment topology |
| `03-roles-and-permissions.md` | Super admin / admin / user, permission matrix, capability flags |
| `04-data-model.md` | D1 schema (DDL), R2 key layout, KV keys, DO state |
| `05-workflows.md` | State machine and function-level specification of every workflow |
| `06-api.md` | REST API reference |
| `07-frontend.md` | SPA routes, wizards, components, i18n |
| `08-excel-import.md` | Import format, validation, commit |
| `09-media-and-pdf.md` | Photos, signatures, PDF protocols, document register |
| `10-protocol-and-audit.md` | Audit log, vehicle timeline, retention, exports |
| `11-settings.md` | Global settings owned by super admin |
| `12-implementation-plan.md` | Milestones, work packages, risks |
| `13-testing-and-operations.md` | Test strategy, CI/CD, monitoring, backup/restore |
