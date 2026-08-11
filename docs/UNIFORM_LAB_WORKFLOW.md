# Uniform role-based lab workflow

**Location:** `docs/UNIFORM_LAB_WORKFLOW.md`  
**Companion diagram:** `docs/blood-collection-to-report-workflow.png`  
**Ops map:** `docs/APP_WORKFLOWS.txt` §0a  
**Updated:** 2026-08-11  
**Scope:** Architecture of record (docs + diagram). Application cutover (SPA routes, single barcode helper in code) is a follow-up.

---

## 1. Principles (non-negotiable)

1. **Multiple input sources** may create a booking (www diagnostics, Flutter, partners Bill Entry / B2B walk-in, collect-assisted walk-in).
2. **ERPNext (`health_ecosystem_core`) is the data receiver and source of truth.** All writes go through HEC APIs / DocTypes.
3. **Only ERPNext mints `Customer TRF.unique_barcode`.** Callers must leave barcode empty (or accept ERP-generated value). Parallel generators (e.g. Bill Entry `HEC{date}{hex}`) are architecture debt — retire to one DocType helper.
4. **From barcode through report, identity is unique:** one TRF barcode → tubes `{barcode}-{TUBE}` → LIS queries that barcode → one active Lab Report for that TRF → one authorized PDF.
5. **`health_web_app` SPA is the frontend for every employee** (role dashboards). ERP Desk remains for **masters, admin, and exceptions** — not daily collect → test → authorize.

```
  [ www | Flutter | partners | collect ]
                 │
                 ▼
         HEC API / ERPNext
                 │
                 ▼
     Customer TRF + unique_barcode   ◄── minted once in ERP
                 │
                 ▼
   Collect → Accession → Test → Verify → Authorize → Deliver
                 │
                 ▲
         Staff SPA (role UIs)
```

---

## 2. Role → portal matrix (target)

| Role | Portal host | SPA path (target of record) | ERP data touched |
|------|-------------|-----------------------------|------------------|
| Patient / Customer | www · Flutter | `/diagnostics`, `/bookings`, account | TRF, Journey, Lab Report PDF |
| Franchisee Hub | partners | B2B / Bill Entry walk-in | TRF + wallet |
| Phlebotomist | collect | `/dashboard/phlebotomist` | TRF `order_status`, tubes Drawn |
| Lab reception | www (staff) | Accession receive/reject (Phase 89 APIs; SPA surface) | tubes, Sample Rejection |
| Lab technician | www | `/dashboard/lab-reports` (+ editor) | Lab Report Parameter; import from LTR |
| Pathologist | www | Authorize on same report UI | `report_status` Authorized + PDF |
| Accounts | www staff + ERP Accounts | Payment / status visibility; SI allocation in ERP | SO / SI / PE |
| LIS / Analyzers | Lab Gateway PC | No browser UI — HTTPS to HEC | Lab Test Result via `log_machine_result` |

**FFMS (`/ffms`, `/onboard`, `/franchise`)** is franchise commercial ops. It is **not** the LIS bench and does not mint clinical barcodes.

---

## 3. Multiple inputs → one barcode

| Input | Entry surface | API / path | Barcode |
|-------|---------------|------------|---------|
| Patient web | www `/diagnostics` | `book_lab_test` / `create_customer_trf` | Empty → DocType `_generate_barcode` |
| Patient app | Flutter | same HEC methods | same |
| Hub walk-in / Bill Entry | partners / Desk page (legacy) | Phase 70 Bill Entry → TRF insert | **Target:** empty → DocType only (retire `_make_barcode`) |
| B2B walk-in | partners | `create_b2b_walk_in_order` | Empty → DocType |

**Uniqueness**

- Field `Customer TRF.unique_barcode`: `unique: 1`, `reqd: 1`.
- Generator: single helper on Customer TRF (`before_insert` when blank).
- Collision policy: retry on `DuplicateEntry` until insert succeeds.
- Tube accession id (logistics): `{unique_barcode}-{TUBE_CODE}` — does not replace the TRF barcode for LIS.

---

## 4. Single post-barcode chain

| Stage | Actor | SPA | ERP status / artefact |
|-------|--------|-----|------------------------|
| 1. Book | Patient / Hub | book UI | TRF `Booked` + Sales Order |
| 2. Pay | Patient / Hub / Phlebo COD | pay / offline | TRF Paid + Payment Entry |
| 3. Collect | Phlebotomist | `/dashboard/phlebotomist` | `Sample Collected`, tubes Drawn |
| 4. Accession | Lab reception | SPA accession (Phase 89) | receive / reject tubes; barcode ready for LIS |
| 5. Test | Analyzer and/or Lab tech | Gateway + `/dashboard/lab-reports/:trfId` | LTR from machine; Report grid (human) |
| 6. Verify | Lab technician | finalize on report UI | Lab Report `Verified`; sync Report → LTR |
| 7. Authorize | Pathologist | authorize on report UI | `Authorized` + PDF + notify |
| 8. Deliver | Patient · Accounts | `/bookings` · ERP SI | Patient PDF; SI from SO / allocate PE |

