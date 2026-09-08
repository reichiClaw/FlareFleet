# 06 – API Reference

Base path `/api/v1`. JSON bodies, UUID ids, ISO-8601 UTC timestamps. All
routes require a session unless marked *public*. Role column shows the minimum
role; `user*` means `user` with `can_execute_workflows = true`.

## Conventions

- Pagination: `?page=1&page_size=25` (max 100) →
  `{ "count": 123, "page": 1, "page_size": 25, "results": [...] }`.
- Sorting: `?ordering=-updated_at`.
- Typeahead: `?q=term&limit=10` → first page only, minimal rows.
- Errors: `{ "error": { "code", "message", "details": { field: [{code,message}] } } }`
  with HTTP `400` validation, `401` unauthenticated, `403` forbidden,
  `404`, `409` conflict (idempotency, version, overlap), `413` too large,
  `423` locked (maintenance mode), `429` rate limited, `503` degraded.
- Headers: `Idempotency-Key` (≤ 128 chars) on workflow completions;
  `X-CSRF-Token` on all mutating requests; `Accept-Language`;
  `X-Request-Id` echoed in responses.
- Every response object for vehicles/loans/reservations/documents contains
  `capabilities` and, for vehicles, `next_actions` (`03-roles-and-permissions.md`).

## Auth & session

| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/auth/login` | public | `{username_or_email, password}` → sets cookie, returns `me` payload. Rate limited |
| POST | `/auth/logout` | any | Revoke current session |
| GET | `/auth/me` | any | User, role, flags, capabilities, `csrf_token`, `language`, `must_change_password`, `settings_public` (branding, languages, policies needed by the SPA) |
| POST | `/auth/password` | any | `{current_password, new_password}`; clears `must_change_password` |
| GET | `/auth/sessions` | any | Own sessions |
| DELETE | `/auth/sessions/{id}` | any | Revoke own session |
| POST | `/auth/access/callback` | public | Cloudflare Access mode: exchange JWT for session |

## Users

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/users` | admin | Filters `role`, `is_active`, `q` |
| POST | `/users` | admin | Create `{username, email?, full_name, role, can_execute_workflows, language, temporary_password?}`; admin may create ≤ `admin`; super admin any. Response includes one-time temporary password if generated |
| GET/PATCH | `/users/{id}` | admin / self (limited fields) | Update profile, role (super admin for `super_admin`), flags |
| POST | `/users/{id}/deactivate` / `reactivate` | admin | Revokes sessions |
| POST | `/users/{id}/temporary-password` | admin | Sets temporary password, `must_change_password=true`, 72 h expiry |
| GET | `/users/{id}/sessions` / DELETE `/users/{id}/sessions` | super_admin | View / revoke all |
| PATCH | `/users/me` | any | `full_name`, `language` |

## Settings (see `11-settings.md`)

| Method | Path | Role |
|---|---|---|
| GET | `/settings` | admin (read, secrets masked) |
| PUT | `/settings/{key}` | super_admin – `{value, expected_version}` → `409` on stale version |
| POST | `/settings/test-email` | super_admin |
| POST | `/settings/maintenance-mode` | super_admin – `{enabled, message}` |
| GET | `/setup/readiness` | admin – first-run checklist |

## Vehicle categories

| Method | Path | Role |
|---|---|---|
| GET | `/vehicle-categories` (`?include_inactive`) | user |
| POST | `/vehicle-categories` | admin |
| GET/PATCH | `/vehicle-categories/{id}` | user / admin |
| POST | `/vehicle-categories/{id}/deactivate` (`?force`) / `reactivate` | admin |

