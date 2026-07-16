# Health Ecosystem — Version History

Canonical development path: **`C:\develop\My_Lab_System`**  
Production server: **Hetzner `167.233.108.90`** · site `health.localhost` · Docker `/opt/health-ecosystem/docker`

App package version (Frappe): **`health_ecosystem_core` 1.0.0**  
Document last updated: **2026-07-16**  
**Forward roadmap:** see **`ROADMAP.md`**; NABL accreditation track = Phases **61–63** (after Phase 0 baseline)

---

## Phase 0 — Pre-NABL baseline (2026-07-16)

**Tag:** `v1.2.0-pre-nabl` · **Server backup label:** `v1.2.0-pre-nabl`

Freeze of what is already built **before** NABL 112A/112B/120/126/132 implementation.

**Included in baseline (deployed / in develop tree):**
- Phases 1–58 (clinical, web, reagents, reports, NABL report branding, signatories, etc.)
- **Phase 59** — Operational inventory: Real vs Calculated parameters, derivation on Save, reagent consume on TRF Completed
- **Phase 60** — Customer health packages (Lab Test Panels) + home Apollo-style package tiles (Lab Tests only)
- Web dist on server under `/opt/health-ecosystem/health_web_app/dist`

**Local note:** Many files under `C:\develop\My_Lab_System` remain untracked/uncommitted relative to the short git history; **authoritative restore point is the Hetzner backup** (`/root/backups/` code tarball + `bench backup --with-files`).

**Commands run:**
```bash
# Local
git tag -a v1.2.0-pre-nabl -m "Baseline before NABL 112A/112B/120/126/132 phases"

# Server
bash /opt/health-ecosystem/docker/backup-before-release.sh v1.2.0-pre-nabl
```

**Next:** Phase 61 (`v1.3.0-nabl-112b`) — NABL 112B operational DocTypes + gates + staff UI.

---

## Snapshot tags (recommended before next phase)

Create a git tag when a phase is stable on server:

```bash
git tag -a v0.8.0-phase8-nabl-reports -m "Phase 8: NABL lab report authoring + Remedium PDF"
git push origin v0.8.0-phase8-nabl-reports   # when remote exists
```

| Tag (suggested) | Milestone |
|-----------------|-----------|
| `v0.5.0` | Clinical module + care journey (Phases 1–5) |
| `v0.6.0` | Multi-test TRF, panels, branded PDF (Phase 6) |
| `v0.7.0` | Flutter mobile wiring (Phase 7) |
| `v0.8.0` | NABL desk reports + Remedium PDF (Phase 8) |
| `v0.9.0` | Secrets & integrations config (Phase 9) |
| `v1.0.0-web` | Chrome web app + role dashboards (Phase 10) |
| `v1.0.1-web` | Production web UX: nginx, login, pharmacy orders (Phase 10.1) |
| **`v1.2.0-pre-nabl`** | **Phase 0: baseline before NABL 61–63 (incl. Phases 59–60)** |
| `v1.3.0-nabl-112b` | Phase 61: NABL 112B ops (planned) |
| `v1.4.0-nabl-qc` | Phase 62: IQC/equipment/EQA (planned) |
| `v1.5.0-nabl-qms` | Phase 63: CAPA/complaints/QI (planned) |

---

## Phase overview

