# FlareFleet

Fleet and equipment pool management, built entirely on **Cloudflare Workers**
(Workers + Static Assets, D1, R2, KV, Durable Objects, Queues, Cron Triggers,
Browser Rendering, Images).

FlareFleet is the successor of
[`fleet-tracking`](https://github.com/reichiClaw/fleet-tracking) (Django +
React + PostgreSQL on Docker). It keeps the proven functional model and moves
it to a serverless, single-Worker architecture.

## What it does

```text
Excel import ─▶ announced ─▶ check-in ─▶ available ─▶ loan ─▶ return ─▶ manufacturer check-out ─▶ archived
                              (protocol,   (pool,       (protocol,  (protocol,   (protocol, photos)
                               photos)      QR, tasks)   photos,     photos)
                                                         signature)
```

- Import the manufacturer's delivery list from Excel before the machines
  arrive; print QR labels.
- Check vehicles in with readings, condition outcome, damages, photos and a
  protocol PDF.
- Loan vehicles from the pool to subcontractors or internal drivers with
  photos and a mandatory signature; reserve vehicles ahead of time.
- Take vehicles back, document new damage, send them to maintenance.
- Check vehicles out to the manufacturer/supplier and archive them.
- Every step is protocolled: immutable workflow snapshots, status history,
  append-only audit log, generated PDF protocols in German and English.
- Three user levels: **Super Admin** (global settings), **Admin** (master
  data, users, imports, corrections), **User** (daily operations).

## Status

Planning phase. The complete specification lives in [`docs/`](docs/):

| Document | Content |
|---|---|
| [01 Vision and scope](docs/01-vision-and-scope.md) | Goals, feature inventory, simplifications vs. the old app |
| [02 Architecture](docs/02-architecture.md) | Cloudflare building blocks, request flow, Durable Object concurrency model, auth |
| [03 Roles and permissions](docs/03-roles-and-permissions.md) | Super admin / admin / user, permission matrix, capability flags |
| [04 Data model](docs/04-data-model.md) | D1 DDL, snapshot shapes, R2/KV layout |
| [05 Workflows](docs/05-workflows.md) | Status machine and function-level rules for every workflow |
| [06 API](docs/06-api.md) | REST endpoints |
| [07 Frontend](docs/07-frontend.md) | Routes, wizards, components |
| [08 Excel import](docs/08-excel-import.md) | Columns, validation, commit |
| [09 Media and PDF](docs/09-media-and-pdf.md) | Photos, signatures, PDF protocols, document register |
| [10 Protocol and audit](docs/10-protocol-and-audit.md) | Audit log, vehicle timeline, retention |
| [11 Settings](docs/11-settings.md) | Super-admin global settings |
| [12 Implementation plan](docs/12-implementation-plan.md) | Milestones, work packages, risks |
| [13 Testing and operations](docs/13-testing-and-operations.md) | Tests, CI/CD, observability, backups |

## Planned repository layout

```text
apps/worker      Hono API, Durable Objects, queue and cron handlers, PDF templates
apps/web         React + Vite SPA served as Worker static assets
packages/shared  Zod schemas, enums, status machine, capability logic
docs             Specification
wrangler.jsonc   Bindings for dev / staging / production
```
