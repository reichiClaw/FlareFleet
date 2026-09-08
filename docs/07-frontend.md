# 07 – Frontend (React SPA)

Stack: React 19, TypeScript, Vite + `@cloudflare/vite-plugin`, React Router,
TanStack Query (server state, retries only for `GET`), react-hook-form + Zod
(shared schemas from `packages/shared`), i18next (`de`, `en`), Tailwind CSS +
Radix primitives, `qrcode` (label rendering), `@zxing/browser` or the native
`BarcodeDetector` for scanning, Vitest + Testing Library, Playwright.

Design principles carried over from the old UX redesign: operator-first
navigation, four-step workflow wizards with a "what happens when you confirm"
box, capability-driven buttons (never show an action the API would refuse),
server-side pagination/typeahead everywhere, mobile bottom navigation with a
task badge, offline/session banners, dirty-form warnings, autosaved drafts.

## Routes

| Path | Page | Min. role | Purpose |
|---|---|---|---|
| `/login` | LoginPage | public | Username/e-mail + password, language switch, Access SSO button when enabled, "must change password" redirect |
| `/v/:qrCode` | PublicVehicleStatusPage | public | Result of scanning a label without login: identity, status badge, location; "Sign in to act" (deep link kept). Disabled when `qr.public_status_page=false` |
| `/app` | DashboardPage | user | KPIs (fleet size, available, on loan + utilisation, maintenance, damaged, overdue), status donut, 14-day checkout chart, attention lists (overdue, reservations to hand over, damaged), recent activity, first-run checklist (admin) |
| `/app/tasks` | TasksPage | user | Operator action tiles (scan, check in, loan, return, manufacturer return, maintenance/damage, create record) + task groups from `/dashboard/tasks` with direct "do it" buttons |
| `/app/scan` | ScanPage | user | Camera QR scanner (BarcodeDetector → zxing fallback), manual code entry; `parseQrTarget` accepts a bare `VH-…` code, a same-origin `/v/{code}` URL or an `/app/vehicles/{id}` URL; resolves to `/app/vehicles/:id?intent=` action sheet |
| `/app/vehicles` | VehiclePoolPage | user | Filter bar (status chips, category, location, manufacturer, availability, open damage, search), table/card toggle, status badges, borrower + due date for loaned, quick actions from `next_actions` |
| `/app/vehicles/new` | AddVehiclePage | admin | Create announced vehicle (master data, initial readings, photos, initial damages) |
| `/app/vehicles/:id` | VehicleDetailPage | user | Header with status, QR, meters; tabs: Overview (master data, active loan, reservations, open damages), Timeline, Media, Documents, Admin (edit, archive, correction, schedule manufacturer return) |
| `/app/vehicles/:id/label` | QRLabelPage | user | Single label print (format from settings) |
| `/app/workflows/check-in` | CheckInWizard | user* | Steps below |
| `/app/workflows/intake` | CreateAndCheckInWizard | user* | Check-in for a vehicle that was not announced |
| `/app/workflows/loan` | LoanCheckoutWizard | user* | |
| `/app/workflows/return` | LoanReturnWizard | user* | |
| `/app/workflows/manufacturer-return` | ManufacturerCheckoutWizard | user* | |
| `/app/workflows/maintenance/:vehicleId` | MaintenanceTaskPage | user* | Start / complete maintenance, resolve damages, add ad-hoc damage |
| `/app/reservations` | ReservationsPage | user | List + week timeline per vehicle/category, create/edit/cancel/no-show dialogs, "hand over" → loan wizard with `reservation_id` |
| `/app/history` | HistoryPage | user | Cross-fleet chronological feed (loans, protocols, damages) with filters; links to vehicle timeline |
| `/app/archive` | ArchivePage | user | Archived + at-manufacturer vehicles; admin unarchive with reason |
| `/app/documents` | DocumentRegisterPage | user | Register with status filters, download, retry (single; bulk for admin), export CSV |
| `/app/partners` | PartnersPage | user | Companies (by type) and drivers: list, typeahead, create/edit; admin: deactivate, duplicates, merge wizard |
| `/app/imports` | ImportPage | admin | Upload, job list, review (header report, row table, diff, exclusions, remap), commit progress, downloads, template |
| `/app/admin/users` | UserManagementPage | admin | Users table, create (role ≤ own), temporary password reveal, deactivate, sessions (super admin) |
| `/app/admin/categories` | CategoryManagementPage | admin | CRUD with meter mode and vehicle count |
| `/app/admin/qr-labels` | QRBulkPrintPage | admin | Server-paginated selection, label size presets (A4 sheet, 62×29, 54×25, 50×30, 40×30, 100×50, custom), print, CSV export |
| `/app/admin/audit` | AuditLogPage | admin | Filters, diff viewer, export |
| `/app/admin/setup` | SetupPage | admin | Readiness checklist with links |
| `/app/admin/settings` | SettingsPage | super_admin (admin read-only) | Tabs per settings section, danger zone |
| `/app/account` | AccountPage | any | Profile, language, password, own sessions |
| `*` | NotFoundPage / AccessDeniedPage | | |

## Navigation

Sidebar (desktop) / drawer + bottom bar (mobile):

| Group | Items | Visible to |
|---|---|---|
| Operate | Home, Tasks (badge = total open tasks), Scan, Vehicle pool, Check in, Loan, Return, Manufacturer return, Maintenance/damage, Reservations | user (workflow items hidden for read-only users) |
| Records | History, Documents, Archive, Companies & drivers | user |
| Administration (collapsible) | Setup, Users, Categories, Imports, QR labels, Audit log | admin |
| System | Settings | super_admin (admin sees read-only) |
| Account menu | Language, Account, Log out | any |

Mobile bottom bar: Home · Tasks · Scan · Fleet · More.