| Phase | Focus | Status |
|-------|--------|--------|
| **1–5** | Native clinical module (Marley removed): patients, appointments, prescriptions, care journey, pharmacy, LIS hooks | Done |
| **6** | Multi-test TRF, lab panels, branded reports, workflow polish | Done |
| **7** | Flutter: panels, multi-test bookings, prescription diagnostics, journey refresh | Done |
| **8** | NABL-style lab report authoring, Remedium PDF, calculated parameters | Done (minor bugs) |
| **9** | Secrets & integrations: LIS/Razorpay config, payment gate, desk tools | Done |
| **10** | Chrome web app shell, session auth, role-aware routing | Done |
| **10.1** | Production web: Services/Diagnostics nav, GPS, pricing, My orders, deploy | Done |
| **11** | IAM: Phlebotomist, Patient portal, API + franchise scoping | Done |
| **12** | Razorpay E2E on web + Flutter | In progress |
| **13** | OTP via WhatsApp / SMS | Planned |
| **14** | WhatsApp + email notification flows | Planned |
| **15** | Dashboards: Franchisee, Phlebotomist, Public | Planned |
| **16** | LIS Python bridge — **local lab install only** | Planned (last) |
| **59** | Parameter inventory Real vs Calculated + reagent consume rules | Done (on server) |
| **60** | Customer health packages + home package tiles | Done (on server) |
| **0** | Pre-NABL version tag + server backup | Done 2026-07-16 |
| **61** | NABL 112B ops (SCF, lot verify, release gates, competence, stability) | Next |
| **62** | NABL 112A QC + 120/126 equipment/IQC/EQA | Planned |
| **63** | NABL 112A QMS + 132 complaints | Planned |

---

## Phase 9 — Secrets & integrations

**Goal:** Centralize API keys, document where secrets live, fix Password-field reads, LIS payment toggle.

**Delivered:**
- `clinical_secrets.py` — credential loader (site_config → Settings → placeholder)
- Fixed **Password** fields read via `get_password()` (was broken with `get_single_value`)
- **LIS Requires Razorpay Payment** toggle (default OFF for pay-at-counter)
- Desk: **Health Ecosystem Settings** → Check Status / Copy LIS Config / Rotate Keys
- `SECRETS_SETUP.md` — full operator guide
- `lis_config.example.json` — lab PC template
- Patch: `ensure_phase9_integration_fields.py`

**Setup:**
```bash
bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.init.run_phase9_setup
```

**Where to put secrets:** See **`SECRETS_SETUP.md`**

---

## Phase 10.1 — Production web polish

**Tag:** `v1.0.1-web` · **Backup:** `docker/backup-before-release.sh v1.0.1-web`

**Delivered (2026-06-28):**
- Host nginx on port 80 + UFW; Vite assets at `/web-assets/` (no Frappe clash)
- Nav: Services, Diagnostics, My relationship; GPS address; post-checkout → My orders
- Strikethrough pricing, HTML-stripped pharmacy descriptions
- Login: CSRF/cookie fix, demo password reset, `api_secret` removed from auth response
- `get_my_pharmacy_orders` scoped by owner + patient link + staff sees all

**Always before major releases:**
```bash
# On server
bash /opt/health-ecosystem/docker/backup-before-release.sh v1.0.1-web
# Locally (when using git)
git tag -a v1.0.1-web -m "Phase 10.1: production web polish"
```

---

## Phase 12 — Razorpay E2E (in progress)

**Goal:** Book → pay → confirm on web (Flutter follows).

**Started:**
- Web: `payWithRazorpay()` + Razorpay Checkout.js; test-mode auto-verify when keys are placeholders
- Diagnostics booking + pharmacy checkout trigger payment after order/TRF creation
- Booking detail: **Pay now** for pending TRFs
- API: `create_razorpay_order` / `verify_razorpay_payment` accept `sid` for mobile + web parity

---

## Phase 11 — IAM hardening ✅

**Goal:** Role + franchise scope on every patient-facing API.

**Delivered:**
- `clinical_iam.py` — `require_roles`, `trf_list_filters_for_user`, phlebotomist TRF scope
- `PERMISSIONS.md` — role matrix
- Demo users: `phlebotomist@health.local`, `patient_demo@health.local`
- `validate_session` returns linked `patient` profile
- `run_phase11_iam` / deploy hook

**Setup:**
```bash
bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.init.run_phase11_iam
```

---

## Phase 10 — Chrome web app + auth foundation

