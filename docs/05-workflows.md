# 05 – Workflows and Business Rules

This is the function-level specification of the domain layer
(`apps/worker/src/services/*`). Every function listed here is a pure
TypeScript function `(ctx, input) => Promise<Result>` executed inside the
`VehicleCoordinator` Durable Object (unless stated otherwise) and ends with
exactly one `DB.batch()`.

## Vehicle status machine

```text
                       ┌──────────────────────────────────────────────┐
                       │                                              ▼
announced ──check-in──▶ checked_in ──▶ available ──loan──▶ loaned ──return──▶ available
                                          │  ▲                                 │
                                          │  │ complete maintenance            ├──▶ damaged
                                          │  │ (no open damage)                └──▶ maintenance
                                          ▼  │
                       damaged ◀──▶ maintenance
                          │  ▲
                          │  └── resolve last damage → available (if no loan/maintenance)
                          ▼
available | damaged ──manufacturer check-out──▶ manufacturer_checkout ──archive──▶ archived
                                                                          ◀──unarchive (admin)──
```

Allowed transitions (`packages/shared/status.ts`):

| From | To |
|---|---|
| `announced` | `checked_in` |
| `checked_in` | `available`, `damaged`, `maintenance` (only as the second step of check-in) |
| `available` | `loaned`, `maintenance`, `damaged`, `manufacturer_checkout` |
| `loaned` | `available`, `damaged`, `maintenance` |
| `maintenance` | `available`, `damaged` |
| `damaged` | `maintenance`, `available`, `manufacturer_checkout` |
| `manufacturer_checkout` | `archived` |
| `archived` | `manufacturer_checkout` (unarchive correction only) |

`transitionVehicle(vehicle, target, readings)` computes the path (check-in
always passes through `checked_in`), writes one `vehicle_status_history` row per
hop and applies readings on the final hop. Any other combination throws
`invalid_transition`.

Clients can never set `status` directly. Manual creation and import always
produce `announced`; admin correction is a separate audited function.

## Shared validation helpers

| Function | Rule |
|---|---|
| `requireCategoryReadings(vehicle, odometer, hours, fields)` | Category `meter_mode` decides: `odometer` → odometer required, hours rejected; `hours` → inverse; `both` → both required; `none` → both rejected |
| `allowOptionalCategoryReadings(...)` | Same but readings are optional (maintenance) |
| `requireReadingsDoNotDecrease(vehicle, odometer, hours)` | New value must be ≥ `vehicle.current_*`; error `reading_decreased` |
| `requireNotFuture(timestamp, field)` | `timestamp ≤ now + 5 min` clock tolerance |
| `requireActiveCompany(company, allowedTypes, field, required)` | Company exists, `is_active`, `company_type ∈ allowedTypes` |
| `requireActiveDriver(driver, company?)` | Driver active; if driver has a company it must equal the selected company, be active and be `subcontractor|internal` |
| `resolveConditionOutcome(vehicle, outcome, damages)` | `fit` with damages → error; `new_damage` without damages → error; `maintenance` without notes → error. Target: `maintenance` → `maintenance`; else `damaged` if new or unresolved damage exists, else `available` |
| `attachStagedMedia(mediaIds, {actor, allowedTypes, relation})` | Every id must exist, be staged (`attached_at IS NULL`, not discarded), uploaded by `actor`, of an allowed type; returns rows to update in the batch |
| `createDamageReports(payloads, relation)` | Each: `description` required, `severity` default `unknown`, `discovered_at ≤ now`, photos via `attachStagedMedia` |
| `buildSnapshot(kind, …)` | See `04-data-model.md` |
| `enqueueDocument(kind, recordId, language)` | Inserts `documents` row (`pending`, `protocol_number` from sequence `doc_{kind}`) and sends a `pdf.render` queue message after the batch commits |
| `audit(action, entity, before, after)` | Adds an `audit_log` insert to the batch |
| `idempotent(scope, key, fingerprint, fn)` | Looks up `idempotency_keys`; same key+fingerprint+user → replay stored record (`200`); same key different fingerprint → `409 idempotency_conflict`; else run `fn` and store |

All errors are `DomainError { status, code, field?, message_key, params }`
and are rendered as

