import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  type CollectionTubeRow,
  type PartnerTierPreview,
  type VectorEntry,
  type VectorOption,
} from '../../api';
import type { WalkInDraft } from '../../utils/walkInDraft';
import { formatPatientAge } from '../../utils/patientAge';
import { NablDrawPlan, NablSampleCell } from '../../components/NablSampleMeta';
import { printHubBill } from '../../utils/hubBillPrint';
import { printWorkOrderSlip } from '../../utils/workOrderPrint';

const HUB_CHANNEL = 'Hub Walk-in';

type BillLine = {
  key: string;
  item: string;
  item_name: string;
  qty: number;
  rate: number;
  mrp?: number;
  show_mrp_slash?: boolean;
  platform_fee?: number;
  commission_value?: number;
  sample_type?: string;
  sample_requirement_label?: string;
  collection_tubes?: CollectionTubeRow[];
  hec_disc_percent: number;
  hec_disc_amount: number;
  hec_remark: string;
  _disc_source: 'pct' | 'amt' | '';
};

const COLLECTION_TO_RECEIPT: Record<string, string> = {
  cash: 'CASH',
  card: 'CARD',
  upi: 'UPI',
  bank: 'NEFT',
};

function money(n: number) {
  return `₹${(Number(n) || 0).toFixed(2)}`;
}

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function lineMath(row: BillLine) {
  const qty = Number(row.qty) || 1;
  const rate = Number(row.rate) || 0;
  const gross = qty * rate;
  let discPct = Number(row.hec_disc_percent) || 0;
  let discAmt = Number(row.hec_disc_amount) || 0;
  if (row._disc_source === 'amt' && discAmt && gross) {
    discPct = (discAmt * 100) / gross;
  } else if (discPct) {
    discAmt = (gross * discPct) / 100;
  }
  return {
    amount: gross,
    hec_disc_percent: discPct,
    hec_disc_amount: discAmt,
    hec_r_amount: Math.max(gross - discAmt, 0),
  };
}

function BillRateCell({ row }: { row: BillLine }) {
  const rate = Number(row.rate) || 0;
  const mrp = Number(row.mrp) || 0;
  if (row.show_mrp_slash && mrp > rate) {
    return (
      <span className="nabl-rate">
        <span className="price-slash-wrap" aria-label={`MRP ${money(mrp)}`}>
          <span className="price-mrp">{money(mrp)}</span>
          <span className="price-slash" aria-hidden />
        </span>
        <span className="nabl-rate-bill">{money(rate)}</span>
      </span>
    );
  }
  return <span>{money(rate)}</span>;
}

type Props = {
  draft: WalkInDraft;
  onBack: () => void;
  onSaved?: (result: { name: string; unique_barcode: string }) => void;
};