### Status vocabulary (ops contract)

- **TRF `order_status`:** `Booked` → `Sample Collected` → `In Lab` → `Completed` (+ `Cancelled`)
- **Lab Report `report_status`:** `Draft` → `In Progress` → `Verified` → `Authorized` (+ Printed)
- **Patient Care Journey:** mirrors collection and report release for patient UX

**Patient-visible truth:** derive from **TRF `order_status` + Lab Report `report_status`**. SPA must not invent a third status language.

### Result-store contract (until DocTypes merge)

| Writer | Store | Rule |
|--------|--------|------|
| LIS / Gateway | **Lab Test Result** only | `log_machine_result` |
| Lab tech / Pathologist | **Lab Report Parameter** only | Edit after `import_machine_results_to_report` |
| System on finalize | Report → LTR | `sync_lab_report_to_results` |
| After Verified | — | No dual edits without re-import |

One TRF barcode → **at most one active Lab Report**. PDF attaches to that report / journey only.

---

## 5. SPA vs Desk

| Concern | Target | Today (gap) |
|---------|--------|-------------|
| Phlebo collection | SPA collect host | Live |
| Lab result authoring | SPA `/dashboard/lab-reports*` | Pages exist; **routes not registered in `App.tsx`** — Desk `lab_report.js` / HEC Lab Results still primary |
| Accession | SPA calling Phase 89 APIs | Desk TRF collection common in ops |
| Masters (panels, analytes, reagents, users) | ERP Desk | Correct |
| Exceptions / recovery | ERP Desk | Correct |

Desk is **not** the happy-path employee front end once SPA routes are wired.

---

## 6. API anchors (ERP receiver)

Public prefix: `health_ecosystem_core.health_ecosystem_core.api.<name>`

| Step | Methods |
|------|---------|
| Book | `book_lab_test`, `create_customer_trf`, `create_b2b_walk_in_order` |
| Pay | `create_razorpay_order`, `verify_razorpay_payment`, `mark_offline_payment_collected` |
| Collect | `get_phlebotomist_collection_queue`, `phlebotomist_mark_sample_collected` |
| Accession | `receive_trf_tube`, `reject_trf_tube` |
| LIS | `get_barcode_tests`, `log_machine_result` |
| Bench | `list_lab_report_queue`, `get_or_create_lab_report`, `get_lab_report_detail`, `save_lab_report_parameters`, `import_machine_results_to_report`, `finalize_lab_report` |
| Release | `authorize_lab_report`, journey report PDF download |
| Invoice | Sales Order at book; `create_sales_invoice_from_trf` after delivery |

---

## 7. Sync risks → policy

Earlier “parallel ERP vs lab-tech” feeling comes from dual UIs and dual result stores. **Architecture closes this by contract**, not by a second database:

| Old risk | Policy |
|----------|--------|
| Dual result stores | LIS → LTR; humans → Report; finalize syncs |
| Dual Lab Report UIs | SPA is ops UI; Desk authoring exception-only |
| Status triad | Patient view = TRF + report_status only |
| Pay vs SI timing | SO at book; SI after delivery documented; PE allocates to SI when present |
| LIS offline plane | Gateway local; ERP never speaks ASTM — barcode stalls fixed at Gateway/API |
| Accession vs barcode | Tubes are logistic overlay; analyzers always use TRF `unique_barcode` |

---

## 8. Implementation cutover status

| Item | Status |
|------|--------|
| Register SPA `/dashboard/lab-reports`, `/dashboard/lab-reports/:trfId`, `/dashboard/report-lifecycle` in `App.tsx` | Done (local) |
| Lab-tech default home + CTAs → result entry | Done (local) |
| Single DocType barcode helper + collision retry; Bill Entry leaves barcode blank | Done (local) |
| Retire Desk Lab Report / HEC Lab Results as daily UI | Pending operational parity prove-out |
| Merge LTR + Lab Report into one DocType | Deferred (contract covers dual store) |
| Live deploy of SPA + HEC barcode | Not done — local code / commit only |

Rollback tag (committed HEAD before cutover work may vary): `pre-uniform-lab-cutover`

---

## 9. Success criteria

- Ops and eng can describe: **many bookings → one ERP barcode → one chain → SPA for staff → ERP for data.**
- Diagram `docs/blood-collection-to-report-workflow.png` matches this document.
- Desk is labeled masters/exceptions, not happy-path authoring.
- Lab techs land on `/dashboard/lab-reports` after login (SPA).
