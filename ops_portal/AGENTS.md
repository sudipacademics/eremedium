# Smilecure Operations Department portal

Staff console for Lab, Care, Aesthetic and Pharmacy. Public URL: https://ops.e-remedium.in
It runs on the same Hetzner server as remediumlabs.in (`167.233.108.90`).

## Run

```bash
npm install
npm run dev    # http://127.0.0.1:5182/
npm run build  # dist/ for the domain root
```

`/api` and `/files` proxy to the live labs site, the same way the aesthetics site does. The dashboard itself is the operations desk: bookings, approvals, stock and tasks are handled in the portal.

Most screens still use the session data in `src/data.ts`. Sign-in is `public/ops-gate.js` (HRMS login + Portal Access), which keeps the session in `localStorage.ops_session`.

## Pharmacy stock (live data)

Inventory & Purchase → **Pharmacy** (`/inventory/pharmacy`, `src/components/Pharmacy.tsx`, client in `src/pharmacyApi.ts`) is backed by `health_ecosystem_core/.../clinical_ops_pharmacy.py`, shipped as a People add-on backend module (`people-addons/backend`). It owns the `Ops Med *` DocTypes: medicines, vendors, locations, batches, bins (stock per location + batch), the movement ledger, purchases, requisitions, dispatches, returns, adjustments and an audit log. All stock changes go through `_move`, which writes a ledger row.

- Locations: the Central Pharmacy Store plus every Care branch from the Care branch directory (auto-added); more can be added in Branches & Stores.
- Access: Operations Manager / System Manager, or Inventory & Purchase at Approve/Manage in Portal Access, run everything. Other Operations users act only for their branches (location staff list, Care branch scope, or HR Unit/Centre).
- Dispatch is FEFO from the central store; expired batches are never picked, can't be received and can't be increased. Delivery confirmation adds stock at the branch. Each dispatch has a PDF delivery challan.
- ERP import ("Import from ERP", manager): `erp_preview` / `erp_import` read ERPNext items (groups Medicines, Products, and any medic/pharma/drug group) and batch stock in one warehouse (default `Stores - RESLD`). Ticked items are added or refreshed in `Ops Medicine` (`erp_item` = ERP item code; MRP, pack size and HSN from the pharma-bill fields `hec_*`). For each ERP batch, the Central Pharmacy Store is set to the ERP quantity, posted as an `ERP-YY-####` adjustment with "ERP Import" ledger rows. Batches that exist only here are left alone. ERP stock without a batch or expiry, and expired ERP batches, are skipped and reported. On 2026-11-06 the sample data and all earlier transactions were cleared and the 7 real ERP medicines imported. Sample medicines are only seeded on a brand-new install (no medicines and no audit rows).
- ERP two-way stock sync (`clinical_ops_pharmacy_erp.py`, add-on backend module, switched on 2026-11-06 from Branches & Stores → "ERP stock records"):
  - **ERP records (company Smilecure Lifestyle Private Limited):** warehouse group `Pharmacy - RESLD` with one warehouse per location (`Ops Med Location.erp_warehouse`) plus `Pharmacy In Transit - RESLD`. Medicines are ERP Items (group Medicines, batch + expiry, pharmacy fields `hec_dosage_form/strength/drug_schedule/storage/reorder_*`, `hec_ops_medicine`). Batches are ERP Batches (`Ops Med Batch.erp_batch`, `hec_mrp`, `hec_purchase_rate`). Settings live in the site default `ops_pharmacy_erp`.
  - **Ops → ERP:** `_move` calls `push`, which posts a submitted Stock Entry (field `hec_ops_voucher`) in the same transaction; the ledger keeps it in `erp_voucher`, and an ERP refusal fails the Ops action. Dispatch and branch Return Out go into transit; Receipt, Dispatch Cancelled and Return In come out of it. Other inflows become Material Receipts and outflows Material Issues.
  - **ERP → Ops:** `pull` runs at the start of every Ops and Care pharmacy request (at most every 15 s). It compares ERP batch stock in the pharmacy warehouses with the Ops bins and posts any difference in Ops as "ERP Adjustment". New ERP items and batches are created in Ops. ERP stock without a batch is only reported. Moves made by `pull` are never pushed back.
  - **Fiscal year:** Stock Entries need an ERP fiscal year covering the posting date; 2026-2027 runs until 31 Mar 2027.
- Outside purchases (`Ops Med External Request`, `EPR-YY-####`): a branch that wants to buy from an outside vendor first sends medicine, quantity, vendor, price and reason. Only the Operations Manager approves (picks the master medicine, can cut quantity and price, sets validity, default 15 days; the vendor is added as "Branch local vendor") or rejects with a note. The bill can be entered only on an approved, unexpired request, within the approved quantity (free units count) and price; it posts a branch GRN (`BGRN-…`, purchase `source` = "Branch external") and "External Purchase" ledger rows at that branch. Purchase posting is shared with central purchases in `_post_purchase`.

## Aesthetic inventory (same stock engine)

Inventory & Purchase → **Aesthetic** (`/inventory/aesthetic?cat=consumables|products`) runs on the same engine and screen as Pharmacy (`Pharmacy.tsx`; `setStockDomain` in `pharmacyApi.ts` adds `domain` to every call; wording comes from `TERMS`).

