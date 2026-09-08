# 04 – Data Model (D1, R2, KV, Durable Objects)

## Conventions

- Primary keys are UUID v4 strings (`TEXT`), generated in the Worker with
  `crypto.randomUUID()`.
- Timestamps are ISO-8601 UTC strings (`TEXT`, e.g. `2026-09-08T13:22:05.123Z`)
  so they sort lexically and compare correctly in SQL. Dates without time
  (`manufacturer_return_due`) are `YYYY-MM-DD`.
- Booleans are `INTEGER` 0/1. Enum codes are `TEXT` with `CHECK` constraints.
- Operating hours are `REAL` rounded to one decimal in the application;
  odometer is `INTEGER` km.
- Every domain table has `created_at`, `updated_at`. Write-once columns
  (snapshots, resolution evidence) are protected by triggers that `RAISE(ABORT)`
  when a non-null value would change.
- JSON columns are `TEXT` validated with `json_valid()` checks and parsed with
  Zod in the Worker.
- Schema is managed with Drizzle (`apps/worker/src/db/schema.ts`) and applied
  with `wrangler d1 migrations apply`.

## Entity overview

```text
users ──┐
        ├─< sessions
        ├─< audit_log (actor)
settings

vehicle_categories ──< vehicles ──< vehicle_status_history
                              ├──< check_in_protocols ──< damage_reports
                              ├──< loans ─────────────< damage_reports
                              │      └── reservations (1:1 when fulfilled)
                              ├──< reservations
                              ├──< maintenance_records
                              ├──< manufacturer_checkout_protocols ──< damage_reports
                              ├──< damage_reports
                              └──< media_files
companies ──< drivers
companies ──< loans / reservations / check_in_protocols(supplier) / manufacturer_checkout_protocols(recipient)
documents (generated PDFs) ──> media_files
import_jobs ──< import_rows
workflow_drafts
idempotency_keys
exports
sequences
```

## DDL