export function HubBillEntryStep({ draft, onBack, onSaved }: Props) {
  const [lines, setLines] = useState<BillLine[]>([]);
  const [collCharge, setCollCharge] = useState('0');
  const [remarks, setRemarks] = useState(draft.notes || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [creditLimit, setCreditLimit] = useState(0);
  const [availableToBill, setAvailableToBill] = useState<number | null>(null);
  const [franchiseeType, setFranchiseeType] = useState('Pulse');
  const [pricingRule, setPricingRule] = useState<string | null>(null);
  const [tierPreview, setTierPreview] = useState<PartnerTierPreview | null>(null);
  const [vectorEntry, setVectorEntry] = useState<VectorEntry | null>(null);
  const [billToVectors, setBillToVectors] = useState<VectorOption[]>([]);
  const [billTo, setBillTo] = useState('');
  const [hubLabel, setHubLabel] = useState<string | null>(null);
  const [result, setResult] = useState<{ name: string; unique_barcode: string } | null>(null);
  const [savedBill, setSavedBill] = useState<Record<string, unknown> | null>(null);

  const receiptMode = COLLECTION_TO_RECEIPT[draft.collectionMode] || 'CASH';
  const received = draft.amountReceived.trim() || '';

  useEffect(() => {
    void api.getHubLabBillDefaults().then((res) => {
      setHubLabel(res.data.hub_label || null);
      setWalletBalance(res.data.wallet_balance != null ? Number(res.data.wallet_balance) : null);
      setCreditLimit(Number(res.data.credit_limit || 0));
      setAvailableToBill(
        res.data.available_to_bill != null
          ? Number(res.data.available_to_bill)
          : res.data.wallet_balance != null
            ? Number(res.data.wallet_balance)
            : null,
      );
      setFranchiseeType(res.data.franchisee_type || 'Pulse');
      setPricingRule(res.data.pricing_rule || null);
      setVectorEntry(res.data.vector_entry || null);
      setBillToVectors(res.data.bill_to_vectors || []);
    });
  }, [draft]);

  useEffect(() => {
    const seed = draft.selectedItems.map((it) => ({
      item: it.item_code,
      item_name: it.item_name,
      qty: 1,
      rate: it.retail_rate,
    }));
    void api.repriceHubLabBillLines(seed, billTo || undefined).then((res) => {
      const repriced = res.data.tests || [];
      setTierPreview(res.data.partner_tier?.applied ? res.data.partner_tier : null);
      setLines(
        repriced.map((row) => {
          const r = row as Record<string, unknown>;
          return {
            key: uid('t'),
            item: String(r.item || ''),
            item_name: String(r.item_name || r.item || ''),
            qty: Number(r.qty || 1),
            rate: Number(r.rate || 0),
            mrp: Number(r.mrp || 0) || undefined,
            show_mrp_slash: Boolean(r.show_mrp_slash),
            platform_fee: Number(r.platform_fee || 0) || undefined,
            commission_value: Number(r.commission_value || 0) || undefined,
            sample_type: String(r.sample_type || ''),
            sample_requirement_label: String(r.sample_requirement_label || ''),
            collection_tubes: (Array.isArray(r.collection_tubes) ? r.collection_tubes : []) as CollectionTubeRow[],
            hec_disc_percent: 0,
            hec_disc_amount: 0,
            hec_remark: '',
            _disc_source: '' as const,
          };
        }),
      );
    });
  }, [draft, billTo]);

  const vectorPath = Boolean(vectorEntry || billTo || tierPreview?.vector);
  const billToVectorName = billToVectors.find((v) => v.id === billTo)?.name || billTo;

  const totals = useMemo(() => {
    const computedLines = lines.map((row) => ({ ...row, ...lineMath(row) }));
    const testAmount = computedLines.reduce((s, r) => s + r.hec_r_amount, 0);
    const coll = Number(collCharge) || 0;
    const discHeader = Number(draft.discountInput) || 0;
    const net = Math.max(testAmount + coll - discHeader, 0);
    const recv = Number(received) || net;
    const due = Math.max(net - recv, 0);
    const platformFee = computedLines.reduce(
      (s, r) => s + (Number(r.platform_fee) || 0) * (Number(r.qty) || 1),
      0,
    );
    const commission = computedLines.reduce(
      (s, r) => s + (Number(r.commission_value) || 0) * (Number(r.qty) || 1),
      0,
    );
    return {
      lines: computedLines,
      hec_net_amount: net,
      hec_received: recv,
      hec_due_amount: due,
      hec_amount_paid: recv,
      platform_fee: platformFee,
      commission,
    };
  }, [lines, collCharge, draft.discountInput, received]);

  // Vector bills adjust the entry partner's deposit (checked on save), never the Vector's own wallet.
  const walletBlocked =
    !vectorPath && availableToBill != null && totals.platform_fee > 0 && availableToBill + 1e-9 < totals.platform_fee;

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!totals.lines.length) {
      setError('Add at least one test.');
      return;
    }
    if (walletBlocked) {
      setError(
        `Billing stopped: platform fee ${money(totals.platform_fee)} exceeds available ${money(availableToBill || 0)}.`,
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const referred =
        draft.refBy === 'Doctor' || draft.referringDoctorId
          ? draft.referringDoctorName || 'Self'
          : draft.refBy === 'Walk-in / Self'
            ? 'Self'
            : draft.refBy;
      const res = await api.saveHubLabBill({
        patient_name: draft.patientName.trim(),
        age: Number(draft.age || 0),
        age_months: Number(draft.ageMonths || 0),
        age_days: Number(draft.ageDays || 0),
        gender: draft.gender,
        patient_phone: draft.patientPhone.trim(),
        hec_whatsapp: draft.whatsapp.trim() || undefined,
        collection_address: draft.address.trim(),
        referred_doctor: referred,
        referring_doctor_id:
          draft.referringDoctorId && draft.referringDoctorId !== 'Self'
            ? draft.referringDoctorId
            : undefined,
        ref_doctor_commission_percent:
          draft.referringDoctorId && draft.refCommissionPercent.trim()
            ? Number(draft.refCommissionPercent)
            : undefined,
        hec_lab_remarks: remarks.trim(),
        hec_coll_charge: Number(collCharge) || 0,
        sample_intake_channel: HUB_CHANNEL,
        tests: totals.lines.map((row) => ({
          item: row.item,
          item_name: row.item_name,
          qty: row.qty,
          rate: row.rate,
          hec_disc_percent: row.hec_disc_percent,
          hec_disc_amount: row.hec_disc_amount,
          hec_remark: row.hec_remark,
        })),
        hec_receipt_mode: receiptMode,
        hec_receipt_amount: Number(received) || totals.hec_net_amount,
        hec_amount_paid: Number(received) || totals.hec_net_amount,
        hec_received: Number(received) || totals.hec_net_amount,
        hec_due_amount: totals.hec_due_amount,
        hec_net_amount: totals.hec_net_amount,
        hec_cheque_date: draft.paymentDate || undefined,
        bill_to_vector: billTo || undefined,
      });
      if (res.data.wallet_balance != null) setWalletBalance(Number(res.data.wallet_balance));
      const saved = { name: res.data.name, unique_barcode: res.data.unique_barcode };
      setResult(saved);
      const billRes = await api.getHubLabBill(saved.name);
      const bill = billRes.data.bill as Record<string, unknown>;
      setSavedBill(bill);
      printHubBill(bill);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="partners-order-card">
        <h2 className="partners-page-title" style={{ fontSize: '1.25rem' }}>
          Work order slip saved
        </h2>
        <p>
          TRF <code>{result.name}</code> · Barcode <code>{result.unique_barcode}</code>
        </p>
        <p className="partners-page-lead">
          {vectorPath
            ? 'Dummy patient bill (no books). Entry partner deposit adjusted and B2B bill raised to the Vector. Patient payment tracked on Bill Status'
            : 'Platform fee debited from wallet. Patient payment tracked on Bill Status'}
          {savedBill?.hec_due_amount != null && Number(savedBill.hec_due_amount) > 0
            ? ` · Due ${money(Number(savedBill.hec_due_amount))}`
            : ' · Paid in full'}
          .
        </p>
        <div className="partners-actions-row">
          <button
            type="button"
            className="partners-btn partners-btn-primary"
            onClick={() =>
              void api.getHubLabBill(result.name).then((r) =>
                printHubBill(r.data.bill as Record<string, unknown>),
              )
            }
          >
            Print bill
          </button>
          <button
            type="button"
            className="partners-btn partners-btn-outline"
            onClick={() => savedBill && printWorkOrderSlip(savedBill)}
            disabled={!savedBill}
          >
            Print work order
          </button>
          <Link className="partners-btn partners-btn-outline" to="/b2b/bill-status">
            Bill Status
          </Link>
          <button type="button" className="partners-btn partners-btn-outline" onClick={() => result && onSaved?.(result)}>
            New walk-in
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="partners-order-card" onSubmit={(e) => void onSave(e)}>
      <div className="partners-wizard-steps">
        <button type="button" className="partners-wizard-step done" onClick={onBack}>
          1 Walk-in intake
        </button>
        <span className="partners-wizard-arrow">→</span>
        <span className="partners-wizard-step active">2 Work order slip</span>
      </div>

      <p className="partners-page-lead">
        {hubLabel ? `${hubLabel} · ` : ''}
        {HUB_CHANNEL}
        {franchiseeType ? ` · ${franchiseeType}` : ''}
        {walletBalance != null ? ` · Wallet ${money(walletBalance)}` : ''}
        {franchiseeType === 'Vector' && creditLimit > 0 ? ` · Credit ${money(creditLimit)}` : ''}
        {availableToBill != null ? ` · Available ${money(availableToBill)}` : ''}
      </p>
      {pricingRule ? <p className="partners-page-lead">{pricingRule}</p> : null}
      {vectorEntry ? (
        <div className="partners-alert">
          Entered via <b>{vectorEntry.entry_name}</b> ({vectorEntry.entry_tier}). Patient bill is full MRP (dummy, no
          books). Payable to {vectorEntry.entry_name}: the B2B amount below, settled directly with them.
        </div>
      ) : null}
      {!vectorEntry && billToVectors.length ? (
        <label className="partners-field">
          <span>Bill to</span>
          <span className="partners-input-wrap">
            <select value={billTo} onChange={(e) => setBillTo(e.target.value)} aria-label="Bill to">
              <option value="">Patient (normal FOCO bill)</option>
              {billToVectors.map((v) => (
                <option key={v.id} value={v.id}>
                  Vector — {v.name}
                </option>
              ))}
            </select>
          </span>
          {billTo ? (
            <small className="partners-page-lead">
              Bill raised for {billToVectorName}: patient gets a dummy MRP bill; {billToVectorName} owes your FOCO the
              B2B amount (settled offline); your deposit is adjusted as a normal FOCO bill.
            </small>
          ) : null}
        </label>
      ) : null}

      <div className="partners-bill-summary">
        <div>
          <strong>{draft.patientName}</strong>
          <span>
            {[draft.gender, formatPatientAge({ age: draft.age, ageMonths: draft.ageMonths, ageDays: draft.ageDays })]
              .filter(Boolean)
              .join(', ')}{' '}
            · {draft.patientPhone}
          </span>
        </div>
        <div>
          <span>Referred by: {draft.referringDoctorName || draft.refBy}</span>
          {draft.address ? <span> · {draft.address}</span> : null}
        </div>
      </div>

      <div className="table-wrap">
        <table className="data-table partners-bill-table nabl-work-table">
          <thead>
            <tr>
              <th>Test</th>
              <th>Sample / tube / vol</th>
              <th>Rate</th>
              <th>Qty</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {totals.lines.map((row) => (
              <tr key={row.key}>
                <td>
                  <strong>{row.item_name}</strong>
                  <div className="muted">{row.item}</div>
                </td>
                <td>
                  <NablSampleCell row={row} />
                </td>
                <td>
                  <BillRateCell row={row} />
                </td>
                <td>{row.qty}</td>
                <td>{money(row.hec_r_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <NablDrawPlan lines={totals.lines} />

      <div className="partners-field-row">
        <label className="partners-field">
          <span>Coll. charge</span>
          <span className="partners-input-wrap">
            <input
              type="number"
              min={0}
              step="0.01"
              value={collCharge}
              onChange={(e) => setCollCharge(e.target.value)}
            />
          </span>
        </label>
        <label className="partners-field">
          <span>Header discount (₹)</span>
          <span className="partners-input-wrap">
            <input type="number" readOnly value={draft.discountInput || '0'} />
          </span>
        </label>
      </div>

      <div className="partners-price-box">
        <div>
          <span>{tierPreview?.vector ? 'Patient bill (dummy MRP, no books)' : 'Net amount (patient)'}</span>
          <strong>{money(totals.hec_net_amount)}</strong>
        </div>
        {tierPreview?.vector ? (
          <>
            <div>
              <span>B2B bill to Vector (settled offline)</span>
              <strong>{money(tierPreview.b2b_amount ?? totals.platform_fee)}</strong>
            </div>
            <div>
              <span>Entry partner</span>
              <strong>
                {tierPreview.entry_name} ({tierPreview.entry_tier})
              </strong>
            </div>
          </>
        ) : (
        <div>
          <span>
            {tierPreview
              ? `Deposit adjustment (${tierPreview.tier} circuit)`
              : franchiseeType === 'Vector'
                ? 'Platform fee (wholesale)'
                : 'Platform fee (FOCO − commission)'}
          </span>
          <strong>{tierPreview ? `−${money(totals.platform_fee)}` : money(totals.platform_fee)}</strong>
        </div>
        )}
        {tierPreview?.vector ? null : tierPreview ? (
          <div>
            <span>Circuit</span>
            <strong>
              {[tierPreview.master_foco_name, tierPreview.lab_name].filter(Boolean).join(' → ') || tierPreview.tier}
            </strong>
          </div>
        ) : (
          <div>
            <span>Your commission</span>
            <strong>{money(totals.commission)}</strong>
          </div>
        )}
        <div>
          <span>Received ({receiptMode})</span>
          <strong>{money(totals.hec_received)}</strong>
        </div>
        <div>
          <span>Due</span>
          <strong>{money(totals.hec_due_amount)}</strong>
        </div>
      </div>
      {walletBlocked ? (
        <div className="partners-alert error">
          Billing stopped: platform fee {money(totals.platform_fee)} exceeds available{' '}
          {money(availableToBill || 0)}
          {franchiseeType === 'Vector' ? ' (wallet + credit limit)' : ' (wallet)'}.
        </div>
      ) : null}

      <label className="partners-field">
        <span>Remarks</span>
        <span className="partners-input-wrap textarea">
          <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} />
        </span>
      </label>

      {error ? <div className="partners-alert error">{error}</div> : null}

      <div className="partners-actions-row">
        <button type="button" className="partners-btn partners-btn-outline" onClick={onBack}>
          ← Back to intake
        </button>
        <button type="submit" className="partners-btn partners-btn-primary" disabled={busy || walletBlocked}>
          {busy ? 'Saving…' : 'Save work order & print bill'}
        </button>
      </div>
    </form>
  );
}