**Goal:** Chrome-ready web app with session auth, protected routes, and role-based dashboards sharing APIs with Flutter.

**Delivered:**
- `health_web_app` — `AuthContext`, localStorage session (`sid`), `validate_session` on boot
- API client aligned with Flutter (sid in body + Cookie header)
- **Public layout** — home, lab, pharmacy (no login required)
- **Staff layout** — sidebar shell for dashboards
- **Protected routes** — lab booking, account, dashboards
- **Role dashboards:** `/dashboard/patient`, `/franchisee`, `/phlebotomist`, `/staff`
- `get_my_bookings` wired into dashboards (role-scoped TRF list)
- Vite dev proxy for `/api`; production same-origin via nginx
- Updated `health_web_app/README.md`

**Build & deploy:**
```bash
cd health_web_app
npm ci
VITE_API_BASE_URL= npm run build
scp -r dist root@167.233.108.90:/opt/health-ecosystem/health_web_app/
```

**Test logins:** `franchise_hub@health.local` → franchisee dashboard; `lab_tech@health.local` → staff dashboard.

---

## Phase 1–5 — Clinical foundation

**Goal:** Replace Marley Healthcare with native `health_ecosystem_core` clinical workflows.

**Delivered:**
- DocTypes: Health Patient, Patient Care Journey, Clinical Prescription, Nursing Assessment, Diagnostic Test Master, etc.
- Care journey pipeline: Nursing Intake → … → Authorized → Dispatched
- Mobile APIs: clinical home, appointments, prescriptions, patient journey
- Customer TRF + Lab Test Result + franchisee + pharmacy orders
- LIS bridge: `get_barcode_tests`, `log_machine_result` (machine API key auth)
- Desk JS: `patient_care_journey.js`, `clinical_prescription.js`, `customer_trf.js`

**Key modules:**
- `clinical_journey.py`, `clinical_prescriptions.py`, `clinical_workflow.py`
- `clinical_setup.py`, `clinical_utils.py`, `patient_bridge.py`
- `api.py` (TRF, bookings, catalog)

---

## Phase 6 — Multi-test TRF & panels

**Goal:** One TRF for multiple tests; health packages; branded PDF.

**Delivered:**
- Child tables: **TRF Test Item**, **Lab Test Panel**, **Lab Test Panel Item**
- `clinical_phase6.py`: `setup_phase6`, `sync_phase6_doctypes`, `parse_trf_test_items`, `panel_catalog_payload`
- `create_customer_trf` / `book_lab_test` accept `test_items`, `panel_id`
- Prescription diagnostics → single multi-line TRF (`order_diagnostics_from_prescription`)
- Branded report HTML (`render_branded_lab_report_html`) + journey PDF
- Patch: `patches/v1_0/ensure_phase6_child_tables.py`
- Deploy: `docker/deploy-clinical-apis.sh`

**Setup:**
```bash
bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.init.run_phase6_setup
```

**API highlights:**
- `clinical_diagnostics.get_lab_test_panels`
- `clinical_diagnostics.book_lab_panel`
- `api.book_lab_test` (supports `panel_id`, `test_items`)

---

## Phase 7 — Flutter mobile

**Goal:** Mobile app uses Phase 6 backend (panels, multi-test, prescriptions).

**Delivered (Flutter `health_flutter_app`):**
- `LabTestPanel` model, `getLabPanels()`, `bookLabPanel()`
- Lab catalog: **Health Packages** carousel
- `LabBookingScreen`: single test, panel, or prescription diagnostics
- `TrfBooking.displayTests`, multi-test labels from API
- Prescription detail → **Book prescribed lab tests**
- Care journey: grouped results from `structured.tests`
- Orders pull-to-refresh invalidates journey
- Fixes: `FranchiseeSearchField` defer callback; `listenManual` for auth