## Vehicles

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/vehicles` | user | Filters: `status[]`, `category`, `manufacturer`, `location`, `is_available`, `active` (default true = excludes archived), `has_open_damage`, `q` (number, plate, serial, model, manufacturer, QR). Rows include `active_loan`, `open_damage_count`, `reservation_summary`, `meter_requirements`, `capabilities`, `next_actions` |
| GET | `/vehicles/typeahead` | user | `q`, `status[]` |
| POST | `/vehicles` | admin | Create announced vehicle |
| GET/PATCH | `/vehicles/{id}` | user / admin | PATCH never accepts `status`/readings |
| GET | `/vehicles/{id}/workflow-context` | user | Meter baseline, category mode, active loan, open damages, active maintenance, current/upcoming reservations, suppliers/recipients typeahead hints, capabilities |
| GET | `/vehicles/{id}/history` | user | Chronological timeline (status history, protocols, loans, damages, maintenance, documents, admin actions) with paging |
| GET | `/vehicles/{id}/media` | user | Attached media with thumbnails; signatures only if `view_signatures` |
| GET | `/vehicles/{id}/documents` | user | Document register rows for this vehicle |
| GET | `/vehicles/{id}/active-loan` | user | |
| POST | `/vehicles/{id}/archive` / `unarchive` | admin | `{reason}` |
| POST | `/vehicles/{id}/admin-correct` | admin | `{status?, odometer_km?, operating_hours?, reason}` |
| POST | `/vehicles/{id}/send-to-maintenance` | user* | see 05 §6 |
| POST | `/vehicles/{id}/complete-maintenance` | user* | |
| POST | `/vehicles/{id}/damages` | user* | Ad-hoc damage |
| GET | `/vehicles/{id}/qr-label` | user | SVG/PNG label data `{qr_code, url, label_lines[]}` |
| GET | `/vehicles/qr-bulk` | admin | Paginated label rows (`active` only by default, `?include_inactive`) |
| POST | `/vehicles/{id}/schedule-manufacturer-return` | user* | `{manufacturer_return_due: "YYYY-MM-DD" \| null, note?}` |
| GET | `/qr/{code}` | user | Resolve QR → vehicle summary + next actions |
| GET | `/public/qr/{code}` | public | Non-sensitive identity + status only; rate limited; can be disabled in settings |

## Check-in

| Method | Path | Role |
|---|---|---|
| POST | `/check-ins` | user* – existing vehicle (`Idempotency-Key`) |
| POST | `/check-ins/create-and-check-in` | user* – new vehicle + check-in |
| GET | `/check-ins` (`vehicle`, `date_from/to`) / `/check-ins/{id}` | user |

Response `201` (or `200` on idempotent replay):

```json
{
  "protocol": {...},
  "vehicle": {...},
  "document": {"id":"…","status":"pending","language":"de","protocol_number":"CI-2026-000041"},
  "warnings": []
}
```

## Loans

| Method | Path | Role |
|---|---|---|
| GET | `/loans` (`status`, `vehicle`, `company`, `driver`, `overdue`, `q`) | user |
| GET | `/loans/typeahead` | user |
| POST | `/loans` | user* – checkout |
| GET | `/loans/{id}` | user |
| GET | `/loans/{id}/return-context` | user |
| POST | `/loans/{id}/return` | user* |
| POST | `/loans/{id}/cancel` | admin – `{reason}` |

## Reservations

| Method | Path | Role |
|---|---|---|
| GET/POST | `/reservations` (`vehicle`, `status`, `from`, `to`) | user / user* |
| GET | `/reservations/typeahead` | user |
| GET/PATCH | `/reservations/{id}` | user / user* |
| POST | `/reservations/{id}/cancel` / `mark-no-show` | user* |
| GET | `/reservations/calendar?from&to&category` | user – compact rows for timeline view |

## Manufacturer check-out

| Method | Path | Role |
|---|---|---|
| POST | `/manufacturer-checkouts` | user* |
| GET | `/manufacturer-checkouts` / `/{id}` | user |

## Maintenance & damages

| Method | Path | Role |
|---|---|---|
| GET | `/maintenance` (`status`, `vehicle`) / `/maintenance/{id}` | user |
| GET | `/damage-reports` (`vehicle`, `open`, `severity`, `phase`) | user |
| GET/PATCH | `/damage-reports/{id}` | user / user* |
| POST | `/damage-reports/{id}/resolve` | user* |

## Companies & drivers

| Method | Path | Role |
|---|---|---|
| GET/POST | `/companies` (`type`, `is_active`, `q`) | user / user* |
| GET | `/companies/typeahead?type=` | user |
| GET/PATCH | `/companies/{id}` | user / user* |
| POST | `/companies/{id}/deactivate` / `reactivate` | admin |
| GET | `/companies/duplicates` | admin |
| POST | `/companies/{id}/merge` | admin – `{target_id, confirmation_token?}` |
| GET/POST | `/drivers` (`company`, `is_active`, `q`) | user / user* |
| GET | `/drivers/typeahead` | user |
| GET/PATCH | `/drivers/{id}` | user / user* |
| POST | `/drivers/{id}/deactivate` / `reactivate` | admin |
| GET | `/drivers/duplicates`, POST `/drivers/{id}/merge` | admin |

## Media

| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/media` | user* | multipart `file`, `media_type` (`photo`|`signature`), optional `caption`. Validates type/size/magic bytes, computes SHA-256, re-encodes photos, stores in R2, returns staged `{id, media_type, sha256, width, height, thumbnail_url?}` |
| GET | `/media/{id}` | user | Metadata (authorisation per type) |
| GET | `/media/{id}/download` (`?variant=thumb`) | user | Streams from R2 with auth check; audit `media.downloaded` for signatures/PDFs |
| POST | `/media/{id}/discard` | owner | Only staged files |
| GET | `/media/staged` | user | Own staged files (for draft recovery) |

