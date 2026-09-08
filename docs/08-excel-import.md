# 08 – Excel Import of Announced Vehicles

Admins import the manufacturer's delivery list **before** the vehicles arrive.
Imported vehicles are `announced` and appear in the *Arrivals awaiting
check-in* task list; the yard operator later selects them in the check-in
wizard (or scans the pre-printed QR label).

## Flow

```text
upload .xlsx ──▶ validating (ImportJobActor) ──▶ validated ──▶ committing ──▶ committed
                        │                            │  ▲
                        └── failed (row errors) ◀────┘  └── remap columns / exclude rows → revalidate
                                                          abort → aborted
```

1. **Upload** `POST /imports/vehicles` (multipart, `.xlsx`/`.xlsm`, ≤ 20 MB,
   ≤ 5 000 data rows). The Worker stores the workbook in R2
   (`imports/{jobId}/source.xlsx`), creates the job (`validating`) and calls
   the `ImportJobActor` DO.
2. **Validation** (in the DO, ExcelJS): first worksheet, first non-empty row is
   the header. Headers are normalised (trim, lower-case, umlauts → ae/oe/ue,
   spaces/dashes → `_`) and mapped to canonical columns via the alias table.
   Every data row is normalised, validated and diffed against existing
   vehicles. Rows are stored in `import_rows`; the full result JSON is also
   written to R2. Job → `validated` (no blocking errors) or `failed`.
3. **Review** in the SPA: header report (detected / missing / unmapped
   columns), summary (create / update / error / excluded counts), row table
   with old→new diff, duplicate candidates and supplier proposals, filters
   (`errors only`), row exclusion checkboxes, column remap dialog.
4. **Commit** `POST /imports/{id}/commit` with the `validation_fingerprint`
   shown in the review. The DO locks the job, re-reads every included row,
   verifies the row fingerprint against the current DB state (old values
   unchanged), then applies rows in chunks of 50 via `DB.batch()`; progress is
   published (`progress.processed / total`). Any conflict aborts the whole
   commit (`failed`, no partial data because each chunk is verified before the
   first write and the DO re-validates all rows before writing the first
   chunk).
5. **Result**: `committed` with `create_count`, `update_count`, per-row
   `committed_vehicle_id`; downloads for *errors CSV* and *generated IDs CSV*
   (row, action, vehicle id, internal number, external key, QR code) so labels
   can be printed before arrival.

## Columns

| Canonical column | Required | Aliases (normalised) | Behaviour |
|---|---|---|---|
| `external_key` | no | external_key, external_id, source_id, quell_id, externe_id | Stable unique key from the source system; **preferred update key** |
| `internal_number` | no | internal_number, interne_nummer, fahrzeugnummer, fahrzeug_nr, fzg_nr, nummer | Unique fleet number; update key when present; generated `FZ-nnnnn` when blank on create |
| `category` | no | category, kategorie, fahrzeugkategorie, fahrzeugart, fahrzeugtyp, art | Active category by name (case-insensitive); unknown/blank → fallback category `Sonstiges` (created on demand, `meter_mode=both`) – shown in diff |
| `manufacturer` | **yes** | manufacturer, hersteller, marke | |
| `model` | **yes** | model, modell, bezeichnung, typ | |
| `serial_number` | no | serial_number, seriennummer, serien_nr, fahrgestellnummer, fin | Unique when present; blank clears on update |
| `license_plate` | no | license_plate, kennzeichen, kfz_kennzeichen, nummernschild | Unique when present; blank clears |
| `current_odometer_km` | no | kilometerstand, km_stand, kilometer, km | Non-negative integer; applied **only on create** |
| `current_operating_hours` | no | betriebsstunden, betriebsstd, stunden | Non-negative decimal (1 dp); only on create |
| `current_location` | no | standort, lagerort, ort | Blank clears |
| `supplier` | no | supplier, lieferant, zulieferer | Matched to active `supplier`/`manufacturer` company by name; unmatched → `supplier_proposal {status: "create_proposed"}`; never auto-created; if matched, pre-selected in the check-in wizard |
| `manufacturer_return_due` | no | rueckgabe_bis, return_due, rueckgabedatum | Date (`YYYY-MM-DD` or Excel date); must be in the future on create |
| `notes` | no | notes, notizen, bemerkung(en), anmerkung(en), kommentar | Blank clears |
| `expected_arrival` | no | ankunft, lieferdatum, expected_arrival, delivery_date | Date; stored in `vehicles.expected_arrival_on` and used to sort the arrivals task list and flag late deliveries |