```json
{"error":{"code":"validation_failed","message":"…localised…","details":{"odometer_km":[{"code":"reading_required","message":"…"}]}}}
```

## 1. Arrival: announce vehicles

### `vehicles.create(input)` – admin

Creates an `announced` vehicle. Input: `category_id`, `manufacturer`, `model`,
optional `internal_number` (else generated `FZ-nnnnn`), `external_key`,
`serial_number`, `license_plate`, `current_location`, `notes`,
`manufacturer_return_due`, `initial_odometer_km`, `initial_operating_hours`,
`media_file_ids` (photos), `initial_damage_reports[]`.
Validation: category active; uniqueness of number/serial/plate/external key;
readings non-negative and category applicable.
Batch: insert vehicle (+ `qr_code`), attach media, insert damages
(`workflow_phase=general`), status history (`null → announced`, source
`manual`), audit `vehicle.created`.

### Excel import – see `08-excel-import.md`

Produces `announced` vehicles or updates master data of existing ones.

## 2. Check-in (delivery acceptance)

### `checkIn.complete(input)` – user

Input:

```ts
{
  vehicle_id: string,
  supplier_company_id: string,          // required, type supplier|manufacturer
  performed_at?: string,                // default now
  odometer_km?: number, operating_hours?: number,
  condition_outcome: 'fit'|'new_damage'|'maintenance',
  condition_notes?: string,             // required when outcome = maintenance
  damage_reports?: { description, severity?, discovered_at?, media_file_ids?[] }[],
  media_file_ids?: string[],            // photos + optional signature
  language?: 'de'|'en'
}
```

Preconditions: `vehicle.status = announced`, not archived.
Validation: `requireActiveCompany(supplier, {supplier, manufacturer})`,
`requireCategoryReadings`, `requireReadingsDoNotDecrease`, `requireNotFuture`,
`resolveConditionOutcome`. Photo policy: at least
`settings.check_in.min_photos` (default 1) photos attached. Signature optional
(`settings.check_in.signature_required`, default false).
Batch:

1. insert `check_in_protocols` with snapshot;
2. insert damage reports (`workflow_phase=check_in`) + attach their photos;
3. attach general media (`related_type=check_in_protocol`);
4. `transitionVehicle(announced → checked_in → target)` with readings;
5. if outcome `maintenance`: insert `maintenance_records` (`source=check_in`,
   reason = condition_notes, start snapshot);
6. `documents` row `check_in`/language, `pending`;
7. audit `workflow.check_in.completed` (before/after vehicle snapshot, protocol
   id, damage ids), `damage.created` per damage, `media.attached` per file.

Idempotent via `Idempotency-Key` (scope `check_in`).
Response: protocol + vehicle + `document {id, status}` + capabilities.

### `checkIn.createAndComplete(input)` – user

Same as above plus vehicle master fields. Creates the `announced` vehicle and
completes check-in in the same batch. Used when a vehicle arrives that was not
imported. Audit adds `vehicle.created` and
`workflow.create_and_check_in.completed`.

## 3. Loan checkout

### `loans.checkout(input)` – user

```ts
{
  vehicle_id: string,
  reservation_id?: string,
  company_id?: string,                  // subcontractor | internal
  driver_id?: string,
  borrower_name: string, borrower_phone: string,   // prefilled from driver/reservation
  expected_return_at: string,           // > now
  checkout_odometer_km?: number, checkout_operating_hours?: number,
  checkout_notes?: string,
  damage_reports?: [...],               // pre-existing damage noted at handover
  media_file_ids: string[],             // photos + REQUIRED signature
  language?: 'de'|'en'
}
```

Preconditions: `status = available`, no active loan (unique index is the last
line of defence).
Validation:

- `requireActiveCompany(company, {subcontractor, internal}, required=false)`;
  `requireActiveDriver(driver, company)`; borrower name and phone non-empty.
- `expected_return_at > now`.
- `requireCategoryReadings`, `requireReadingsDoNotDecrease`.
- Signature: at least one attached media of type `signature`
  (`loan.signature_required` = true, not configurable off).
