# 10 – Protocolling: Audit Log and Vehicle Timeline

"Every step must be protocolled" is implemented on three layers:

| Layer | Table | Purpose | Mutability |
|---|---|---|---|
| Workflow records | `check_in_protocols`, `loans`, `manufacturer_checkout_protocols`, `maintenance_records`, `reservations`, `damage_reports` | Business evidence with immutable JSON snapshot | Snapshots and resolution fields write-once (triggers) |
| Status history | `vehicle_status_history` | One row per status hop with source record and actor | Append-only |
| Audit log | `audit_log` | Every action (domain, master data, users, settings, auth, system) with before/after | Append-only (UPDATE/DELETE aborted by trigger) |

Generated PDFs (`documents`) are the human-readable protocol; they are always
rendered from the snapshot, never from live data, so a PDF regenerated years
later is identical.

## Audit entry

```json
{
  "id": "01J8…",                      // ULID → chronological
  "actor_id": "u…", "actor_label": "m.mustermann",
  "action": "workflow.loan_checkout.completed",
  "entity_type": "loan", "entity_id": "l…",
  "vehicle_id": "v…",
  "before": {"vehicle": {"status": "available", "current_odometer_km": 12000}},
  "after":  {"vehicle": {"status": "loaned", "current_odometer_km": 12045}, "loan_id": "l…", "damage_report_ids": ["d…"]},
  "request_id": "…", "ip": "…", "user_agent": "…",
  "created_at": "2026-09-08T13:22:05.123Z"
}
```

Audit rows are inserted **in the same `DB.batch()`** as the domain change, so
a change without its audit entry is impossible. Queue/cron actions use
`actor_id = NULL`, `actor_label = "system:<job>"`.

## Action catalogue

| Area | Actions |
|---|---|
| Auth | `auth.login`, `auth.login_failed`, `auth.locked`, `auth.logout`, `auth.session_revoked`, `auth.denied`, `auth.password_changed` |
| Users | `user.created`, `user.updated`, `user.role_changed`, `user.deactivated`, `user.reactivated`, `user.temporary_password_set` |
| Settings | `settings.updated` (key, before, after – secrets masked), `settings.maintenance_mode` |
| Categories | `vehicle_category.created/updated/deactivated/reactivated` |
| Vehicles | `vehicle.created`, `vehicle.updated` (diff), `vehicle.status_changed`, `vehicle.archived`, `vehicle.unarchived`, `vehicle.admin_corrected`, `vehicle.manufacturer_return_scheduled`, `vehicle.qr_printed` |
| Check-in | `workflow.check_in.completed`, `workflow.create_and_check_in.completed` |
| Loans | `workflow.loan_checkout.completed`, `workflow.loan_return.completed`, `loan.cancelled` |
| Reservations | `reservation.created/edited/cancelled/no_show/fulfilled/expired` |
| Maintenance | `workflow.maintenance.started`, `workflow.maintenance.completed` |
| Damages | `damage.created`, `damage.updated`, `damage.resolved` |
| Manufacturer | `workflow.manufacturer_checkout.completed` |
| Media | `media.uploaded`, `media.attached`, `media.discarded`, `media.expired`, `media.downloaded` (signature/pdf/import only) |
| Documents | `pdf.generated`, `pdf.generation_failed`, `document.retried`, `document.bulk_retried` |
| Drafts | `workflow_draft.created`, `workflow_draft.discarded`, `workflow_draft.expired` |
| Imports | `import.uploaded`, `import.vehicle.validated`, `import.vehicle.remapped`, `import.rows_excluded`, `import.vehicle.committed`, `import.vehicle.created`, `import.vehicle.updated`, `import.aborted` |
| Master data | `company.created/updated/deactivated/merged`, `driver.created/updated/deactivated/merged` |
| Exports | `export.requested`, `export.downloaded` |
| System | `system.cron_run`, `system.integrity_check`, `system.retention_purge`, `system.bootstrap_super_admin` |

## Vehicle timeline (`GET /vehicles/{id}/history`)

A merged, chronological view assembled from status history, workflow records,
damages, maintenance, documents and audit rows for the vehicle. Each item:

```json
{"at": "…", "kind": "loan_return", "title_key": "timeline.loan_return", "actor": "m.mustermann",
 "summary": {"borrower": "…", "outcome": "new_damage", "km_delta": 45},
 "links": {"record": "/loans/l…", "document": "/documents/doc…", "media": 4}}
```

Filters: `kind[]`, `date_from/to`. Paged (25/page). The SPA renders it as a
vertical timeline with status badges and photo thumbnails.

## Viewing and exporting

- `AuditLogPage` (admin): filters by action, entity type/id, vehicle, actor,
  date range, free text over JSON; expandable before/after diff; link to the
  entity.
- CSV export is asynchronous (`exports`), UTF-8 with BOM, `;` separator for
  German Excel, ISO timestamps; the download link is a one-time KV ticket.
- Super admin only: export including IP and user agent; other exports omit
  them.

## Retention and integrity

- Audit rows are kept `settings.retention.audit_years` (default 10) and then
  purged by the nightly job in batches of 1 000 (audited as
  `system.retention_purge` with counts).
- Workflow records, snapshots and PDFs are kept for the life of the vehicle
  plus `settings.retention.archived_vehicle_years` (default 10).
- Integrity: every media row carries `content_sha256`; the nightly job
  re-hashes a random 1 % sample of R2 objects and reports mismatches.
- D1 Time Travel (30-day point-in-time restore) plus a weekly `wrangler d1
  export` to R2 (`backups/`) provide database backups; R2 object versioning
  is not needed because objects are immutable.