- **Separate inventories:**
  - Backend `DOMAINS` (`clinical_ops_pharmacy.py`): `pharmacy`, `aes_consumable`, `aes_product`.
  - Every item and transaction (`Ops Medicine`, ledger, purchase, requisition, dispatch, return, adjustment, external request, audit, `Ops Med Sale`) carries `domain`; existing rows were set to `pharmacy`.
  - Locations carry `store` (Pharmacy / Aesthetic). The Aesthetic store was seeded with Aesthetic Central Store, Bongaon Aesthetic and Barasat Aesthetic.
  - A request without `domain` (Care portal, older calls) is the pharmacy.
- **Number series:** requisitions / orders MR / CR / OR; challans DC / CDC / PDC; returns RT / CRT / PRT; retail sales SL; items MED- / CON- / PRD-.
- **Consumables:**
  - Branch requisitions; Ops approves (fully or partly), rejects, and dispatches with a delivery challan.
  - The branch counts received quantities; shortages need a note and are issued out of ERP transit.
  - Branch returns are requests (`Requested`) until Ops approves them; approval moves the stock and issues a return challan (`return_challan_pdf`).
- **Products:**
  - Product orders work the same way.
  - Transfer price is on the item and on the challan lines.
  - Branch retail sales (`save_sale`, FEFO, never above MRP) and sale returns (`return_sale`, pro-rata refund).
  - Outside purchases use the same approval workflow as Pharmacy.
- **Access:**
  - Ops Manager as for Pharmacy.
  - Aesthetic branch staff: Portal Access → Aesthetic Backend → **Products** level (or the Aesthetic Staff / Manager roles); approve / manage covers every aesthetic branch, on the branch side only.
  - Branches: location staff list, or HR Unit/Centre matching the branch name, city or code.
- **Branch portal:**
  - The Aesthetic console (aesthetics.e-remedium.in) embeds this page through the add-on `health_web_app/public/aesthetic-stock.js`, shipped in the People add-on store.
  - Products → Inventory shows consumables; Products → Purchase & Stock shows products.
  - `ops-gate.js` embed mode only allows `/inventory/aesthetic?embed=1`, takes the console session by `postMessage`, and admits Aesthetic Products access.
  - nginx allows framing only by `https://aesthetics.e-remedium.in` (CSP `frame-ancestors`).
- **ERP:**
  - Aesthetic warehouses sit under `Aesthetic - RESLD` (plus `Aesthetic In Transit - RESLD`).
  - Item groups are Aesthetic Consumables and Aesthetic Products.
  - ERP postings run with system rights (`_system()`); branch staff have no ERPNext stock roles.
  - Creating a brand-new ERP Item commits the transaction, so items are created when they are saved, not during a stock move.

## Vendor Management (live data)

`/vendors` (`src/components/Vendors.tsx`, client `vendorCall` in `src/pharmacyApi.ts`) is backed by `health_ecosystem_core/.../clinical_ops_vendors.py`, which is also a People add-on backend module.

- **Vendor master:** there is one, shared with the pharmacy: `Ops Med Vendor`, widened with `vendor_code` (VN-###), city/state/pincode, PAN, rating, `status` (Active / On Hold / Inactive), payment terms / credit days, bank details and `opening_balance`.
- **Supplies:** the vendor's `supplies` field (JSON) lists the materials and products it supplies: item, type, brand, pack, rate, minimum order and lead days. A row can link an Ops stock item (`ops_item`, any inventory). The vendor search also matches supplied items. In CSV, `supplies` is `Item (Brand); Item`, and re-import keeps the details of items already listed. Product brochures and price lists are vendor documents (types "Product Brochure" / "Price List / Catalogue"); the Add / Edit vendor form uploads them right after the vendor is saved.
- **Records around it:** `Ops Vendor Category` (seeded: Medicine, Reagent, Consumable, Device & Peel, Cold Logistics, Equipment & AMC, Services), `Ops Vendor PO` (PO-YY-####, Draft → Sent → Received / Cancelled, PDF), `Ops Vendor Payment` (VP-YY-####) and `Ops Vendor Document` (private File, expiry date).
- **Money:**
  - Purchases = pharmacy goods receipts (`Ops Med Purchase`) + received POs.
  - Purchase (YTD) counts from 1 April.
  - Outstanding = opening balance + purchases − payments.
- **Hold rule:** vendors On Hold or Inactive get no new POs and no pharmacy goods receipts (`check_vendor_open` in `_post_purchase`).
- **Access (Portal Access → Operations → Vendor Management):**
  - view: see everything;
  - create: add vendors, POs and documents;
  - edit: also edit vendors and move POs on;
  - approve: also payments, status, categories and import;
  - manage: also delete.
  - Operations Manager / System Manager have manage.
- **Import / export:** CSV in the template columns; on import, vendors are matched by code, then GSTIN, then name.

## Deploy

- Web root: `/opt/health-ecosystem/ops_portal/dist`
- Config: `/etc/nginx/sites-available/ops.e-remedium.in` (source in `nginx/ops.e-remedium.in.conf`)
- Certificate: `/etc/letsencrypt/live/ops.e-remedium.in/`
- DNS: `ops.e-remedium.in` A/AAAA to `167.233.108.90`

Until the certificate exists, `nginx/ops.e-remedium.in.http.conf` serves the site on port 80 so certbot can complete.

After copying `dist/`, make sure `dist/assets` is `755` and its files `644` (scp has created it as `700`, which made nginx return 404 for the bundle). `ops-gate.js` and its `<script>` tag are re-installed by the People add-on restore cron.
