-- FlareFleet initial schema (D1 / SQLite)

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('super_admin','admin','user')),
  password_hash TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  language TEXT NOT NULL DEFAULT 'de' CHECK (language IN ('de','en')),
  is_active INTEGER NOT NULL DEFAULT 1,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE sequences (
  name TEXT PRIMARY KEY,
  next_value INTEGER NOT NULL
);
INSERT INTO sequences (name, next_value) VALUES ('vehicle', 1), ('protocol', 1);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  meter_mode TEXT NOT NULL DEFAULT 'both' CHECK (meter_mode IN ('odometer','hours','both','none')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  company_type TEXT NOT NULL CHECK (company_type IN ('supplier','subcontractor','internal')),
  contact_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX companies_type_idx ON companies(company_type, is_active, name);

CREATE TABLE drivers (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX drivers_name_idx ON drivers(is_active, name);

CREATE TABLE vehicles (
  id TEXT PRIMARY KEY,
  internal_number TEXT NOT NULL UNIQUE COLLATE NOCASE,
  qr_code TEXT NOT NULL UNIQUE,
  external_key TEXT UNIQUE,
  category_id TEXT NOT NULL REFERENCES categories(id),
  manufacturer TEXT NOT NULL,
  model TEXT NOT NULL,
  serial_number TEXT NOT NULL DEFAULT '',
  license_plate TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'announced' CHECK (status IN
    ('announced','available','loaned','damaged','maintenance','checked_out','archived')),
  odometer_km INTEGER,
  operating_hours REAL,
  location TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  supplier_id TEXT REFERENCES companies(id),
  expected_arrival TEXT,
  return_due TEXT,
  archived_at TEXT,
  archive_reason TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX vehicles_serial_uq ON vehicles(serial_number) WHERE serial_number <> '';
CREATE UNIQUE INDEX vehicles_plate_uq ON vehicles(license_plate) WHERE license_plate <> '';
CREATE INDEX vehicles_status_idx ON vehicles(status, updated_at DESC);
CREATE INDEX vehicles_category_idx ON vehicles(category_id);

CREATE TABLE loans (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  company_id TEXT REFERENCES companies(id),
  driver_id TEXT REFERENCES drivers(id),
  borrower_name TEXT NOT NULL,
  borrower_phone TEXT NOT NULL DEFAULT '',
  borrower_email TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','returned','cancelled')),
  checked_out_at TEXT NOT NULL,
  expected_return_at TEXT NOT NULL,
  actual_return_at TEXT,
  checkout_odometer_km INTEGER,
  checkout_operating_hours REAL,
  return_odometer_km INTEGER,
  return_operating_hours REAL,
  checkout_protocol_id TEXT,
  return_protocol_id TEXT,
  created_by TEXT NOT NULL,
  returned_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX loans_one_active ON loans(vehicle_id) WHERE status = 'active';
CREATE INDEX loans_status_idx ON loans(status, expected_return_at);
CREATE INDEX loans_vehicle_idx ON loans(vehicle_id, created_at DESC);

-- Every workflow step is one protocol row (immutable evidence + PDF).
CREATE TABLE protocols (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN
    ('check_in','loan_checkout','loan_return','check_out','maintenance_start','maintenance_end','damage_resolved','status_correction')),
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  loan_id TEXT REFERENCES loans(id),
  company_id TEXT REFERENCES companies(id),
  performed_by TEXT NOT NULL REFERENCES users(id),
  performed_at TEXT NOT NULL,
  odometer_km INTEGER,
  operating_hours REAL,
  condition TEXT CHECK (condition IS NULL OR condition IN ('ok','damaged','maintenance')),
  notes TEXT NOT NULL DEFAULT '',
  status_before TEXT,
  status_after TEXT,
  snapshot TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'de',
  pdf_status TEXT NOT NULL DEFAULT 'pending' CHECK (pdf_status IN ('pending','generated','failed','none')),
  pdf_media_id TEXT,
  pdf_error TEXT,
  pdf_attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX protocols_vehicle_idx ON protocols(vehicle_id, performed_at DESC);
CREATE INDEX protocols_pdf_idx ON protocols(pdf_status, created_at);
CREATE INDEX protocols_type_idx ON protocols(type, performed_at DESC);

CREATE TRIGGER protocols_snapshot_immutable BEFORE UPDATE OF snapshot, type, vehicle_id, performed_at, performed_by ON protocols
BEGIN SELECT RAISE(ABORT, 'protocol evidence is immutable'); END;

CREATE TABLE damages (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  protocol_id TEXT REFERENCES protocols(id),
  loan_id TEXT REFERENCES loans(id),
  description TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'minor' CHECK (severity IN ('minor','major','critical')),
  reported_by TEXT NOT NULL,
  reported_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT,
  resolution_notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX damages_open_idx ON damages(vehicle_id, resolved_at);

CREATE TABLE media (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('photo','signature','pdf','import')),
  r2_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  uploaded_by TEXT NOT NULL,
  vehicle_id TEXT,
  protocol_id TEXT,
  damage_id TEXT,
  attached_at TEXT,
  discarded_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX media_protocol_idx ON media(protocol_id);
CREATE INDEX media_vehicle_idx ON media(vehicle_id, created_at);
CREATE INDEX media_staged_idx ON media(uploaded_by, attached_at, discarded_at);

CREATE TABLE import_jobs (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  media_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('validated','failed','committed')),
  columns TEXT NOT NULL DEFAULT '{}',
  row_count INTEGER NOT NULL DEFAULT 0,
  valid_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  committed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE import_rows (
  job_id TEXT NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create','update','error')),
  data TEXT NOT NULL,
  errors TEXT NOT NULL DEFAULT '[]',
  matched_vehicle_id TEXT,
  result_vehicle_id TEXT,
  PRIMARY KEY (job_id, row_number)
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  actor_label TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  vehicle_id TEXT,
  details TEXT,
  ip TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX audit_created_idx ON audit_log(created_at DESC);
CREATE INDEX audit_vehicle_idx ON audit_log(vehicle_id, created_at DESC);
CREATE INDEX audit_action_idx ON audit_log(action, created_at DESC);

CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