Unknown columns are reported as `unmapped` and ignored; the remap dialog lets
the admin bind them to canonical columns for the job (`column_mapping`).

## Row semantics

- **Missing column** → field untouched on update.
- **Present but blank cell** → explicit clear for clearable text fields
  (`serial_number`, `license_plate`, `current_location`, `notes`,
  `manufacturer_return_due`); readings are never cleared or lowered by import.
- Blank rows are skipped. Duplicate `external_key`/`internal_number`/
  `serial_number`/`license_plate` **within the file** are row errors on both
  rows.
- Matching order: `external_key` → `internal_number` → (`serial_number` as
  *duplicate candidate* only, never auto-match).
- Updates are limited to master-data columns; `status` and readings of
  existing vehicles are workflow-owned. Archived vehicles cannot be updated by
  import (row error `vehicle_archived`).
- Field lengths mirror the schema (manufacturer/model 120, serial 120, plate
  40, location 255, notes 5 000).

## Validation result per row

```json
{
  "row_number": 7,
  "action": "update",
  "matched_vehicle_id": "…",
  "data": {"manufacturer": "Genie", "model": "Z-45", "license_plate": "", ...},
  "present_fields": ["manufacturer", "model", "license_plate", "supplier"],
  "diff": [
    {"field": "license_plate", "old": "B-AB 123", "new": null, "changed": true, "explicit_clear": true},
    {"field": "category", "old": "Steiger", "new": "Sonstiges", "changed": true, "fallback": true}
  ],
  "errors": [{"field": "serial_number", "code": "duplicate_in_file", "message": "…"}],
  "duplicate_candidates": [{"vehicle_id": "…", "internal_number": "FZ-00012", "reason": "serial_number"}],
  "supplier_proposal": {"status": "matched", "company_id": "…", "name": "Genie GmbH"},
  "excluded": false,
  "fingerprint": "sha256(data + old values)"
}
```

## Commit rules

- Blocked while any **included** row has errors.
- The `validation_fingerprint` (hash over all included row fingerprints) must
  match; otherwise `409 import_stale` and the SPA offers revalidation.
- New vehicles: `status=announced`, QR code generated, sequence-allocated
  internal number when blank, readings from file, `created_by` = importer.
- Status history row `import` (`null → announced`) and audit rows:
  `import.vehicle.validated`, `import.rows_excluded`, `import.vehicle.remapped`,
  `import.vehicle.committed` (summary), `import.vehicle.created` /
  `import.vehicle.updated` per row (with diff).
- Only one job can be in `committing` at a time (DO lock); a second commit
  request returns `409 import_in_progress`.

## Template download

`GET /imports/vehicle-template?lang=de|en` returns an `.xlsx` with localised
headers (aliases are accepted), an example row, a hidden sheet listing active
category names for a data-validation dropdown, and a `README` sheet with the
rules above.

## Limits & performance

- 5 000 rows × ~12 columns validates in well under the Worker/DO CPU budget
  (ExcelJS streaming reader, one D1 query per 100 keys for matching).
- Commit chunks of 50 rows use ≤ 100 bound parameters per statement; a
  2 000-row import commits in ~40 batches.
- Result JSON in R2 avoids the 2 MB D1 row limit for very wide files.
