# 09 – Photos, Signatures and PDF Protocols

## Photo capture and upload

### Client side (SPA `MediaUploadField`)

- `<input type="file" accept="image/*" capture="environment" multiple>` opens
  the camera on phones; drag-and-drop and file picker on desktop.
- Before upload the browser downsizes to max 2 048 px on the long edge and
  re-encodes as JPEG q=0.85 using `createImageBitmap` + canvas (keeps uploads
  ~300–600 KB on mobile networks). EXIF orientation is applied during this
  step and thereby removed.
- Uploads are sequential with progress; each returns a **staged** media id
  that is placed into the wizard state and the autosaved draft.
- Thumbnails show immediately from the local blob; server thumbnails replace
  them when the `media.derive` job has run.
- Photos can be captioned (e.g. "front", "rear left") and reordered; the
  order becomes `snapshot.media[]` order and PDF contact-sheet order.
- Photo slot guidance per workflow (configurable in settings):
  check-in: front, rear, hour meter/odometer, damages; loan: 4 sides +
  meter; return: 4 sides + meter; manufacturer: 4 sides + meter.

### Server side (`POST /api/v1/media`)

1. Limits: photo ≤ 10 MB, `image/jpeg|png|webp|heic`; signature ≤ 1 MB PNG;
   checked by MIME **and** magic bytes. Max 30 staged files per user.
2. SHA-256 computed while streaming (`crypto.subtle.digest` on the buffered
   body; sizes are bounded by the limits above).
3. Photos are passed through the `IMAGES` binding: auto-orient, strip
   metadata, re-encode JPEG (max 2 048 px). Width/height recorded.
4. Stored in R2 (`photos/yyyy/mm/{id}.jpg`) with custom metadata; row
   inserted in `media_files` with `attached_at = NULL` (staged).
5. `media.derive` job creates the 320 px thumbnail.
6. Audit `media.uploaded` (id, type, size, sha256).

### Staging → attachment lifecycle

```text
uploaded (staged, owner only) ──attach in workflow batch──▶ attached (immutable relation)
        │                                                     │
        ├── discard by owner / draft discard ──▶ discarded    └── download by authorised users
        └── cron: staged > staged_ttl_hours and not in any draft ──▶ discarded (audit media.expired)
```

- Only the uploader can attach or discard a staged file; a file can be
  attached exactly once; attachment sets `related_type/related_id`,
  `vehicle_id`, `loan_id`/`damage_report_id`, `attached_at`.
- Discarded objects are deleted from R2 by the cron job after 24 h (grace
  period) and the row is kept for the audit trail.
- Attached media is never deleted while the referencing record exists;
  retention is handled at vehicle-archive level (`11-settings.md`).

### Download authorisation

| Media type | Who |
|---|---|
| photo, pdf | any active user |
| signature | users with `view_signatures` (all roles by default; read-only users excluded) |
| import, export | admin / requester |

Downloads stream from R2 with `Content-Disposition: inline|attachment`,
`Cache-Control: private, no-store`, `ETag = sha256`. Signature and PDF
downloads are audited (`media.downloaded`).

## Signature capture

- `SignaturePad` component: canvas, pointer events (finger/stylus/mouse),
  device-pixel-ratio aware, landscape hint on phones, clear/undo, optional
  typed name under the signature.
- Exported as PNG (transparent background, black stroke, ≤ 1 000 × 400 px),
  uploaded as `media_type=signature` → staged id. Never stored in draft JSON
  (the server rejects `data:image` strings).
- Required: loan checkout (always). Policy-driven: loan return, check-in,
  manufacturer check-out (`settings.signatures.*`).
- The PDF embeds the signature image with signer name, role (borrower /
  operator), timestamp, and SHA-256.

## PDF protocols

### Document types and protocol numbers

| Type | Prefix | Created when |
|---|---|---|
| `check_in` | `CI-YYYY-NNNNNN` | check-in completed |
| `loan_checkout` | `LC-YYYY-NNNNNN` | loan created |
| `loan_return` | `LR-YYYY-NNNNNN` | loan returned |
| `manufacturer_checkout` | `MC-YYYY-NNNNNN` | manufacturer check-out completed |
| `maintenance_start` / `maintenance_complete` | `MS-` / `ME-` | if `settings.documents.maintenance_pdf = true` |

One document row per `(type, record, language)`. The workflow creates the row
in the actor's language; the other language can be requested later
(`POST /documents/generate`) and renders from the same snapshot.

### Rendering pipeline (queue consumer `pdf.render`)

1. Load document + record snapshot from D1; load settings (branding, footer).
2. Load referenced media from R2, verify `content_sha256`; downscale photos
   to ≤ 1 200 px / 200 KB for embedding (Images binding); signatures embedded
   as-is. Missing or corrupt media → fail with `evidence_missing` (register).
3. Render HTML from the template (`apps/worker/src/pdf/templates/*.tsx`,
   server-side JSX → string) with the localisation bundle; images inlined as
   `data:` URIs (bounded: ≤ 12 photos, total ≤ 8 MB).
4. `BROWSER` binding: `page.setContent(html)`, `page.pdf({format:'A4',
   printBackground:true, margin})`; timeout 25 s.
5. pdf-lib post-processing: set metadata (title, author "FlareFleet",
   subject = protocol number, keywords = vehicle number), append page numbers.
6. Store to R2 `pdf/{type}/{yyyy}/{documentId}.{lang}.pdf`, insert
   `media_files` (`pdf`, `is_generated`), update document
   (`generated`, `media_id`, `generated_at`), audit `pdf.generated`.
7. Failure: `attempts++`, `last_error` (truncated), queue retry with
   exponential backoff (1, 4, 16, 60, 300 s); after 5 attempts → `failed`,
   audit `pdf.generation_failed`, appears in *failed documents* task group.

Rendering is idempotent: if an object already exists for the document id and
its hash matches, the consumer only repairs the row.

### PDF content (all types)

1. Header: branding logo (settings), company name, document title
   (localised), protocol number, QR code of the vehicle (SVG), generation
   timestamp, language.
2. Vehicle block: internal number, category, manufacturer, model, serial,
   plate, location, status before → after.
3. Workflow block: performed at/by, party (supplier / borrower + company +
   phone / recipient), expected/actual return, readings (with delta on
   return), condition outcome, notes.
4. Damage table: description, severity, discovered at, photo references
   (numbered).
5. Photo contact sheet: numbered thumbnails with captions and truncated
   SHA-256.
6. Signatures: image, signer role/name, timestamp, hash.
7. Footer: legal text from settings, "generated from immutable snapshot
   v{schema_version}", page x/y.

Templates are the same for DE and EN; only the i18n bundle differs.

### Document register

`GET /documents/register` joins `documents` with vehicles and records and
supports `status=attention` (= pending > 1 h or failed). Rows include
`retry {method, url}`. Single retry re-enqueues; bulk retry (admin) accepts up
to 100 ids and is audited `document.bulk_retried`. The nightly reconciliation
inserts missing document rows for workflow records that lack one (schema
drift, failed inserts) so the register is complete.

### Why Browser Rendering rather than pdf-lib only

Layout with tables, wrapped text, images and DE/EN typography is far simpler
in HTML/CSS. pdf-lib stays as a dependency for metadata/page numbers and as an
emergency text-only fallback (`settings.documents.renderer = "pdf-lib"`) if
Browser Rendering is unavailable in the account.