```sql
-- ---------------------------------------------------------------- accounts
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT UNIQUE COLLATE NOCASE,
  full_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('super_admin','admin','user')),
  can_execute_workflows INTEGER NOT NULL DEFAULT 1,
  password_hash TEXT,                      -- NULL when auth mode is Cloudflare Access only
  must_change_password INTEGER NOT NULL DEFAULT 0,
  temporary_password_expires_at TEXT,
  language TEXT NOT NULL DEFAULT 'de' CHECK (language IN ('de','en')),
  is_active INTEGER NOT NULL DEFAULT 1,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (                    -- metadata mirror of the KV session
  id TEXT PRIMARY KEY,                     -- sha256(session token)
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip TEXT, user_agent TEXT,
  revoked_at TEXT, revoked_by TEXT REFERENCES users(id), revoke_reason TEXT
);
CREATE INDEX sessions_user_idx ON sessions(user_id, revoked_at);

CREATE TABLE settings (                    -- see 11-settings.md
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL CHECK (json_valid(value)),
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL
);

-- ---------------------------------------------------------------- master data
CREATE TABLE vehicle_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  meter_mode TEXT NOT NULL DEFAULT 'both' CHECK (meter_mode IN ('odometer','hours','both','none')),
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE sequences (
  name TEXT PRIMARY KEY,
  next_value INTEGER NOT NULL
);
INSERT INTO sequences(name, next_value) VALUES ('fleet', 1);

CREATE TABLE vehicles (
  id TEXT PRIMARY KEY,
  internal_number TEXT NOT NULL UNIQUE COLLATE NOCASE,       -- FZ-00001, generated when blank
  qr_code TEXT NOT NULL UNIQUE,                               -- VH-XXXXXXXXXX (no 0/O/1/I)
  external_key TEXT UNIQUE,                                   -- stable import key
  category_id TEXT NOT NULL REFERENCES vehicle_categories(id),
  manufacturer TEXT NOT NULL,
  model TEXT NOT NULL,
  serial_number TEXT,                                         -- unique when present (partial index)
  license_plate TEXT,
  status TEXT NOT NULL DEFAULT 'announced' CHECK (status IN
    ('announced','checked_in','available','loaned','maintenance','damaged','manufacturer_checkout','archived')),
  current_odometer_km INTEGER CHECK (current_odometer_km IS NULL OR current_odometer_km >= 0),
  current_operating_hours REAL CHECK (current_operating_hours IS NULL OR current_operating_hours >= 0),
  current_location TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  manufacturer_return_due TEXT,                               -- YYYY-MM-DD
  expected_arrival_on TEXT,                                   -- YYYY-MM-DD, from import; drives the arrivals task list
  archived_at TEXT, archived_by TEXT REFERENCES users(id),
  archive_reason TEXT NOT NULL DEFAULT '',
  archive_previous_status TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX vehicles_serial_uq ON vehicles(serial_number) WHERE serial_number IS NOT NULL AND serial_number <> '';
CREATE UNIQUE INDEX vehicles_plate_uq  ON vehicles(license_plate)  WHERE license_plate  IS NOT NULL AND license_plate  <> '';
CREATE INDEX vehicles_status_idx ON vehicles(status, updated_at DESC);
CREATE INDEX vehicles_category_status_idx ON vehicles(category_id, status);
CREATE INDEX vehicles_return_due_idx ON vehicles(manufacturer_return_due) WHERE manufacturer_return_due IS NOT NULL;

CREATE TABLE vehicle_status_history (       -- one row per status change (timeline + reporting)
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  from_status TEXT, to_status TEXT NOT NULL,
  source_type TEXT NOT NULL,                -- check_in | loan_checkout | loan_return | manufacturer_checkout | maintenance_start | maintenance_complete | damage_resolved | admin_correction | archive | unarchive | import
  source_id TEXT,
  actor_id TEXT REFERENCES users(id),
  occurred_at TEXT NOT NULL
);
CREATE INDEX vsh_vehicle_idx ON vehicle_status_history(vehicle_id, occurred_at DESC);

CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  company_type TEXT NOT NULL CHECK (company_type IN ('subcontractor','manufacturer','supplier','internal')),
  contact_name TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  merged_into_id TEXT REFERENCES companies(id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX companies_type_active_idx ON companies(company_type, is_active, name);

CREATE TABLE drivers (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id),
  first_name TEXT NOT NULL, last_name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
  license_classes TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  merged_into_id TEXT REFERENCES drivers(id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX drivers_name_idx ON drivers(is_active, last_name, first_name);

-- ---------------------------------------------------------------- workflows
CREATE TABLE check_in_protocols (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  performed_by TEXT NOT NULL REFERENCES users(id),
  performed_at TEXT NOT NULL,
  supplier_company_id TEXT REFERENCES companies(id),
  odometer_km INTEGER, operating_hours REAL,
  condition_outcome TEXT NOT NULL CHECK (condition_outcome IN ('fit','new_damage','maintenance')),
  condition_notes TEXT NOT NULL DEFAULT '',
  snapshot TEXT NOT NULL CHECK (json_valid(snapshot)),      -- immutable evidence, see 05
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX checkin_vehicle_idx ON check_in_protocols(vehicle_id, performed_at DESC);

CREATE TABLE loans (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  company_id TEXT REFERENCES companies(id),
  driver_id TEXT REFERENCES drivers(id),
  borrower_name TEXT NOT NULL, borrower_phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','returned','cancelled')),
  checked_out_at TEXT NOT NULL,
  expected_return_at TEXT NOT NULL,
  actual_return_at TEXT,
  checkout_odometer_km INTEGER, checkout_operating_hours REAL,
  return_odometer_km INTEGER,   return_operating_hours REAL,
  checkout_notes TEXT NOT NULL DEFAULT '', return_notes TEXT NOT NULL DEFAULT '',
  return_condition_outcome TEXT CHECK (return_condition_outcome IN ('fit','new_damage','maintenance')),
  checkout_snapshot TEXT NOT NULL CHECK (json_valid(checkout_snapshot)),
  return_snapshot TEXT CHECK (return_snapshot IS NULL OR json_valid(return_snapshot)),
  created_by TEXT NOT NULL REFERENCES users(id),
  returned_by TEXT REFERENCES users(id),
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX loans_one_active_per_vehicle ON loans(vehicle_id) WHERE status = 'active';
CREATE INDEX loans_status_expected_idx ON loans(status, expected_return_at);
CREATE INDEX loans_vehicle_idx ON loans(vehicle_id, created_at DESC);

CREATE TABLE reservations (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  start_at TEXT NOT NULL, end_at TEXT NOT NULL CHECK (end_at > start_at),
  driver_id TEXT REFERENCES drivers(id),
  company_id TEXT REFERENCES companies(id),
  reserved_for TEXT NOT NULL DEFAULT '', manual_phone TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled','fulfilled','no_show')),
  snapshot TEXT NOT NULL CHECK (json_valid(snapshot)),      -- immutable party snapshot
  fulfilled_at TEXT, fulfilled_by TEXT REFERENCES users(id),
  loan_id TEXT UNIQUE REFERENCES loans(id),
  cancelled_at TEXT, cancelled_by TEXT REFERENCES users(id), cancel_reason TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX reservations_overlap_idx ON reservations(vehicle_id, status, start_at, end_at);
CREATE INDEX reservations_status_start_idx ON reservations(status, start_at);

CREATE TABLE manufacturer_checkout_protocols (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  performed_by TEXT NOT NULL REFERENCES users(id),
  performed_at TEXT NOT NULL,
  recipient_company_id TEXT REFERENCES companies(id),
  odometer_km INTEGER, operating_hours REAL,
  condition_notes TEXT NOT NULL DEFAULT '',
  snapshot TEXT NOT NULL CHECK (json_valid(snapshot)),
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX mco_vehicle_idx ON manufacturer_checkout_protocols(vehicle_id, performed_at DESC);

CREATE TABLE maintenance_records (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed')),
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  start_notes TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL, started_by TEXT NOT NULL REFERENCES users(id),
  start_odometer_km INTEGER, start_operating_hours REAL,
  start_snapshot TEXT NOT NULL CHECK (json_valid(start_snapshot)),
  source TEXT NOT NULL DEFAULT 'manual',    -- manual | check_in | loan_return
  completion_notes TEXT NOT NULL DEFAULT '',
  completed_at TEXT, completed_by TEXT REFERENCES users(id),
  completion_odometer_km INTEGER, completion_operating_hours REAL,
  completion_snapshot TEXT CHECK (completion_snapshot IS NULL OR json_valid(completion_snapshot)),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX maintenance_one_active_per_vehicle ON maintenance_records(vehicle_id) WHERE status = 'active';

CREATE TABLE damage_reports (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  workflow_phase TEXT NOT NULL DEFAULT 'general' CHECK (workflow_phase IN
    ('general','check_in','loan_checkout','loan_return','manufacturer_checkout','maintenance')),
  loan_id TEXT REFERENCES loans(id),
  check_in_protocol_id TEXT REFERENCES check_in_protocols(id),
  manufacturer_checkout_protocol_id TEXT REFERENCES manufacturer_checkout_protocols(id),
  maintenance_record_id TEXT REFERENCES maintenance_records(id),
  description TEXT NOT NULL CHECK (length(trim(description)) > 0),
  severity TEXT NOT NULL DEFAULT 'unknown' CHECK (severity IN ('minor','major','critical','unknown')),
  discovered_at TEXT NOT NULL,
  resolved_at TEXT, resolved_by TEXT REFERENCES users(id),
  resolution_notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK ((loan_id IS NOT NULL) + (check_in_protocol_id IS NOT NULL)
       + (manufacturer_checkout_protocol_id IS NOT NULL) + (maintenance_record_id IS NOT NULL) <= 1)
);
CREATE INDEX damage_open_idx ON damage_reports(vehicle_id, resolved_at, discovered_at DESC);

-- ---------------------------------------------------------------- media & documents
CREATE TABLE media_files (
  id TEXT PRIMARY KEY,
  media_type TEXT NOT NULL CHECK (media_type IN ('photo','signature','pdf','import','export')),
  r2_key TEXT NOT NULL UNIQUE,
  thumbnail_r2_key TEXT,
  original_filename TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  width INTEGER, height INTEGER,
  content_sha256 TEXT NOT NULL,
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  -- staging lifecycle
  attached_at TEXT,                          -- NULL while staged
  related_type TEXT,                         -- vehicle | check_in_protocol | loan_checkout | loan_return | manufacturer_checkout_protocol | maintenance_start | maintenance_complete | damage_report | reservation | document | import_job | export
  related_id TEXT,
  vehicle_id TEXT REFERENCES vehicles(id),   -- denormalised for "vehicle media" queries
  loan_id TEXT REFERENCES loans(id),
  damage_report_id TEXT REFERENCES damage_reports(id),
  caption TEXT NOT NULL DEFAULT '',
  is_generated INTEGER NOT NULL DEFAULT 0,
  discarded_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX media_related_idx ON media_files(related_type, related_id);
CREATE INDEX media_vehicle_idx ON media_files(vehicle_id, created_at);
CREATE INDEX media_staged_idx ON media_files(attached_at, discarded_at, created_at) WHERE attached_at IS NULL;

CREATE TABLE documents (                    -- generated PDF protocols (document register)
  id TEXT PRIMARY KEY,
  document_type TEXT NOT NULL CHECK (document_type IN
    ('check_in','loan_checkout','loan_return','manufacturer_checkout','maintenance_start','maintenance_complete')),
  record_id TEXT NOT NULL,                   -- protocol / loan / maintenance id
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  language TEXT NOT NULL CHECK (language IN ('de','en')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','generated','failed')),
  media_id TEXT REFERENCES media_files(id),
  protocol_number TEXT NOT NULL UNIQUE,      -- e.g. CI-2026-000123
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  requested_by TEXT REFERENCES users(id),
  generated_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (document_type, record_id, language)
);
CREATE INDEX documents_status_idx ON documents(status, updated_at);
CREATE INDEX documents_vehicle_idx ON documents(vehicle_id, created_at DESC);

-- ---------------------------------------------------------------- drafts, imports, exports
CREATE TABLE workflow_drafts (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  workflow_type TEXT NOT NULL CHECK (workflow_type IN
    ('check_in','loan_checkout','loan_return','manufacturer_checkout','reservation','maintenance')),
  scope_key TEXT NOT NULL DEFAULT '',
  object_id TEXT,
  form_data TEXT NOT NULL CHECK (json_valid(form_data)),
  staged_media_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(staged_media_ids)),
  step INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (owner_id, workflow_type, scope_key)
);
CREATE INDEX drafts_expiry_idx ON workflow_drafts(expires_at);

CREATE TABLE import_jobs (
  id TEXT PRIMARY KEY,
  import_type TEXT NOT NULL DEFAULT 'vehicles' CHECK (import_type IN ('vehicles')),
  status TEXT NOT NULL CHECK (status IN ('uploaded','validating','validated','failed','committing','committed','aborted')),
  source_media_id TEXT NOT NULL REFERENCES media_files(id),
  original_filename TEXT NOT NULL,
  column_mapping TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(column_mapping)),
  header_report TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(header_report)),  -- detected columns, missing, unmapped
  row_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  excluded_count INTEGER NOT NULL DEFAULT 0,
  create_count INTEGER NOT NULL DEFAULT 0,
  update_count INTEGER NOT NULL DEFAULT 0,
  progress TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(progress)),
  validation_fingerprint TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  committed_at TEXT, committed_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE import_rows (
  job_id TEXT NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)),               -- normalised values
  present_fields TEXT NOT NULL CHECK (json_valid(present_fields)),
  errors TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(errors)),
  diff TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(diff)),
  duplicate_candidates TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(duplicate_candidates)),
  supplier_proposal TEXT CHECK (supplier_proposal IS NULL OR json_valid(supplier_proposal)),
  action TEXT NOT NULL CHECK (action IN ('create','update','skip','error')),
  matched_vehicle_id TEXT REFERENCES vehicles(id),
  excluded INTEGER NOT NULL DEFAULT 0,
  fingerprint TEXT NOT NULL,
  committed_vehicle_id TEXT REFERENCES vehicles(id),
  PRIMARY KEY (job_id, row_number)
);

CREATE TABLE exports (
  id TEXT PRIMARY KEY,
  export_type TEXT NOT NULL,                 -- audit_csv | documents_csv | import_errors_csv | import_ids_csv | vehicles_csv
  filters TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(filters)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','failed')),
  media_id TEXT REFERENCES media_files(id),
  requested_by TEXT NOT NULL REFERENCES users(id),
  error TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE idempotency_keys (
  scope TEXT NOT NULL,                       -- route family, e.g. "check_in"
  key TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  request_fingerprint TEXT NOT NULL,
  record_id TEXT,
  response_status INTEGER,
  created_at TEXT NOT NULL,
  PRIMARY KEY (scope, key)
);

-- ---------------------------------------------------------------- audit
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,                       -- ULID for time ordering
  actor_id TEXT REFERENCES users(id),        -- NULL for system/cron/queue
  actor_label TEXT NOT NULL DEFAULT '',      -- denormalised username at the time
  action TEXT NOT NULL,                      -- see 10-protocol-and-audit.md
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  vehicle_id TEXT,                           -- denormalised for vehicle timelines
  before TEXT CHECK (before IS NULL OR json_valid(before)),
  after  TEXT CHECK (after  IS NULL OR json_valid(after)),
  request_id TEXT, ip TEXT, user_agent TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX audit_entity_idx  ON audit_log(entity_type, entity_id, created_at DESC);
CREATE INDEX audit_vehicle_idx ON audit_log(vehicle_id, created_at DESC);
CREATE INDEX audit_actor_idx   ON audit_log(actor_id, created_at DESC);
CREATE INDEX audit_action_idx  ON audit_log(action, created_at DESC);
```