- Photos: at least `settings.loan.min_photos` (default 2, e.g. front/back).
- Reservation handling (`reservations.validateForCheckout`):
  - if `reservation_id` given: must be `active`, same vehicle,
    `now ≥ start_at − early_handover_hours` (setting, default 2),
    `now ≤ end_at`, `expected_return_at ≤ end_at`; party fields must match the
    reservation snapshot or be empty (then prefilled).
  - other active reservations of the vehicle with `start_at ≤ now +
    early_handover_hours` **block** checkout (`reservation_conflict`);
    reservations starting before `expected_return_at` produce `warnings[]`.

Batch: insert loan (`checked_out_at = now`, snapshot), insert damages
(`loan_checkout`), attach media, `transitionVehicle(available → loaned)`,
update reservation → `fulfilled` (`fulfilled_at/by`, `loan_id`), document
`loan_checkout`, audits `workflow.loan_checkout.completed`,
`reservation.fulfilled`.

## 4. Loan return

### `loans.return(loanId, input)` – user

```ts
{
  condition_outcome: 'fit'|'new_damage'|'maintenance',
  actual_return_at?: string,            // default now; ≥ checked_out_at, ≤ now
  return_odometer_km?: number, return_operating_hours?: number,
  return_notes?: string,                // required for maintenance
  damage_reports?: [...],
  media_file_ids?: string[],            // photos; signature if policy requires
  language?: 'de'|'en'
}
```

Preconditions: loan `active`; vehicle `loaned`.
Validation: readings category-applicable, ≥ vehicle current, ≥ loan checkout
readings (`return_below_checkout`); `resolveConditionOutcome` considering
**pre-existing unresolved damage** (a vehicle with open damage never returns
to `available`); signature required if `settings.loan.return_signature_required`.
Batch: update loan (`returned`, readings, notes, outcome, `actual_return_at`,
`returned_by`, return snapshot incl. `usage_delta`), insert damages
(`loan_return`), attach media, `transitionVehicle(loaned → target)`, optional
maintenance record (`source=loan_return`), document `loan_return`, audit
`workflow.loan_return.completed`.

### `loans.returnContext(loanId)` – read

Returns immutable checkout data (borrower, readings, photos, signature
thumbnail if allowed), vehicle meter baseline, open damages, expected return,
overdue flag, `signature_required`.

## 5. Reservations

### `reservations.create(input)` – user

Exactly one party mode: `driver_id` (+ optional company), `company_id`
(uses its contact), or `reserved_for` + `manual_phone`. `end_at > start_at`,
`end_at > now`. Vehicle not archived / not `manufacturer_checkout` /
`announced`. Overlap with another `active` reservation → `reservation_overlap`
(the DO serialises this check). Snapshot stores the party identity. Audit
`reservation.created`.

### `reservations.update(id, {start_at, end_at, notes})`

Only `active` reservations; party is immutable (replace instead). Overlap
re-checked. Audit `reservation.edited`.

### `reservations.cancel(id, reason)` / `reservations.markNoShow(id)`

Cancel any active reservation; no-show only after `start_at`. Audit.

### Cron: `reservations.expire()`

Active reservations with `end_at < now − 24 h` and no loan → `no_show`
(system actor) so they stop blocking checkouts.

## 6. Maintenance

### `maintenance.start(vehicleId, {reason, notes?, performed_at?, odometer_km?, operating_hours?, media_file_ids?})`

Status `available|damaged`, no active loan, no active maintenance. Readings
optional but category-applicable and non-decreasing. Photos only.
Batch: insert record (`active`, start snapshot), attach media,
`transitionVehicle(→ maintenance)`, document `maintenance_start` (PDF optional
per `settings.documents.maintenance_pdf`), audit `workflow.maintenance.started`.

### `maintenance.complete(vehicleId, {notes?, performed_at?, readings?, media_file_ids?})`

Vehicle `maintenance` with active record; `performed_at ≥ started_at`.
Target = `damaged` if unresolved damage exists else `available`.
Batch: update record (`completed`, completion snapshot), attach media,
transition, document `maintenance_complete`, audit.

## 7. Damage reports

### `damages.create(vehicleId, {description, severity?, discovered_at?, media_file_ids?})`

Ad-hoc damage (phase `general`) on any non-announced, non-archived vehicle.
If vehicle is `available`, it transitions to `damaged`; if `loaned` or
`maintenance` it stays and the damage is considered on return/completion.
Audit `damage.created`.

