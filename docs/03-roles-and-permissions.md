# 03 – Roles and Permissions

## Roles

| Role | Code | Who | Summary |
|---|---|---|---|
| **Super Admin** | `super_admin` | Application owner / IT | Everything an Admin can do **plus** all global and general settings, security policy, other super admins, integrations, retention, data export/purge |
| **Admin** | `admin` | Fleet office / dispatcher lead | Master data (vehicles, categories, companies, drivers), users up to `admin`, Excel import, audited corrections, archive, bulk document retry, audit log |
| **User** | `user` | Yard operators | Daily operations: check-in, loan, return, manufacturer check-out, maintenance, reservations, damages, photos, signatures, own drafts, own password |

Roles are strictly hierarchical: `super_admin ⊃ admin ⊃ user`. Every
permission check is expressed as `hasRole(user, minimumRole)` plus, where
relevant, a per-user flag.

### Per-user flags

| Flag | Default | Effect |
|---|---|---|
| `can_execute_workflows` | `true` | When `false` the user is effectively **read-only**: sees pool, history, documents, tasks, but every write capability is `false`. Replaces the old `readonly` role |
| `must_change_password` | `false` on create via invite, `true` when an admin sets a temporary password | Blocks all API calls except `/auth/*` and password change |
| `is_active` | `true` | Deactivated users cannot log in; existing sessions are revoked immediately |
| `language` | tenant default | `de` / `en` |

### Super-admin-only responsibilities

- Global settings (`11-settings.md`): branding, default language, timezone,
  signature policy, reservation early-handover window, draft/staged-media TTL,
  media size limits, PDF footer/legal text, public QR base URL, task
  thresholds, retention periods, e-mail provider, Cloudflare Access mode.
- Create/promote/demote `admin` and `super_admin` users; there must always
  remain at least one active super admin (enforced).
- View and revoke any user's sessions; force password rotation for all users.
- Danger zone: purge staged media, re-run document reconciliation, export the
  full audit log, rotate the API secrets, toggle maintenance mode (API returns
  `503` with a banner for non-super-admins).
- Manage API tokens for integrations (future).

## Permission matrix

Legend: ✅ full, ✳️ constrained (see note), 👁 read only, ❌ none.

| Area / action | Super Admin | Admin | User | User (`can_execute_workflows=false`) |
|---|---|---|---|---|
| **Settings** – view effective settings | ✅ | 👁 (non-secret) | ❌ | ❌ |
| Settings – change | ✅ | ❌ | ❌ | ❌ |
| **Users** – list, create, edit, deactivate, temporary password | ✅ | ✳️ up to role `admin`; cannot touch super admins | own profile | own profile |
| Users – promote to `super_admin`, revoke others' sessions | ✅ | ❌ | ❌ | ❌ |
| Change own password / language | ✅ | ✅ | ✅ | ✅ |
| **Categories** – CRUD, (de)activate | ✅ | ✅ | 👁 | 👁 |
| **Vehicles** – create (announced), edit master data | ✅ | ✅ | ✳️ create via "create-and-check-in" only | 👁 |
| Vehicles – list, detail, history, media, QR view | ✅ | ✅ | ✅ | 👁 |
| Vehicles – archive / unarchive (reason) | ✅ | ✅ | ❌ | ❌ |
| Vehicles – admin correction (status, meters, reason) | ✅ | ✅ | ❌ | ❌ |
| Vehicles – QR bulk print | ✅ | ✅ | ✳️ single label | ❌ |
| **Companies / Drivers** – read, typeahead | ✅ | ✅ | ✅ | 👁 |
| Companies / Drivers – create, edit | ✅ | ✅ | ✳️ create/edit (no deactivate) | ❌ |
| Companies / Drivers – deactivate, duplicates, merge, delete | ✅ | ✅ | ❌ | ❌ |
| **Excel import** – upload, validate, remap, exclude, commit, history | ✅ | ✅ | ❌ | ❌ |
| **Check-in** (incl. create-and-check-in) | ✅ | ✅ | ✅ | ❌ |
| **Loan checkout / return** | ✅ | ✅ | ✅ | ❌ |
| **Manufacturer check-out** | ✅ | ✅ | ✅ | ❌ |
| **Maintenance** start / complete | ✅ | ✅ | ✅ | ❌ |
| **Reservations** create / edit / cancel / no-show | ✅ | ✅ | ✅ | 👁 |
| **Damage reports** create / edit / resolve | ✅ | ✅ | ✅ | 👁 |
| **Media** upload / attach / discard own staged | ✅ | ✅ | ✅ | ❌ |
| Media download – photos, PDFs | ✅ | ✅ | ✅ | ✅ |
| Media download – signatures | ✅ | ✅ | ✅ | ❌ |
| Media download – import workbooks | ✅ | ✅ | ❌ | ❌ |
| **Documents** – register, download | ✅ | ✅ | ✅ | ✅ |
| Documents – retry single | ✅ | ✅ | ✅ | ❌ |
| Documents – bulk retry | ✅ | ✅ | ❌ | ❌ |
| **Workflow drafts** – own | ✅ | ✅ | ✅ | ❌ |
| Workflow drafts – see/discard others' | ✅ | ✅ | ❌ | ❌ |
| **Dashboard / Tasks** | ✅ | ✅ | ✅ | 👁 |
| **Audit log** – view, CSV export | ✅ | ✅ | ❌ | ❌ |
| Audit log – full export incl. IP/UA, purge per retention | ✅ | ❌ | ❌ | ❌ |
| **Setup readiness** | ✅ | ✅ | ❌ | ❌ |
| Health endpoint | public (no details) | | | |

