# 11 – Global Settings (Super Admin)

Settings live in the `settings` table as JSON values keyed by section, cached
in KV (`settings:current`, 5 min) and invalidated on write. `GET /auth/me`
exposes the non-secret subset the SPA needs (`settings_public`). Every change
is audited (`settings.updated`) with a version check
(`PUT /settings/{key}` requires `expected_version`).

Secrets that must never be in D1 (session signing key, e-mail provider API
key, Access JWKS URL) are Wrangler secrets; the settings UI only shows whether
they are configured.

| Key | Fields | Default | Used by |
|---|---|---|---|
| `general` | `organisation_name`, `default_language` (`de`/`en`), `timezone` (`Europe/Berlin`), `date_format`, `public_base_url` (for QR labels) | – | SPA header, PDFs, QR |
| `branding` | `logo_media_id`, `primary_color`, `pdf_header_text`, `pdf_footer_text`, `legal_text` | – | SPA theme, PDF header/footer |
| `auth` | `mode` (`password`/`access`/`both`), `session_hours` (12), `session_absolute_days` (7), `min_password_length` (12), `lockout_attempts` (5), `lockout_minutes` (15), `temporary_password_hours` (72) | | Auth middleware |
| `roles` | `user_can_create_master_data` (true), `user_can_view_signatures` (true), `user_can_print_qr` (true) | | Capability computation |
| `check_in` | `min_photos` (1), `signature_required` (false), `photo_slots[]` (["front","rear","meter","damage"]) | | Check-in wizard & service |
| `loan` | `min_photos` (2), `return_signature_required` (false), `default_duration_hours` (8), `max_duration_days` (30), `cancel_window_hours` (24), `photo_slots[]` | | Loan wizards & service |
| `manufacturer_checkout` | `min_photos` (2), `signature_required` (false) | | |
| `reservations` | `early_handover_hours` (2), `no_show_grace_hours` (24), `max_horizon_days` (180) | | Reservation service |
| `maintenance` | `pdf_enabled` (false), `require_photos` (false) | | |
| `media` | `photo_max_mb` (10), `signature_max_kb` (1024), `max_edge_px` (2048), `staged_ttl_hours` (48), `max_staged_per_user` (30), `thumbnail_px` (320) | | Media routes, cron |
| `documents` | `renderer` (`browser`/`pdf-lib`), `auto_generate` (true), `max_photos_in_pdf` (12), `retry_attempts` (5) | | PDF queue |
| `drafts` | `ttl_hours` (72), `max_form_kb` (64) | | Drafts |
| `tasks` | `return_due_lookahead_days` (14), `overdue_grace_minutes` (0), `arrival_late_days` (3) | | Dashboard |
| `import` | `max_rows` (5000), `max_file_mb` (20), `fallback_category_name` ("Sonstiges"), `allow_update_existing` (true) | | Import DO |
| `notifications` | `email_enabled` (false), `from_address`, `overdue_digest_hour` (7), `recipients_overdue[]`, `recipients_failed_documents[]` | | Notify job |
| `retention` | `audit_years` (10), `archived_vehicle_years` (10), `exports_days` (7), `sessions_days` (30) | | Cron |
| `qr` | `public_status_page` (true), `label_format` (`a4_sheet` / `62x29` / `54x25` / `50x30` / `40x30` / `100x50` / `custom`), `label_lines[]` (["internal_number","category","model"]) | | QR print pages, public status endpoint |
| `maintenance_mode` | `enabled`, `message` (KV, not D1) | false | Middleware |

## Settings UI (super admin)

`/admin/settings` with one tab per section, inline validation from the shared
Zod schema, "unsaved changes" guard, version conflict banner, audit link
("last changed by X at Y"), and a *danger zone* tab:

- Rotate session signing key (revokes all sessions).
- Purge staged media now.
- Re-run document reconciliation.
- Toggle maintenance mode.
- Export full audit log.
- Bootstrap/repair: create another super admin.

Admins see the same page read-only (secrets masked, no danger zone).

## Setup readiness (`GET /setup/readiness`)

Checklist evaluated on the dashboard for admins until all items are green:
super admin has changed the initial password, ≥ 1 active category, ≥ 1
supplier/manufacturer company, ≥ 1 user, `public_base_url` set, branding
logo, e-mail configured or explicitly disabled, Browser Rendering binding
reachable (test render), Queue consumer healthy (last `pdf.render` success),
Cron last run < 1 h ago.