### Write-once protection (triggers)

```sql
CREATE TRIGGER loans_snapshot_write_once BEFORE UPDATE ON loans
WHEN OLD.checkout_snapshot IS NOT NULL AND NEW.checkout_snapshot <> OLD.checkout_snapshot
BEGIN SELECT RAISE(ABORT, 'checkout_snapshot is immutable'); END;
-- analogous triggers: loans.return_snapshot, check_in_protocols.snapshot,
-- manufacturer_checkout_protocols.snapshot, maintenance_records.start_snapshot /
-- completion_snapshot, reservations.snapshot, damage_reports.resolved_at/resolution_notes,
-- audit_log (BEFORE UPDATE / BEFORE DELETE always abort)
```

## Snapshot JSON shapes

All workflow snapshots share `schema_version`, `workflow_type`, `record_id`,
`performed_at`, `performed_by {id, username, display_name}`, `vehicle {id,
internal_number, qr_code, category{id,name,meter_mode}, manufacturer, model,
serial_number, license_plate, status_before, status_after, current_location}`,
`readings {odometer_km, operating_hours}`, `notes`, `damages[] {id,
description, severity, discovered_at, media[]}`, `media[] {id, media_type,
original_filename, content_sha256, caption}`, `signatures[]` (subset of media).
Workflow-specific additions:

| Workflow | Extra fields |
|---|---|
| check_in | `party` (supplier company snapshot), `condition_outcome` |
| loan_checkout | `borrower {name, phone, driver_id, company}`, `expected_return_at`, `reservation` (party snapshot) |
| loan_return | `borrower`, `actual_return_at`, `condition_outcome`, `checkout_readings`, `usage_delta {km, hours}` |
| manufacturer_checkout | `party` (recipient company snapshot) |
| maintenance_start/complete | `reason`, `source` |

Snapshots never contain image bytes; the PDF renderer loads images from R2 by
`media.id` and verifies `content_sha256` before embedding.

## R2 key layout (bucket `flarefleet-media`)

```text
photos/{yyyy}/{mm}/{mediaId}.jpg               original (re-encoded, EXIF stripped, ≤ 2048 px)
photos/{yyyy}/{mm}/{mediaId}.thumb.jpg         320 px thumbnail (queue job)
signatures/{yyyy}/{mm}/{mediaId}.png           signature bitmap as uploaded (max 1 MB)
pdf/{documentType}/{yyyy}/{documentId}.{lang}.pdf
imports/{jobId}/source.xlsx
imports/{jobId}/result.json                    full validation result (may exceed D1 row size)
exports/{exportId}.csv
```

Object metadata: `contentType`, `sha256`, `uploadedBy`, `mediaId`. Bucket has
no public access; downloads stream through `/api/v1/media/{id}/download` with
`Content-Disposition` and `Cache-Control: private, no-store`. A lifecycle rule
deletes `exports/` after 7 days; everything else is retained per
`11-settings.md`.

## KV keys (namespace `flarefleet-kv`)

| Key | Value | TTL |
|---|---|---|
| `sess:{sha256(token)}` | session JSON | sliding 12 h |
| `settings:current` | merged settings JSON + version | 5 min (invalidated on save) |
| `idem:{scope}:{userId}:{key}` | `{fingerprint, status, body}` | 24 h |
| `login:ip:{ip}`, `login:user:{username}` | failed counters | 15 min |
| `export:ticket:{id}` | one-time download ticket → media id | 10 min |
| `maintenance_mode` | `{enabled, message}` | none |

## Durable Object storage

| DO | Keys |
|---|---|
| `VehicleCoordinator` | `inflight` `{op, startedAt, requestId}` (diagnostics only) |
| `ImportJobActor` | `progress` `{phase, processed, total, startedAt}`, `lock` `{by, at}` |