## Capability flags

The API never expects the SPA to re-implement permission logic. Every vehicle,
loan, reservation, document and the `GET /auth/me` payload carries a
`capabilities` object and, for vehicles, a `next_actions` list. The same pure
function lives in `packages/shared/capabilities.ts` and is used by the Worker
and, for optimistic rendering, by the SPA.

### User capabilities (`GET /auth/me`)

```json
{
  "role": "admin",
  "capabilities": {
    "manage_settings": false,
    "manage_users": true,
    "manage_super_admins": false,
    "manage_master_data": true,
    "import_vehicles": true,
    "execute_workflows": true,
    "correct_vehicles": true,
    "archive_vehicles": true,
    "view_audit_log": true,
    "view_signatures": true,
    "retry_documents_bulk": true,
    "print_qr_bulk": true
  }
}
```

### Vehicle capabilities and next actions

Computed from role flags **and** vehicle state (`status`, `active_loan`,
`open_damage_count`, `active_maintenance`, `reservation_summary`, `archived`):

| Capability | Condition |
|---|---|
| `can_check_in` | `execute_workflows` ∧ status = `announced` |
| `can_loan` | `execute_workflows` ∧ status = `available` ∧ no active loan |
| `can_return` | `execute_workflows` ∧ status = `loaned` ∧ active loan exists |
| `can_reserve` | `execute_workflows` ∧ status ∈ {available, loaned, checked_in, maintenance, damaged} ∧ not archived |
| `can_send_to_maintenance` | `execute_workflows` ∧ status ∈ {available, damaged} ∧ no active loan ∧ no active maintenance |
| `can_complete_maintenance` | `execute_workflows` ∧ status = `maintenance` ∧ active maintenance exists |
| `can_report_damage` | `execute_workflows` ∧ status ∉ {announced, archived} |
| `can_resolve_damage` | `execute_workflows` ∧ open damage exists |
| `can_manufacturer_checkout` | `execute_workflows` ∧ status ∈ {available, damaged} ∧ no active loan |
| `can_archive` | `archive_vehicles` ∧ status = `manufacturer_checkout` |
| `can_unarchive` | `archive_vehicles` ∧ status = `archived` |
| `can_admin_correct` | `correct_vehicles` ∧ status ∉ {loaned, manufacturer_checkout, archived} |
| `can_edit_master_data` | `manage_master_data` ∧ status ≠ `archived` |
| `can_print_qr` | `execute_workflows` ∨ `manage_master_data` |

`next_actions` is the ordered list of `{action, label_key, method, url}` for
every capability that is `true`, e.g.
`{"action":"loan_checkout","method":"POST","url":"/api/v1/loans"}`. The SPA
renders buttons only from this list.

## Enforcement points

1. **Route guard** (Hono middleware): minimum role and `can_execute_workflows`
   for the route family.
2. **Service guard** (inside Durable Object / service): re-checks the
   capability against the *current* vehicle state, because the SPA may act on
   stale data.
3. **Row filters**: non-admins see only their own drafts; import workbooks
   only for admins; signatures only for users with `view_signatures`.
4. **Audit**: every denied privileged action (`403`) on users, settings,
   corrections or imports writes an `auth.denied` audit row with route and
   actor.

## Session and account security rules

- Passwords: minimum 12 characters, checked against a small blocklist and the
  username/e-mail; no composition rules (NIST style).
- Five failed logins within 15 minutes lock the account for 15 minutes
  (KV counter) and write `auth.locked`.
- Admin-set temporary passwords expire after 72 h if unused.
- Deactivation or role change revokes all sessions of that user.
- Super admins cannot deactivate or demote themselves if they are the last
  active super admin.