**Run app:**
```powershell
cd C:\develop\My_Lab_System\health_flutter_app
flutter run -d chrome --dart-define=API_BASE_URL=http://167.233.108.90:8080
```

**Backend addition for Phase 7:**
- `_serialize_trf` returns `tests`, `test_labels`
- Multi-test TRF creation in `clinical_utils.create_customer_trf_booking` (avoids stale `api.py` on server)

---

## Phase 8 — NABL lab report authoring

**Goal:** Match legacy biochemistry report screen + Remedium PDF sample for accreditation.

**Delivered:**

### DocTypes
- **Lab Report** — NABL metadata, timestamps, signatories
- **Lab Report Parameter** — result grid (code, parameter, result, unit, ranges, method, interpretation, calculated)
- Extended **Diagnostic Test Master** — `report_category`, `machine_method`, `interpretation`
- Extended **Diagnostic Test Parameter** — `parameter_code`, `method`, `is_calculated`, `formula`, `interpretation`

### Desk workflow
1. **Customer TRF** (In Lab / Completed) → **Open Lab Report**
2. Parameter grid from Diagnostic Test Master (multi-parameter per test)
3. **Import Machine Results** · **Recalculate Derived** · **Finalize & Send for Review**
4. **Preview NABL PDF**
5. Pathologist **Authorize** on Care Journey → PDF attached

### PDF (`clinical_report_format.py`)
- Remedium-style layout: patient header, timestamps (Collection / Received / Report / Dispatch / Printed)
- Per-test sections: category, test name, TEST|VALUE|UNIT|REFERENCE
- **Bold** out-of-range values
- Method + Interpretation blocks
- Dual investigator signatures, End Of Report

### Calculated parameters
- Formula on master parameter, e.g. `{TOTAL_BILI} - {DIRECT_BILI}`
- `apply_calculated_parameters()` on save / finalize / recalculate

### LIS behaviour
- TRF completes only when all expected parameters have results (`trf_results_complete`)
- Auto-creates Lab Report on machine result

### Setup
```bash
bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.init.run_phase8_setup
```

**Patch:** `patches/v1_0/ensure_phase8_lab_report.py`

---

## Deploy checklist (server)

1. Upload from **develop** copy (not OneDrive):
   ```powershell
   scp -r C:\develop\My_Lab_System\health_ecosystem_core root@167.233.108.90:/opt/health-ecosystem/
   scp C:\develop\My_Lab_System\docker\deploy-clinical-apis.sh root@167.233.108.90:/opt/health-ecosystem/docker/
   ```

2. On server:
   ```bash
   sed -i 's/\r$//' /opt/health-ecosystem/docker/deploy-clinical-apis.sh
   bash /opt/health-ecosystem/docker/deploy-clinical-apis.sh
   cd /opt/health-ecosystem/docker && docker compose restart backend
   ```

3. Hard-refresh Frappe desk (Ctrl+Shift+R).

**Note:** This stack uses **Docker Compose + Gunicorn**, not supervisor — `bench restart` will warn; use `docker compose restart backend`.

**Deploy script syncs:**
- Top-level Python: `api.py`, `clinical_phase6.py`, `clinical_phase8.py`, `clinical_report_format.py`, `clinical_utils.py`, …
- All `doctype/*/` controllers into site-packages
- `pip install --force-reinstall` + migrate + `setup_phase6` + `setup_phase8`

---

## Key file index (by phase)

| Area | Paths |
|------|--------|
| Phase 6 | `clinical_phase6.py`, `doctype/trf_test_item/`, `doctype/lab_test_panel/` |
| Phase 7 | `health_flutter_app/lib/features/lab/`, `clinical/`, `orders/` |
| Phase 8 | `clinical_phase8.py`, `clinical_report_format.py`, `doctype/lab_report/`, `public/js/lab_report.js` |
| TRF core | `api.py`, `clinical_utils.py` (`create_customer_trf_booking`) |
| Journey / PDF | `clinical_journey.py` (`generate_lab_report_pdf`, `authorize_lab_report`) |
| Deploy | `docker/deploy-clinical-apis.sh`, `docker/sync-hec-assets.sh` |
| Init | `init.py` → `run_phase6_setup`, `run_phase8_setup`, `run_clinical_setup` |