### `damages.update(id, {description?, severity?})`

Only unresolved reports; relationships immutable. Audit `damage.updated`.

### `damages.resolve(id, {resolution_notes, media_file_ids?})`

Sets `resolved_at/by`, notes (write-once). If it was the last open damage and
vehicle is `damaged` with no active loan/maintenance → `available`.
Audit `damage.resolved`, status history `damage_resolved`.

## 8. Manufacturer check-out (return to manufacturer/supplier)

### `manufacturerCheckout.complete(input)` – user

```ts
{
  vehicle_id, recipient_company_id,      // required, manufacturer|supplier
  performed_at?, odometer_km?, operating_hours?, condition_notes?,
  damage_reports?, media_file_ids,       // photos required (min 2), signature optional/policy
  language?
}
```

Preconditions: status `available|damaged`, no active loan (`loaned`,
`maintenance`, `announced`, `checked_in`, archived → rejected with specific
codes). Validation as check-in, except that the condition outcome is limited
to `fit` / `new_damage` (a `maintenance` outcome makes no sense for a vehicle
leaving the pool). The wizard warns when `manufacturer_return_due` is not yet
reached or open reservations exist. Batch: insert protocol + snapshot, damages
(`manufacturer_checkout`), media, `transitionVehicle(→ manufacturer_checkout)`,
document `manufacturer_checkout`, audit
`workflow.manufacturer_checkout.completed`. Open reservations for this vehicle
are cancelled with reason `vehicle_returned_to_manufacturer` (audited).

### `vehicles.archive(id, reason)` – admin

Only `manufacturer_checkout`. Sets `archived_at/by/reason`,
`archive_previous_status`. Audit `vehicle.archived`.

### `vehicles.unarchive(id, reason)` – admin

Only `archived`; restores `manufacturer_checkout`; refuses if an active loan
or maintenance somehow exists. Audit `vehicle.unarchived`.

## 9. Admin corrections

### `vehicles.adminCorrect(id, {status?, odometer_km?, operating_hours?, reason})` – admin

- Target status ∈ {`announced`, `checked_in`, `available`, `damaged`,
  `maintenance`}; `loaned`, `manufacturer_checkout`, `archived` are
  workflow-only.
- Active loan → only `loaned` allowed (i.e. refuse); active maintenance → only
  `maintenance`; open damage → cannot become `available`.
- Meter values may **decrease** here (only place where that is allowed).
- Status history `admin_correction`; audit `vehicle.admin_corrected` with
  reason.

### `loans.cancel(id, reason)` – admin

Cancels an active loan created by mistake (within `settings.loan.cancel_window_hours`,
default 24). Vehicle returns to its pre-loan status (`available`). Audit
`loan.cancelled`. Not a return: no readings, no PDF.

## 10. Master data

- `categories.create/update/deactivate/reactivate` – deactivation is refused
  while announced/checked-in/available vehicles reference it unless
  `force=true` (then existing vehicles keep the category; it is just hidden in
  forms). `vehicle_count` is returned.
- `companies.create/update/deactivate`, `companies.duplicates()` (normalised
  name + phone/e-mail similarity), `companies.merge(sourceId, targetId,
  confirmation_token)` – two-step: preview returns a signed token (HMAC, 10
  min) with impact counts; confirmation reassigns loans, reservations,
  drivers, protocols; source gets `is_active=0`, `merged_into_id`. Audit
  `company.merged`.
- `drivers.*` analogous. Delete is not offered; deactivate instead.
- `users.*` see `03-roles-and-permissions.md`.

## 11. QR quick access

- `qr_code` is generated on vehicle creation (`VH-` + 10 chars from
  `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`), unique, immutable.
- Public URL `{settings.public_base_url}/v/{qr_code}` is encoded in labels.
- `GET /api/v1/public/qr/{code}` (no session, rate limited, enabled by
  `settings.qr.public_status_page`, default on) returns only non-sensitive
  identity + status data (number, category, manufacturer, model, plate,
  serial, location, status) so anybody scanning a label sees what the machine
  is and whether it is available. No borrower, loan or user data.
- `GET /api/v1/qr/{code}` (authenticated) resolves to the full vehicle with
  capabilities and next actions → the SPA shows the "what do you want to do
  with this vehicle" action sheet. The public page offers "Sign in" and keeps
  the deep link.