## Documents (PDF protocols)

| Method | Path | Role |
|---|---|---|
| GET | `/documents/register` (`status=generated|pending|failed|attention`, `type`, `language`, `vehicle`, `q`, `date_from/to`) | user |
| GET | `/documents/{id}` | user – status, protocol number, error |
| GET | `/documents/{id}/download` | user |
| POST | `/documents/{id}/retry` | user* (single) |
| POST | `/documents/retry` | admin – `{ids[] ≤ 100}` bulk |
| POST | `/documents/generate` | user* – `{document_type, record_id, language}` create the other language version |
| POST | `/documents/register/export` | admin – async CSV → `exports/{id}` |

## Workflow drafts

| Method | Path | Role |
|---|---|---|
| GET | `/workflow-drafts` (`workflow_type`, `scope_key`) | user* – own (admin: `?all`) |
| POST | `/workflow-drafts` | user* – upsert (`expected_version`) |
| GET | `/workflow-drafts/{id}` | owner/admin |
| POST | `/workflow-drafts/{id}/discard` | owner/admin |

## Imports (see `08-excel-import.md`)

| Method | Path | Role |
|---|---|---|
| POST | `/imports/vehicles` | admin – multipart `.xlsx`; returns job (`validating`) |
| GET | `/imports` / `/imports/{id}` (`?rows=errors|all&page`) | admin |
| POST | `/imports/{id}/remap` | admin – `{mapping}` revalidate |
| POST | `/imports/{id}/exclude-rows` | admin – `{row_numbers[]}` |
| POST | `/imports/{id}/commit` | admin – `{validation_fingerprint}` |
| POST | `/imports/{id}/abort` | admin |
| GET | `/imports/vehicle-template?lang=de` | admin – xlsx |
| GET | `/imports/{id}/errors-csv`, `/imports/{id}/generated-ids-csv` | admin |

## Dashboard, tasks, audit, exports

| Method | Path | Role |
|---|---|---|
| GET | `/dashboard/summary` | user |
| GET | `/dashboard/tasks?limit=` | user |
| GET | `/audit-logs` (`action`, `entity_type`, `entity_id`, `vehicle`, `actor`, `date_from/to`, `q`) | admin |
| GET | `/audit-logs/{id}` | admin |
| POST | `/audit-logs/export` | admin – async CSV |
| GET | `/exports` / `/exports/{id}` / `/exports/{id}/download` | requester |
| GET | `/health` | public – `{status, version, checks:{d1, r2, kv, queue}}` (no secrets) |

## Example: loan checkout request

```http
POST /api/v1/loans
Idempotency-Key: 7f1e…
X-CSRF-Token: …
Content-Type: application/json

{
  "vehicle_id": "a5c8…",
  "reservation_id": null,
  "company_id": "c11…",
  "driver_id": "d42…",
  "borrower_name": "Max Mustermann",
  "borrower_phone": "+49 170 0000000",
  "expected_return_at": "2026-09-12T16:00:00Z",
  "checkout_odometer_km": 12045,
  "checkout_operating_hours": 812.5,
  "checkout_notes": "Scratch rear left already present",
  "damage_reports": [
    {"description": "Scratch rear left", "severity": "minor", "media_file_ids": ["m1"]}
  ],
  "media_file_ids": ["m2", "m3", "sig1"],
  "language": "de"
}
```

Response `201`:

```json
{
  "loan": {"id": "l9…", "status": "active", "expected_return_at": "…", "borrower_name": "…", "capabilities": {"can_return": true}},
  "vehicle": {"id": "a5c8…", "status": "loaned", "next_actions": [{"action": "loan_return", "method": "POST", "url": "/api/v1/loans/l9…/return"}]},
  "document": {"id": "doc…", "status": "pending", "protocol_number": "LC-2026-000318"},
  "warnings": [{"code": "reservation_before_expected_return", "reservation_id": "r7…", "start_at": "2026-09-11T08:00:00Z"}]
}
```