---

## API quick reference

| Method | Module | Purpose |
|--------|--------|---------|
| `book_lab_test` | `api` | Mobile single/panel booking |
| `get_lab_test_panels` | `clinical_diagnostics` | Panel catalog |
| `book_lab_panel` | `clinical_diagnostics` | Panel → TRF |
| `order_diagnostics_from_prescription` | `clinical_diagnostics` | Rx → multi-test TRF |
| `get_or_create_lab_report` | `clinical_phase8` | Desk report from TRF |
| `finalize_lab_report` | `clinical_phase8` | Sync results + journey |
| `get_lab_report_preview_html` | `clinical_phase8` | PDF preview |
| `recalculate_lab_report` | `clinical_phase8` | Derived parameters |
| `log_machine_result` | `api` | LIS ingest |
| `authorize_lab_report` | `clinical_journey` | Pathologist sign-off |

---

## Known issues & workarounds (minor)

| Issue | Cause | Workaround / fix |
|-------|--------|------------------|
| `ImportError: Lab Report Parameter` | Stale site-packages missing doctype controller | Upload `lab_report_parameter.py`; deploy script doctype sync; restart backend |
| `test_items` unexpected keyword | Old `api.py` in memory | Use `clinical_utils.create_customer_trf_booking`; restart backend |
| Department `Pathology` invalid | Master dept ≠ Lab Report select | `normalize_lab_report_department()` maps to Clinical Pathology |
| `bench restart` fails | No supervisor in Docker | `docker compose restart backend` |
| Deploy script `$'\r'` error | Windows CRLF | `sed -i 's/\r$//'` on `.sh` before run |
| Investigator qualifications empty | Pulled from User `bio` field | Fill User bio or add custom signature fields later |
| QR code on PDF | Not implemented yet | Planned follow-up |
| OneDrive copy outdated | Sync lag | Always deploy from `C:\develop\My_Lab_System` |

---

## Master data setup (NABL)

1. **Diagnostic Test Master** per test (e.g. SGPT, UREA, Bilirubin panel):
   - Report Category Heading: `CLINICAL BIOCHEMISTRY`
   - Parameters: code, unit, normal min/max, method
   - Interpretation: literature paragraph
   - Calculated rows: `is_calculated` + formula `{CODE_A} - {CODE_B}`

2. **Lab Test Panel** (mobile packages): `show_on_mobile = 1`, active, tests child table

3. **Health Ecosystem Settings**: lab name, logo, accent colour, footer (Phase 6 branding)

4. **Users**: Pathologist / Biochemist as investigators; optional qualifications in User bio

---

## Suggested next phases

| Phase | Topic |
|-------|--------|
| **9** | QR code + barcode image on PDF; signature image upload |
| **10** | Print Format / dispatch tracking; report reprint audit |
| **11** | Razorpay on multi-test orders; payment gate for LIS |
| **12** | Age/gender reference ranges; critical value alerts |
| **13** | Flutter lab-tech: manual result entry + report preview |

---

## Backup before next step

**Use the release script (recommended):**
```bash
bash /opt/health-ecosystem/docker/backup-before-release.sh v1.0.1-web
```

Manual steps:
1. **Git commit** on develop tree with message e.g. `chore: snapshot v1.0.1-web`
2. **Tag** `v1.0.1-web` (see snapshot tags above)
3. **Server tarball** — included in `backup-before-release.sh`
4. **DB backup** — included in `backup-before-release.sh` (`bench backup --with-files`)

---

*This file is the single source of truth for phased delivery. Update it at the end of each phase before starting the next.*