## Workflow wizards

All wizards share `WorkflowWizard` (progress header, back/next, step
validation, consequence box, submit with double-submit protection and
`Idempotency-Key`), `useWorkflowDraft` (autosave every 2 s after change,
resume/discard/conflict dialogs), `VehicleContextBanner` (identity, status,
meter baseline, open damage, active reservation), `MediaUploadField`,
`SignaturePad`, `DamageList`, `ReadingsFields` (rendered according to the
category meter mode), `ProtocolReceipt`.

Standard step layout: **1 Identify → 2 Party / timing → 3 Condition / evidence
→ 4 Review / confirm**, followed by the receipt.

### Check-in wizard

1. Identify: select announced vehicle (typeahead over `status=announced`,
   sorted by `expected_arrival_on`), or scan QR, or "vehicle not announced" →
   switches to Create-and-check-in (master-data fields inline).
2. Party / timing: supplier (typeahead, type supplier/manufacturer, prefilled
   from import proposal), delivery date/time (default now).
3. Condition / evidence: readings (per meter mode), condition outcome
   (fit / new damage / maintenance) with explanation of the resulting status,
   damage list (description, severity, photos), photo slots (front, rear,
   meter, …), optional signature.
4. Review: summary cards, consequence ("vehicle becomes available"), confirm.
5. Receipt: protocol number, status badge, PDF state (pending → download),
   next actions (loan now, print label, back to tasks).

### Loan checkout wizard

1. Identify: available vehicle (typeahead / scan) or start from a
   reservation ("hand over"); reservation conflicts shown as blocking error or
   warning.
2. Party / timing: party mode (fixed driver → prefills company/name/phone;
   company contact; manual), expected return (date/time picker, quick chips
   +4 h / today 17:00 / +1 day / +1 week; max duration from settings), notes.
3. Condition / evidence: readings, pre-existing damage notes with photos,
   photo slots (4 sides + meter), **signature (required)** with borrower
   name.
4. Review, 5. Receipt (PDF, "return this loan" link).

### Loan return wizard

1. Identify: active loan (typeahead over loans by vehicle/borrower, overdue
   first) or scan; shows return context (checkout photos, readings, expected
   return, overdue).
2. Party / timing: actual return time (default now), returned by whom
   (borrower name confirmation).
3. Condition / evidence: readings with live delta vs checkout, outcome
   (fit / new damage / maintenance; pre-existing open damage displayed with
   the hint that the vehicle cannot become available), damages, photos,
   signature if policy requires.
4. Review (resulting status), 5. Receipt.

### Manufacturer check-out wizard

1. Identify: available/damaged vehicle (eligibility explained if not).
2. Party / timing: recipient company (manufacturer/supplier), date/time,
   transport note.
3. Condition / evidence: readings, damages, photos, optional signature.
4. Review, 5. Receipt with "archive now" (admin) shortcut.

### Maintenance task page

Vehicle banner, open damage list (resolve with notes/photos), *Send to
maintenance* (reason, notes, readings, photos) or *Complete maintenance*
(notes, readings, photos) depending on state; explains resulting status
(damaged vs available).

### Reservation dialog

Vehicle, party mode, start/end (default next full hour + `loan.default_duration_hours`),
notes; overlap errors inline; edit limited to time/notes; cancel/no-show with
reason.

## Import review UI

- Upload zone → job card with status pill and progress bar (polls
  `GET /imports/{id}` every 2 s while `validating|committing`).
- Header report: table of source columns → mapped canonical column / unmapped
  / missing required; "Remap columns" dialog with dropdowns → revalidate.
- Summary chips: rows, create, update, errors, excluded.
- Row table (virtualised): row #, action, identity, diff cells (old → new,
  clear/fallback highlighted), errors, duplicate candidates, supplier
  proposal, exclude checkbox; filter "errors only".
- Commit button enabled only when `status=validated`; shows fingerprint
  mismatch banner if stale; after commit: counts + downloads (errors CSV,
  generated IDs CSV) + "Print labels for imported vehicles".

## Shared components

`StatusBadge`, `MeterRequirementsHint`, `PaginationControls`,
`SearchableSelect` (server typeahead), `Field`/`FormErrorSummary` (maps API
`details` to fields), `ConfirmDialog` (reason input variant),
`ConnectivityBanner`, `SessionExpiredDialog` (re-login in place, keeps
route), `RouteErrorBoundary`, `EmptyState`, `LoadingState`, `Charts`
(status donut, checkout bars), `ReservationTimeline`,
`VehicleConditionTimeline`, `ThumbnailGrid` + `Lightbox`, `PdfStatusChip`
(pending spinner → download / retry), `QrLabel` (SVG), `LabelSheet` (print
CSS per format).

## i18n

- Bundles `apps/web/src/i18n/{de,en}/*.json` split by area; CI fails when
  keys differ between languages.
- Status, outcome, severity, company type, document type labels come from a
  shared `enums` bundle also used by the PDF templates (copied to the Worker
  at build time from `packages/shared/i18n`).
- Date/number formatting via `Intl` with the user's language and the tenant
  timezone.

## Client-side robustness

- TanStack Query: `GET` retried once on network error; mutations never
  retried automatically; on timeout the UI shows "result unknown – refresh"
  and refetches the record.
- Draft autosave stores only form JSON and staged media ids; signature
  bitmaps are uploaded immediately.
- `useDirtyFormWarning` on all wizards and admin forms.
- Session expiry (`401`) opens the re-login dialog without losing wizard state.
- PWA manifest and cached shell so the app opens instantly on yard devices;
  no offline data mutation.
- Accessibility: keyboard-navigable wizards, focus management on step change,
  `aria-live` for receipt status, 44 px touch targets.