- `vehicles.scheduleManufacturerReturn(id, {manufacturer_return_due, note})`
  – user: sets/clears the due date that feeds the *manufacturer returns due*
  task group; audit `vehicle.manufacturer_return_scheduled`.
- Label print: single label from vehicle detail; bulk sheet (admin) as HTML
  print view (A4 grid, 3×8 labels, QR SVG rendered client-side with
  `qrcode` lib) with internal number, category, model.

## 12. Workflow drafts (resumable wizards)

`drafts.upsert({workflow_type, scope_key, object_id?, form_data, staged_media_ids, step, expected_version?})`

- Identity `owner + workflow_type + scope_key`; first save → `201` version 1;
  later saves need `expected_version`; mismatch → `409 version_conflict` with
  current draft.
- `form_data` ≤ 64 KB; rejected if it contains `data:image` strings
  (signatures must be staged media).
- `expires_at = now + settings.drafts.ttl_hours` (default 72).
- `drafts.discard(id)` deletes the draft and discards staged media that no
  other draft references.
- Cron `drafts.expire()` does the same for expired drafts (audit
  `workflow_draft.expired`).
- Drafts never touch vehicle state.

## 13. Background jobs (Queue `flarefleet-jobs`)

| Message | Producer | Consumer behaviour |
|---|---|---|
| `pdf.render {documentId}` | every workflow completion, document retry | load snapshot → render HTML → `BROWSER` PDF → pdf-lib metadata → R2 → `documents.status=generated`, `media_files` row (`pdf`, `is_generated`) → audit `pdf.generated`. On error: `attempts++`, `last_error`, retry with backoff (max 5) → `failed` + audit `pdf.generation_failed` |
| `media.derive {mediaId}` | photo upload | `IMAGES` thumbnail 320 px → R2 `.thumb.jpg` → update `thumbnail_r2_key` |
| `export.csv {exportId}` | audit/register/import exports | stream rows → CSV → R2 → `exports.status=ready` |
| `notify {kind, payload}` | overdue detection, invitations | e-mail via configured provider (optional) |

## 14. Scheduled jobs (Cron Triggers)

| Schedule | Job |
|---|---|
| `*/15 * * * *` | expire drafts; discard staged media older than `settings.media.staged_ttl_hours` (default 48) not referenced by a draft; mark reservations no-show; recompute `overdue` task counts cache |
| `0 3 * * *` | retention: purge sessions/idempotency keys/exports; reconcile document register (every completed workflow has a document row; re-enqueue `pending` older than 1 h); verify random sample of R2 objects against `content_sha256` (integrity report to audit `system.integrity_check`) |

## 15. Dashboard and tasks (read models)

`dashboard.summary()` – counts per status (fleet total excludes
`manufacturer_checkout` and `archived`), active loans, overdue loans (now >
`expected_return_at`), `utilization_pct` = loaned / operational fleet, returns
due within 24 h, open damages, active maintenance, announced arrivals,
documents failed, `available_by_category`, `checkouts_series` (loans per day,
last 14 days), upcoming reservations with a `conflict` flag (reservation due
while the vehicle is loaned to a different party), recent activity (last 20
audit rows relevant to vehicles).

`dashboard.tasks(limit ≤ 100 per group)` – groups with direct actions:

| Group | Query |
|---|---|
| `arrivals_awaiting_check_in` | vehicles `announced` ordered by `created_at` |
| `overdue_returns` | loans `active` with `expected_return_at < now` |
| `returns_due_today` | loans `active` with `expected_return_at` within 24 h |
| `reservation_handovers` | reservations `active` with `start_at` within `early_handover_hours` |
| `condition_attention` | vehicles `damaged` or `maintenance` |
| `manufacturer_returns_due` | vehicles with `manufacturer_return_due ≤ today + settings.tasks.return_due_lookahead_days` (default 14) and status ∈ {available, damaged} (eligible for the workflow); loaned/maintenance vehicles with a due date appear in `condition_attention`/`overdue_returns` context instead |
| `failed_documents` | documents `failed` or `pending` older than 1 h |
| `stale_drafts` (own) | drafts of the current user expiring within 24 h |
