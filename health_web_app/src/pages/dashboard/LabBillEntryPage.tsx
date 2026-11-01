import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type CollectionTubeRow } from '../../api';
import { NablDrawPlan, NablSampleCell } from '../../components/NablSampleMeta';
import { ReferringDoctorPicker, type ReferringDoctorValue } from '../../components/ReferringDoctorPicker';
import { printWorkOrderSlip } from '../../utils/workOrderPrint';
import { formatPatientAge } from '../../utils/patientAge';
import './lab-bill-v2.css';

type BillLine = {
  key: string;
  item: string;
  item_name: string;
  qty: number;
  rate: number;
  mrp?: number;
  foco_rate?: number;
  show_mrp_slash?: boolean;
  price_basis?: string;
  sample_type?: string;
  sample_requirement_label?: string;
  collection_tubes?: CollectionTubeRow[];
  hec_disc_percent: number;
  hec_disc_amount: number;
  hec_remark: string;
  _disc_source: 'pct' | 'amt' | '';
};

type AdjustmentRow = {
  key: string;
  adjustment: string;
  percentage: number;
  amount: number;
  remark: string;
  conf_by: string;
};

type StaffRow = {
  key: string;
  staff_name: string;
  amount: number;
};

type CollectionCentreOpt = {
  name: string;
  label: string;
  franchise_name?: string;
  franchisee_type?: string;
  is_mother_lab?: number;
};

type SuggestTest = {
  item_code: string;
  item_name: string;
  rate: number;
  mrp?: number;
  foco_rate?: number;
  show_mrp_slash?: boolean;
  price_basis?: string;
  sample_type?: string;
  sample_requirement_label?: string;
  collection_tubes?: CollectionTubeRow[];
  kind?: string;
  panel_id?: string;
};

const CHANNELS = ['Direct to Mother Lab', 'Online / Courier Sample'] as const;
const HUB_CHANNEL = 'Hub Walk-in';

export type LabBillVariant = 'mother-lab' | 'hub-walk-in';

type HistoryBill = {
  name: string;
  unique_barcode?: string;
  patient_name?: string;
  age?: number;
  gender?: string;
  patient_phone?: string;
  order_status?: string;
  creation?: string;
  hec_bill_datetime?: string;
  sample_intake_channel?: string;
  hec_net_amount?: number;
  hec_amount_paid?: number;
  hec_due_amount?: number;
  hec_receipt_mode?: string;
};

function money(n: number) {
  return `₹${(Number(n) || 0).toFixed(2)}`;
}

function billRateHtml(rate: number, mrp?: number, showSlash?: boolean) {
  const r = Number(rate) || 0;
  const m = Number(mrp) || 0;
  if (showSlash && m > r) {
    return `<span class="rate-slash-wrap"><span class="rate-mrp">${money(m)}</span><span class="rate-slash"></span><span>${money(r)}</span></span>`;
  }
  return money(r);
}

function BillRateCell({ row }: { row: BillLine }) {
  const rate = Number(row.rate) || 0;
  const mrp = Number(row.mrp) || 0;
  if (row.show_mrp_slash && mrp > rate) {
    return (
      <span className="nabl-rate" title={`MRP ${money(mrp)} → bill ${money(rate)}`}>
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

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function printMotherLabBill(bill: Record<string, unknown>) {
  const tests = (Array.isArray(bill.tests) ? bill.tests : []) as Array<Record<string, unknown>>;
  const lines = tests
    .map((row, idx) => {
      const qty = Number(row.qty || 1) || 1;
      const rate = Number(row.rate || 0) || 0;
      const rAmt = Number(row.hec_r_amount != null ? row.hec_r_amount : qty * rate) || 0;
      const rateCell = billRateHtml(
        rate,
        Number(row.mrp || 0) || undefined,
        Boolean(row.show_mrp_slash),
      );
      return `<tr>
        <td>${idx + 1}</td>
        <td>${escapeHtml(row.item_name || row.item)}</td>
        <td>${escapeHtml(row.item)}</td>
        <td class="num">${qty}</td>
        <td class="num">${rateCell}</td>
        <td class="num">${money(rAmt)}</td>
      </tr>`;
    })
    .join('');
  const net = Number(bill.hec_net_amount || bill.amount || 0);
  const paid = Number(bill.hec_amount_paid || bill.hec_receipt_amount || bill.hec_received || 0);
  const due = Number(bill.hec_due_amount || Math.max(net - paid, 0));
  const centre = String(
    bill.hub_label || bill.mother_lab_label || bill.franchisee_id || 'Remedium Lab',
  );
  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Bill ${escapeHtml(bill.name)}</title>
<style>
  body{font:12px/1.4 'Segoe UI',Arial,sans-serif;color:#111;margin:24px}
  h1{margin:0 0 4px;font-size:18px}
  .muted{color:#555}
  table{width:100%;border-collapse:collapse;margin-top:12px}
  th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}
  th{background:#f3f4f6}
  .num{text-align:right}
  .rate-slash-wrap{display:inline-flex;align-items:center;gap:4px}
  .rate-mrp{text-decoration:line-through;color:#888;font-size:11px}
  .rate-slash{display:none}
  .totals{margin-top:12px;width:280px;margin-left:auto}
  .totals td{border:0;padding:3px 0}
  .totals .emph td{font-weight:700;background:#fef9c3;padding:4px 6px}
  @media print{body{margin:0}}
</style></head><body>
  <h1>REMEDIUM LAB — Patient Bill</h1>
  <p class="muted">${escapeHtml(centre)} · ${escapeHtml(bill.sample_intake_channel || 'Mother lab sample')}</p>
  <p>
    <strong>Bill No:</strong> ${escapeHtml(bill.name)} &nbsp;
    <strong>Barcode:</strong> ${escapeHtml(bill.unique_barcode)}<br/>
    <strong>Date:</strong> ${escapeHtml(bill.hec_bill_datetime || '')}<br/>
    <strong>Patient:</strong> ${escapeHtml(bill.patient_name)}
    (${escapeHtml([bill.gender, formatPatientAge(bill as Record<string, unknown>)].filter(Boolean).join(', '))}) &nbsp;
    <strong>Phone:</strong> ${escapeHtml(bill.patient_phone || '')}<br/>
    <strong>Refr. By:</strong> ${escapeHtml(bill.referred_doctor || 'Self')} &nbsp;
    <strong>Collected by:</strong> ${escapeHtml(String(bill.phlebotomist_name || bill.phlebotomist || 'Sample Collector'))}<br/>
    <strong>Receipt:</strong> ${escapeHtml(bill.hec_receipt_mode || '')}
    ${bill.hec_receipt_no ? ` #${escapeHtml(bill.hec_receipt_no)}` : ''}
  </p>
  <table>
    <thead><tr><th>#</th><th>Test</th><th>Code</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
    <tbody>${lines || '<tr><td colspan="6">No tests</td></tr>'}</tbody>
  </table>
  <table class="totals">
    <tr><td>Coll. Charge</td><td class="num">${money(Number(bill.hec_coll_charge || 0))}</td></tr>
    <tr class="emph"><td>Net Amount</td><td class="num">${money(net)}</td></tr>
    <tr><td>Amount Paid</td><td class="num">${money(paid)}</td></tr>
    <tr class="emph"><td>Due Amount</td><td class="num">${money(due)}</td></tr>
  </table>
  <p class="muted" style="margin-top:18px">Status: ${escapeHtml(bill.order_status || 'Booked')} — auto-generated bill.</p>
</body></html>`;

  const existing = document.getElementById('mother-lab-bill-print');
  if (existing) existing.remove();
  const iframe = document.createElement('iframe');
  iframe.id = 'mother-lab-bill-print';
  iframe.title = 'Mother lab bill print';
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText =
    'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none';
  document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  const doc = win?.document;
  if (!win || !doc) {
    iframe.remove();
    window.alert('Unable to open print dialog in this browser.');
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  window.setTimeout(() => {
    try {
      win.focus();
      win.print();
    } catch {
      window.alert('Print dialog could not be opened.');
    } finally {
      window.setTimeout(() => {
        try {
          iframe.remove();
        } catch {
          /* ignore */
        }
      }, 800);
    }
  }, 120);
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
  } else if (discAmt && gross) {
    discPct = (discAmt * 100) / gross;
  } else {
    discPct = 0;
    discAmt = 0;
  }
  return {
    amount: gross,
    hec_disc_percent: discPct,
    hec_disc_amount: discAmt,
    hec_r_amount: Math.max(gross - discAmt, 0),
  };
}

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function nowLocalDatetimeValue() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function MIcon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

const ICON_DOC = (
  <>
    <path d="M7 3h7l5 5v13H7z" />
    <path d="M14 3v5h5M10 13h6M10 17h6" />
  </>
);
const ICON_SEARCH = (
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </>
);
const ICON_CAL = (
  <>
    <rect x="3.5" y="5" width="17" height="15" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </>
);
const ICON_EMPTY = (
  <>
    <path d="M4 13l3-7h10l3 7v6H4z" />
    <path d="M4 13h5l1 2h4l1-2h5" />
  </>
);

function historyTone(status?: string) {
  const s = (status || '').toLowerCase();
  if (s.includes('collected') || s.includes('complete') || s.includes('dispatch') || s.includes('authoriz')) return 'green';
  if (s.includes('cancel') || s.includes('reject')) return 'red';
  if (s.includes('lab') || s.includes('progress')) return 'amber';
  return 'blue';
}

const HISTORY_PAGE_SIZE = 5;

/**
 * Mother-lab reception bill — Desk Bill Entry fields on SPA.
 * Saves Booked TRF; tubes received on /dashboard/accession.
 */
export function LabBillEntryPage({ variant = 'mother-lab' }: { variant?: LabBillVariant }) {
  const isHub = variant === 'hub-walk-in';
  const [motherId, setMotherId] = useState<string | null>(null);
  const [motherLabel, setMotherLabel] = useState<string | null>(null);
  const [centres, setCentres] = useState<CollectionCentreOpt[]>([]);
  const [defaultCentreId, setDefaultCentreId] = useState<string | null>(null);
  const [franchiseeType, setFranchiseeType] = useState<string>('Pulse');
  const [pricingRule, setPricingRule] = useState<string | null>(null);
  const [channel, setChannel] = useState<(typeof CHANNELS)[number] | typeof HUB_CHANNEL>(
    isHub ? HUB_CHANNEL : 'Direct to Mother Lab',
  );
  const [referringDoctor, setReferringDoctor] = useState<ReferringDoctorValue>({
    id: null,
    name: 'Self',
  });
  const [refCommissionPercent, setRefCommissionPercent] = useState('');
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [availableToBill, setAvailableToBill] = useState<number | null>(null);
  const [collectorUser, setCollectorUser] = useState<string | null>(null);
  const [collectorName, setCollectorName] = useState('Sample Collector');

  const [billDatetime, setBillDatetime] = useState(nowLocalDatetimeValue());
  const [labNo, setLabNo] = useState('');
  const [patientName, setPatientName] = useState('');
  const [gender, setGender] = useState('Male');
  const [age, setAge] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [guardian, setGuardian] = useState('');
  const [organization, setOrganization] = useState('');
  const [collCharge, setCollCharge] = useState('0');
  const [remarks, setRemarks] = useState('');

  const [lines, setLines] = useState<BillLine[]>([]);
  const [testQ, setTestQ] = useState('');
  const [testHits, setTestHits] = useState<SuggestTest[]>([]);
  const [testSearchMsg, setTestSearchMsg] = useState<string | null>(null);
  const [testSearching, setTestSearching] = useState(false);

  const [adjustments, setAdjustments] = useState<AdjustmentRow[]>([]);
  const [staffRows, setStaffRows] = useState<StaffRow[]>([]);

  const [receiptAmount, setReceiptAmount] = useState('');
  const [receiptMode, setReceiptMode] = useState('CASH');
  const [receiptNo, setReceiptNo] = useState('');
  const [chequeRef, setChequeRef] = useState('');
  const [chequeDate, setChequeDate] = useState('');
  const [bank, setBank] = useState('');
  const [amountPaid, setAmountPaid] = useState('');
  const [received, setReceived] = useState('');
  const [refund, setRefund] = useState('0');
  const [writtenOff, setWrittenOff] = useState('0');

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ name: string; unique_barcode: string } | null>(null);
  const [history, setHistory] = useState<HistoryBill[]>([]);
  const [historyQ, setHistoryQ] = useState('');
  const [historyBusy, setHistoryBusy] = useState(false);
  const [printBusy, setPrintBusy] = useState<string | null>(null);

  async function loadHistory(q = '') {
    setHistoryBusy(true);
    try {
      const res = isHub ? await api.listHubLabBills(40, q.trim()) : await api.listMotherLabBills(40, q.trim());
      setHistory((res.data.bills || []) as HistoryBill[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load bill history');
    } finally {
      setHistoryBusy(false);
    }
  }

  async function onPrintBill(name: string) {
    setPrintBusy(name);
    setError(null);
    try {
      const res = isHub ? await api.getHubLabBill(name) : await api.getMotherLabBill(name);
      printMotherLabBill(res.data.bill as Record<string, unknown>);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Print failed');
    } finally {
      setPrintBusy(null);
    }
  }

  async function onPrintWorkOrder(name: string) {
    setPrintBusy(`wo-${name}`);
    setError(null);
    try {
      const res = isHub ? await api.getHubLabBill(name) : await api.getMotherLabBill(name);
      printWorkOrderSlip(res.data.bill as Record<string, unknown>, isHub ? 'Hub Work Order Slip' : 'Mother Lab Work Order Slip');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Work order print failed');
    } finally {
      setPrintBusy(null);
    }
  }

  useEffect(() => {
    if (isHub) {
      void api
        .getHubLabBillDefaults()
        .then((res) => {
          setMotherId(res.data.hub_franchisee || null);
          setMotherLabel(res.data.hub_label || res.data.hub_franchisee || null);
          setFranchiseeType(res.data.franchisee_type || 'Pulse');
          setPricingRule(res.data.pricing_rule || null);
          setWalletBalance(
            res.data.wallet_balance != null ? Number(res.data.wallet_balance) : null,
          );
          setChannel(HUB_CHANNEL);
        })
        .catch((err) => setError(err instanceof Error ? err.message : 'Could not load defaults'));
    } else {
      void api
        .getMotherLabBillDefaults()
        .then((res) => {
          setMotherId(res.data.mother_lab_franchisee || null);
          setMotherLabel(res.data.mother_lab_label || res.data.mother_lab_franchisee || null);
          setFranchiseeType(res.data.franchisee_type || 'Pulse');
          setPricingRule(res.data.pricing_rule || null);
          setWalletBalance(res.data.wallet_balance != null ? Number(res.data.wallet_balance) : null);
          setAvailableToBill(res.data.available_to_bill != null ? Number(res.data.available_to_bill) : null);
          setCollectorUser(res.data.default_phlebotomist || null);
          setCollectorName(res.data.default_phlebotomist_name || 'Sample Collector');
          const list = res.data.collection_centres || [];
          setCentres(list);
          setDefaultCentreId(res.data.mother_lab_franchisee || null);
        })
        .catch((err) => setError(err instanceof Error ? err.message : 'Could not load defaults'));
    }
    void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHub]);

  const totals = useMemo(() => {
    const computedLines = lines.map((row) => ({ ...row, ...lineMath(row) }));
    const testAmount = computedLines.reduce((s, r) => s + r.hec_r_amount, 0);
    let addition = 0;
    let deduction = 0;
    for (const adj of adjustments) {
      let amt = Number(adj.amount) || 0;
      const pct = Number(adj.percentage) || 0;
      if (!amt && pct) amt = (testAmount * pct) / 100;
      const name = (adj.adjustment || '').toLowerCase();
      if (/(disc|deduct|less|concession)/.test(name)) deduction += Math.abs(amt);
      else if (amt < 0) deduction += Math.abs(amt);
      else addition += Math.abs(amt);
    }
    const coll = Number(collCharge) || 0;
    const net = testAmount + coll + addition - deduction;
    const recv =
      received.trim() !== ''
        ? Number(received) || 0
        : receiptAmount.trim() !== ''
          ? Number(receiptAmount) || 0
          : amountPaid.trim() !== ''
            ? Number(amountPaid) || 0
            : 0;
    const paid = amountPaid.trim() !== '' ? Number(amountPaid) || 0 : recv;
    const ref = Number(refund) || 0;
    const wo = Number(writtenOff) || 0;
    const due = Math.max(net - recv - wo + ref, 0);
    const balanceReturn = paid > net ? paid - net : 0;
    return {
      lines: computedLines,
      no_of_test: computedLines.length,
      hec_test_amount: testAmount,
      hec_coll_charge: coll,
      hec_addition: addition,
      hec_deduction: deduction,
      hec_net_amount: net,
      hec_received: recv,
      hec_refund: ref,
      hec_written_off: wo,
      hec_due_amount: due,
      hec_amount_paid: paid,
      hec_balance_return: balanceReturn,
    };
  }, [lines, adjustments, collCharge, received, receiptAmount, amountPaid, refund, writtenOff]);

  useEffect(() => {
    if (isHub || !lines.length) return;
    let cancelled = false;
    void api
      .repriceMotherLabBillLines(
        lines.map((row) => ({
          item: row.item,
          item_name: row.item_name,
          qty: row.qty,
          rate: row.rate,
          hec_disc_percent: row.hec_disc_percent,
          hec_disc_amount: row.hec_disc_amount,
          hec_remark: row.hec_remark,
        })),
        channel,
        motherId || undefined,
      )
      .then((res) => {
        if (cancelled) return;
        const repriced = res.data.tests || [];
        if (!repriced.length) return;
        setLines((prev) =>
          prev.map((row, idx) => {
            const hit = repriced[idx] as Record<string, unknown> | undefined;
            if (!hit || (hit.item as string) !== row.item) {
              const byItem = repriced.find((r) => (r.item as string) === row.item) as
                | Record<string, unknown>
                | undefined;
              if (!byItem) return row;
              return {
                ...row,
                rate: Number(byItem.rate || 0),
                mrp: Number(byItem.mrp || 0) || undefined,
                foco_rate: Number(byItem.foco_rate || 0) || undefined,
                show_mrp_slash: Boolean(byItem.show_mrp_slash),
                price_basis: String(byItem.price_basis || ''),
                sample_type: String(byItem.sample_type || row.sample_type || ''),
                sample_requirement_label: String(byItem.sample_requirement_label || row.sample_requirement_label || ''),
                collection_tubes: (Array.isArray(byItem.collection_tubes) ? byItem.collection_tubes : row.collection_tubes || []) as CollectionTubeRow[],
              };
            }
            return {
              ...row,
              rate: Number(hit.rate || 0),
              mrp: Number(hit.mrp || 0) || undefined,
              foco_rate: Number(hit.foco_rate || 0) || undefined,
              show_mrp_slash: Boolean(hit.show_mrp_slash),
              price_basis: String(hit.price_basis || ''),
              sample_type: String(hit.sample_type || row.sample_type || ''),
              sample_requirement_label: String(hit.sample_requirement_label || row.sample_requirement_label || ''),
              collection_tubes: (Array.isArray(hit.collection_tubes) ? hit.collection_tubes : row.collection_tubes || []) as CollectionTubeRow[],
            };
          }),
        );
      })
      .catch(() => {
        /* save still reprices server-side */
      });
    return () => {
      cancelled = true;
    };
  }, [channel, isHub, motherId]);

  useEffect(() => {
    if (!isHub || !lines.length) return;
    let cancelled = false;
    void api
      .repriceHubLabBillLines(
        lines.map((row) => ({
          item: row.item,
          item_name: row.item_name,
          qty: row.qty,
          rate: row.rate,
        })),
      )
      .then((res) => {
        if (cancelled) return;
        const repriced = res.data.tests || [];
        setLines((prev) =>
          prev.map((row) => {
            const hit = repriced.find((r) => (r.item as string) === row.item) as
              | Record<string, unknown>
              | undefined;
            if (!hit) return row;
            return {
              ...row,
              rate: Number(hit.rate || 0),
              mrp: Number(hit.mrp || 0) || undefined,
              show_mrp_slash: Boolean(hit.show_mrp_slash),
              sample_type: String(hit.sample_type || row.sample_type || ''),
              sample_requirement_label: String(hit.sample_requirement_label || row.sample_requirement_label || ''),
              collection_tubes: (Array.isArray(hit.collection_tubes) ? hit.collection_tubes : row.collection_tubes || []) as CollectionTubeRow[],
            };
          }),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHub, motherId]);

  async function searchTests(q: string) {
    setTestQ(q);
    if (q.trim().length < 2) {
      setTestHits([]);
      setTestSearchMsg(null);
      setTestSearching(false);
      return;
    }
    setTestSearching(true);
    setTestSearchMsg('Searching…');
    try {
      const res = isHub
        ? await api.searchHubLabTests(q.trim(), 30, {
            franchisee_id: motherId || undefined,
            intake_channel: HUB_CHANNEL,
          })
        : await api.searchMotherLabTests(q.trim(), 30, {
            franchisee_id: motherId || undefined,
            intake_channel: channel,
          });
      const payload = (res.data || {}) as {
        tests?: SuggestTest[];
        data?: { tests?: SuggestTest[] };
      };
      const tests = payload.tests || payload.data?.tests || [];
      setTestHits(tests.slice(0, 15));
      setTestSearchMsg(
        tests.length
          ? `${tests.length} match${tests.length === 1 ? '' : 'es'} — click to add`
          : `No tests found for “${q.trim()}”`,
      );
    } catch (err) {
      setTestHits([]);
      setTestSearchMsg(err instanceof Error ? err.message : 'Test search failed');
    } finally {
      setTestSearching(false);
    }
  }

  async function addPanel(hit: SuggestTest) {
    setTestSearching(true);
    setTestSearchMsg(`Expanding ${hit.item_name}…`);
    try {
      const res = await api.expandLabBillPanel(hit.panel_id || hit.item_code);
      const children = (res.data.tests || []).filter((t) => t.item);
      if (!children.length) {
        setTestSearchMsg(`Panel “${hit.item_name}” has no tests configured`);
        return;
      }
      const draft = children.map((t) => ({
        item: t.item,
        item_name: t.item_name || t.item,
        qty: Number(t.qty) || 1,
        rate: Number(t.rate) || 0,
      }));
      let priced: Array<Record<string, unknown>> = [];
      try {
        const rp = isHub
          ? await api.repriceHubLabBillLines(draft)
          : await api.repriceMotherLabBillLines(draft, channel, motherId || undefined);
        priced = rp.data.tests || [];
      } catch {
        /* save reprices server-side */
      }
      setLines((prev) => {
        const have = new Set(prev.map((r) => r.item));
        const added: BillLine[] = [];
        for (const d of draft) {
          if (have.has(d.item)) continue;
          have.add(d.item);
          const p = priced.find((r) => r.item === d.item) || {};
          added.push({
            key: uid('t'),
            item: d.item,
            item_name: String(p.item_name || d.item_name),
            qty: d.qty,
            rate: Number(p.rate ?? d.rate) || 0,
            mrp: Number(p.mrp || 0) || undefined,
            foco_rate: Number(p.foco_rate || 0) || undefined,
            show_mrp_slash: Boolean(p.show_mrp_slash),
            price_basis: p.price_basis ? String(p.price_basis) : undefined,
            sample_type: p.sample_type ? String(p.sample_type) : undefined,
            sample_requirement_label: p.sample_requirement_label
              ? String(p.sample_requirement_label)
              : undefined,
            collection_tubes: Array.isArray(p.collection_tubes)
              ? (p.collection_tubes as CollectionTubeRow[])
              : undefined,
            hec_disc_percent: 0,
            hec_disc_amount: 0,
            hec_remark: '',
            _disc_source: '',
          });
        }
        return [...prev, ...added];
      });
      setTestQ('');
      setTestHits([]);
      setTestSearchMsg(null);
    } catch (err) {
      setTestSearchMsg(err instanceof Error ? err.message : 'Could not expand panel');
    } finally {
      setTestSearching(false);
    }
  }

  function addTest(hit: SuggestTest) {
    if (hit.kind === 'panel') {
      void addPanel(hit);
      return;
    }
    setLines((prev) => [
      ...prev,
      {
        key: uid('t'),
        item: hit.item_code,
        item_name: hit.item_name,
        qty: 1,
        rate: Number(hit.rate || 0),
        mrp: Number(hit.mrp || 0) || undefined,
        foco_rate: Number(hit.foco_rate || 0) || undefined,
        show_mrp_slash: Boolean(hit.show_mrp_slash),
        price_basis: hit.price_basis,
        sample_type: hit.sample_type,
        sample_requirement_label: hit.sample_requirement_label,
        collection_tubes: hit.collection_tubes,
        hec_disc_percent: 0,
        hec_disc_amount: 0,
        hec_remark: '',
        _disc_source: '',
      },
    ]);
    setTestQ('');
    setTestHits([]);
  }

  function patchLine(key: string, patch: Partial<BillLine>) {
    setLines((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function resetForm() {
    setBillDatetime(nowLocalDatetimeValue());
    setLabNo('');
    setPatientName('');
    setGender('Male');
    setAge('');
    setPhone('');
    setWhatsapp('');
    setEmail('');
    setAddress('');
    setReferringDoctor({ id: null, name: 'Self' });
    setRefCommissionPercent('');
    setGuardian('');
    setOrganization('');
    setCollCharge('0');
    setRemarks('');
    setLines([]);
    setAdjustments([]);
    setStaffRows([]);
    setReceiptAmount('');
    setReceiptMode('CASH');
    setReceiptNo('');
    setChequeRef('');
    setChequeDate('');
    setBank('');
    setAmountPaid('');
    setReceived('');
    setRefund('0');
    setWrittenOff('0');
    setChannel(isHub ? HUB_CHANNEL : 'Direct to Mother Lab');
    if (!isHub && defaultCentreId) {
      const hit = centres.find((c) => c.name === defaultCentreId);
      setMotherId(defaultCentreId);
      setMotherLabel(hit?.franchise_name || hit?.label || defaultCentreId);
      setFranchiseeType(hit?.franchisee_type || 'Pulse');
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!patientName.trim()) {
      setError('Patient Name is required.');
      return;
    }
    if (!Number(age) || Number(age) <= 0) {
      setError('Age is required.');
      return;
    }
    if (!totals.lines.length) {
      setError('Add at least one test.');
      return;
    }
    setBusy('save');
    try {
      const paid = totals.hec_amount_paid || totals.hec_net_amount;
      const recv = totals.hec_received || paid;
      const billPayload = {
        hec_bill_datetime: billDatetime
          ? (() => {
              const n = billDatetime.replace('T', ' ');
              return n.length === 16 ? `${n}:00` : n;
            })()
          : undefined,
        hec_patient_id: labNo.trim(),
        patient_name: patientName.trim(),
        age: Number(age),
        gender,
        patient_phone: phone.trim(),
        hec_whatsapp: whatsapp.trim() || undefined,
        hec_email: email.trim(),
        collection_address: address.trim(),
        referred_doctor: referringDoctor.name.trim() || 'Self',
        referring_doctor_id:
          referringDoctor.id && referringDoctor.id !== 'Self' ? referringDoctor.id : undefined,
        ref_doctor_commission_percent:
          referringDoctor.id && referringDoctor.id !== 'Self' && refCommissionPercent.trim()
            ? Number(refCommissionPercent)
            : undefined,
        hec_guardian: guardian.trim(),
        hec_organization: organization.trim(),
        hec_coll_charge: Number(collCharge) || 0,
        hec_outside_sample: isHub ? 0 : 1,
        hec_lab_remarks: remarks.trim(),
        sample_intake_channel: isHub ? HUB_CHANNEL : channel,
        franchisee_id: motherId || undefined,
        coll_centre: motherId || undefined,
        phlebotomist: !isHub ? collectorUser || undefined : undefined,
        tests: totals.lines.map((row) => ({
          item: row.item,
          item_name: row.item_name,
          qty: row.qty,
          rate: row.rate,
          hec_disc_percent: row.hec_disc_percent,
          hec_disc_amount: row.hec_disc_amount,
          hec_remark: row.hec_remark,
          _disc_source: row._disc_source,
        })),
        adjustments: adjustments
          .filter((a) => a.adjustment || a.amount || a.percentage)
          .map(({ adjustment, percentage, amount, remark, conf_by }) => ({
            adjustment,
            percentage,
            amount,
            remark,
            conf_by,
          })),
        staff: staffRows
          .filter((s) => s.staff_name || s.amount)
          .map(({ staff_name, amount }) => ({ staff_name, amount })),
        hec_receipt_amount: Number(receiptAmount) || recv,
        hec_receipt_mode: receiptMode,
        hec_receipt_no: receiptNo.trim(),
        hec_cheque_ref: chequeRef.trim(),
        hec_cheque_date: chequeDate || undefined,
        hec_bank: bank.trim(),
        hec_amount_paid: paid,
        hec_received: recv,
        hec_refund: Number(refund) || 0,
        hec_written_off: Number(writtenOff) || 0,
      };
      const res = isHub
        ? await api.saveHubLabBill(billPayload)
        : await api.saveMotherLabBill(billPayload);
      if (isHub && 'wallet_balance' in res.data && res.data.wallet_balance != null) {
        setWalletBalance(Number(res.data.wallet_balance));
      }
      setResult({
        name: res.data.name,
        unique_barcode: res.data.unique_barcode,
      });
      resetForm();
      void loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(null);
    }
  }

  const [historyFrom, setHistoryFrom] = useState('');
  const [historyTo, setHistoryTo] = useState('');
  const [historyPage, setHistoryPage] = useState(1);
  const [historyMenu, setHistoryMenu] = useState<string | null>(null);
  const testInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!historyMenu) return;
    const onDoc = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.mlb2-menu')) setHistoryMenu(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [historyMenu]);

  const filteredHistory = useMemo(() => {
    const from = historyFrom ? new Date(`${historyFrom}T00:00:00`) : null;
    const to = historyTo ? new Date(`${historyTo}T23:59:59`) : null;
    if (!from && !to) return history;
    return history.filter((row) => {
      const raw = row.hec_bill_datetime || row.creation || '';
      const d = raw ? new Date(raw.replace(' ', 'T')) : null;
      if (!d || Number.isNaN(d.getTime())) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }, [history, historyFrom, historyTo]);

  useEffect(() => {
    setHistoryPage(1);
  }, [history, historyFrom, historyTo]);

  const historyPages = Math.max(1, Math.ceil(filteredHistory.length / HISTORY_PAGE_SIZE));
  const historySafePage = Math.min(historyPage, historyPages);
  const historyRows = filteredHistory.slice(
    (historySafePage - 1) * HISTORY_PAGE_SIZE,
    historySafePage * HISTORY_PAGE_SIZE,
  );
  const historyPageNumbers = (() => {
    let start = Math.max(1, historySafePage - 2);
    const end = Math.min(historyPages, start + 4);
    start = Math.max(1, end - 4);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  })();

  const motherLabSubtitle = isHub
    ? 'Create walk-in work order. Search booking, enter details, add tests and submit.'
    : 'Create work order for Mother Lab. Search booking, enter details, add tests and submit.';

  return (
    <div className="mlb2">
      <section className="mlb2-hero">
        <span className="mlb2-hero-icon">
          <MIcon size={30}>{ICON_DOC}</MIcon>
        </span>
        <div className="mlb2-hero-copy">
          <h2>{isHub ? 'Hub Work Order Slip' : 'Mother Lab Work Order Slip'}</h2>
          <p>{motherLabSubtitle}</p>
        </div>
        {!isHub ? (
          <div className="mlb2-hero-actions">
            <Link className="mlb2-hero-btn" to="/dashboard/accession">
              <MIcon size={16}>
                <rect x="4" y="4" width="16" height="16" rx="2" />
                <path d="M9 12h6M12 9v6" />
              </MIcon>
              Open accession
            </Link>
            <Link className="mlb2-hero-btn is-solid" to="/dashboard/lab-reports">
              <MIcon size={16}>{ICON_DOC}</MIcon>
              Result entry
            </Link>
          </div>
        ) : null}
      </section>

      {result ? (
        <div className="mlb2-card mlb2-result">
          <div>
            <h3>Work order slip saved</h3>
            <p>
              TRF <code>{result.name}</code> · Barcode <code className="barcode-value">{result.unique_barcode}</code>
            </p>
            <p className="mlb2-muted">
              {isHub
                ? 'Walk-in work order saved — platform fee debited from wallet.'
                : `Status Booked — ${collectorName} is assigned to collect. Receive tubes on accession.`}
            </p>
          </div>
          <div className="mlb2-result-actions">
            <button
              type="button"
              className="mlb2-btn"
              disabled={printBusy === result.name}
              onClick={() => void onPrintBill(result.name)}
            >
              {printBusy === result.name ? 'Preparing…' : 'Print bill'}
            </button>
            <button
              type="button"
              className="mlb2-btn is-outline"
              disabled={printBusy === `wo-${result.name}`}
              onClick={() => void onPrintWorkOrder(result.name)}
            >
              {printBusy === `wo-${result.name}` ? 'Preparing…' : 'Print work order'}
            </button>
            {!isHub ? (
              <Link className="mlb2-btn is-outline" to="/dashboard/accession">
                Go to accession
              </Link>
            ) : (
              <Link className="mlb2-btn is-outline" to="/b2b/wallet">
                Wallet
              </Link>
            )}
            <button type="button" className="mlb2-btn is-ghost" onClick={() => setResult(null)}>
              New work order
            </button>
          </div>
        </div>
      ) : null}

      <section className="mlb2-card">
        <div className="mlb2-card-head">
          <h3>
            <MIcon>
              <rect x="4" y="4" width="16" height="16" rx="2" />
              <path d="M8 9h8M8 13h8M8 17h5" />
            </MIcon>
            Bill History
          </h3>
          <form
            className="mlb2-history-tools"
            onSubmit={(e) => {
              e.preventDefault();
              void loadHistory(historyQ);
            }}
          >
            <label className="mlb2-search">
              <MIcon size={16}>{ICON_SEARCH}</MIcon>
              <input
                value={historyQ}
                onChange={(e) => setHistoryQ(e.target.value)}
                placeholder="Search bill no, barcode, patient name or phone…"
                aria-label="Search bill history"
              />
            </label>
            <div className="mlb2-dates" aria-label="Bill date range">
              <MIcon size={16}>{ICON_CAL}</MIcon>
              <input type="date" value={historyFrom} onChange={(e) => setHistoryFrom(e.target.value)} aria-label="From date" />
              <span>–</span>
              <input type="date" value={historyTo} onChange={(e) => setHistoryTo(e.target.value)} aria-label="To date" />
            </div>
            <button className="mlb2-btn is-outline" type="submit" disabled={historyBusy}>
              <MIcon size={16}>
                <path d="M20 12a8 8 0 1 1-2.3-5.6" />
                <path d="M20 4v5h-5" />
              </MIcon>
              {historyBusy ? 'Loading…' : 'Refresh'}
            </button>
          </form>
        </div>
        <div className="mlb2-table-wrap">
          <table className="mlb2-table">
            <thead>
              <tr>
                <th>Bill No</th>
                <th>Barcode</th>
                <th>Patient</th>
                <th>Channel</th>
                <th>Net Amount</th>
                <th>Status</th>
                <th>Date</th>
                <th className="mlb2-center">Action</th>
                <th aria-label="More" />
              </tr>
            </thead>
            <tbody>
              {historyRows.length ? (
                historyRows.map((row) => (
                  <tr key={row.name}>
                    <td className="mlb2-nowrap">{row.name}</td>
                    <td className="mlb2-nowrap">{row.unique_barcode || '—'}</td>
                    <td>
                      <div className="mlb2-patient">{row.patient_name || '—'}</div>
                      <small className="mlb2-muted">
                        {[row.gender, formatPatientAge(row)].filter(Boolean).join(' · ') || row.patient_phone || ''}
                      </small>
                    </td>
                    <td>{row.sample_intake_channel || '—'}</td>
                    <td className="mlb2-nowrap">{money(Number(row.hec_net_amount || 0))}</td>
                    <td>
                      <span className={`mlb2-badge tone-${historyTone(row.order_status)}`}>{row.order_status || '—'}</span>
                    </td>
                    <td className="mlb2-nowrap">{(row.hec_bill_datetime || row.creation || '').slice(0, 16)}</td>
                    <td className="mlb2-center">
                      <button
                        type="button"
                        className="mlb2-print"
                        disabled={printBusy === row.name}
                        onClick={() => void onPrintBill(row.name)}
                      >
                        {printBusy === row.name ? '…' : 'Print'}
                      </button>
                    </td>
                    <td>
                      <div className="mlb2-menu">
                        <button
                          type="button"
                          className="mlb2-kebab"
                          aria-label={`More actions for ${row.name}`}
                          onClick={() => setHistoryMenu((v) => (v === row.name ? null : row.name))}
                        >
                          <MIcon size={18}>
                            <circle cx="12" cy="5" r="1.2" />
                            <circle cx="12" cy="12" r="1.2" />
                            <circle cx="12" cy="19" r="1.2" />
                          </MIcon>
                        </button>
                        {historyMenu === row.name ? (
                          <div className="mlb2-menu-pop" role="menu">
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setHistoryMenu(null);
                                void onPrintBill(row.name);
                              }}
                            >
                              Print bill
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setHistoryMenu(null);
                                void onPrintWorkOrder(row.name);
                              }}
                            >
                              Print work order
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9} className="mlb2-empty-cell">
                    {historyBusy ? 'Loading bills…' : 'No mother-lab bills found.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {filteredHistory.length ? (
          <div className="mlb2-foot">
            <span>
              Showing {(historySafePage - 1) * HISTORY_PAGE_SIZE + 1} to{' '}
              {Math.min(historySafePage * HISTORY_PAGE_SIZE, filteredHistory.length)} of {filteredHistory.length} entries
            </span>
            <nav className="mlb2-pager" aria-label="Bill history pages">
              <button
                type="button"
                onClick={() => setHistoryPage(historySafePage - 1)}
                disabled={historySafePage === 1}
                aria-label="Previous page"
              >
                ‹
              </button>
              {historyPageNumbers.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={n === historySafePage ? 'is-active' : undefined}
                  aria-current={n === historySafePage ? 'page' : undefined}
                  onClick={() => setHistoryPage(n)}
                >
                  {n}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setHistoryPage(historySafePage + 1)}
                disabled={historySafePage === historyPages}
                aria-label="Next page"
              >
                ›
              </button>
            </nav>
          </div>
        ) : null}
      </section>

      <form className="mlb2-form" onSubmit={(e) => void onSubmit(e)}>
        <section className="mlb2-card">
          <div className="mlb2-card-head">
            <div>
              <h3>
                <MIcon>{ICON_DOC}</MIcon>
                Bill Entry
              </h3>
              {pricingRule ? (
                <p className="mlb2-note">
                  {pricingRule}
                  {motherLabel ? (
                    <>
                      {' '}
                      · Centre: <strong>{motherLabel}</strong> ({franchiseeType})
                    </>
                  ) : null}
                  {walletBalance != null ? (
                    <>
                      {' '}
                      · Wallet: <strong>{money(walletBalance)}</strong>
                    </>
                  ) : null}
                  {!isHub && availableToBill != null ? (
                    <>
                      {' '}
                      · Can still bill platform fees up to <strong>{money(availableToBill)}</strong>
                    </>
                  ) : null}
                </p>
              ) : null}
            </div>
            <button className="mlb2-btn" type="submit" disabled={busy === 'save'}>
              <MIcon size={16}>
                <path d="M5 4h11l3 3v13H5z" />
                <path d="M8 4v5h7V4M8 20v-6h8v6" />
              </MIcon>
              {busy === 'save' ? 'Saving…' : 'Save'}
            </button>
          </div>
          {error ? <p className="error">{error}</p> : null}

          <div className="mlb2-grid">
            <label className="mlb2-field">
              <span>
                Intake channel <em>*</em>
              </span>
              {!isHub ? (
                <select value={channel} onChange={(e) => setChannel(e.target.value as (typeof CHANNELS)[number])}>
                  {CHANNELS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              ) : (
                <input value={HUB_CHANNEL} readOnly />
              )}
            </label>
            <label className="mlb2-field">
              <span>
                Bill Date <em>*</em>
              </span>
              <input type="datetime-local" value={billDatetime} onChange={(e) => setBillDatetime(e.target.value)} />
            </label>
            <label className="mlb2-field">
              <span>Bill No</span>
              <input value="" placeholder="— auto assigned on save —" readOnly />
            </label>
            <label className="mlb2-field">
              <span>Lab No</span>
              <input value={labNo} onChange={(e) => setLabNo(e.target.value)} placeholder="Enter lab number" />
            </label>

            <label className="mlb2-field">
              <span>
                Patient Name <em>*</em>
              </span>
              <input
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                placeholder="Enter patient name"
                required
              />
            </label>
            <label className="mlb2-field">
              <span>
                Gender <em>*</em>
              </span>
              <select value={gender} onChange={(e) => setGender(e.target.value)}>
                <option>Male</option>
                <option>Female</option>
                <option>Other</option>
              </select>
            </label>
            <label className="mlb2-field">
              <span>
                Age <em>*</em>
              </span>
              <input type="number" min={1} value={age} onChange={(e) => setAge(e.target.value)} placeholder="Enter age" required />
            </label>
            <label className="mlb2-field">
              <span>Phone</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Enter phone number" />
            </label>

            <label className="mlb2-field">
              <span>WhatsApp</span>
              <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="Enter WhatsApp number" />
            </label>
            <label className="mlb2-field">
              <span>Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter email id" />
            </label>
            <label className="mlb2-field">
              <span>Address</span>
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Enter address" />
            </label>
            {!isHub ? (
              <label className="mlb2-field">
                <span>Collected by</span>
                <input value={collectorName} readOnly title={collectorUser || 'Default mother-lab phlebotomist'} />
              </label>
            ) : (
              <span className="mlb2-grid-gap" />
            )}

            <div className="mlb2-field">
              <span>Referred By</span>
              <ReferringDoctorPicker
                variant="desk"
                searchModule={isHub ? 'hub' : 'mother'}
                value={referringDoctor}
                onChange={setReferringDoctor}
                commissionPercent={refCommissionPercent}
                onCommissionChange={setRefCommissionPercent}
              />
            </div>
            <label className="mlb2-field">
              <span>Guardian</span>
              <input value={guardian} onChange={(e) => setGuardian(e.target.value)} placeholder="Enter guardian name" />
            </label>
            <label className="mlb2-field mlb2-span-2">
              <span>Collect From</span>
              {isHub ? (
                <input
                  value={motherLabel || motherId || 'Your hub (logged-in franchisee)'}
                  readOnly
                  title="Pinned to your Franchisee Profile"
                />
              ) : (
                <select
                  value={motherId || ''}
                  onChange={(e) => {
                    const id = e.target.value;
                    const hit = centres.find((c) => c.name === id);
                    setMotherId(id || null);
                    setMotherLabel(hit?.franchise_name || hit?.label || id || null);
                    setFranchiseeType(hit?.franchisee_type || 'Pulse');
                  }}
                  title="Collection centre for this work order"
                >
                  {!motherId ? <option value="">Select collection centre</option> : null}
                  {centres.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.label}
                      {c.is_mother_lab ? ' (mother lab)' : ''}
                    </option>
                  ))}
                </select>
              )}
            </label>

            <label className="mlb2-field">
              <span>Organization</span>
              <input value={organization} onChange={(e) => setOrganization(e.target.value)} placeholder="Enter organization" />
            </label>
            <label className="mlb2-field">
              <span>Coll. Charge</span>
              <input type="number" min={0} step="0.01" value={collCharge} onChange={(e) => setCollCharge(e.target.value)} />
            </label>
            {!isHub ? (
              <label className="mlb2-check">
                <input type="checkbox" checked readOnly />
                <span>Outside Sample</span>
              </label>
            ) : (
              <span className="mlb2-grid-gap" />
            )}
            <span className="mlb2-grid-gap" />

            <label className="mlb2-field mlb2-span-2 mlb2-field-top">
              <span>Remark</span>
              <textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Enter remark (optional)" />
            </label>
          </div>
        </section>

        <section className="mlb2-card">
          <div className="mlb2-card-head">
            <h3>
              <MIcon>
                <path d="M9 3h6M10 3v6L5 18.5A2 2 0 0 0 6.8 21h10.4a2 2 0 0 0 1.8-2.5L14 9V3" />
              </MIcon>
              Test Details
              <small>Type at least 2 letters (e.g. glucose)</small>
            </h3>
            <button type="button" className="mlb2-btn" onClick={() => testInputRef.current?.focus()}>
              + Add Test
            </button>
          </div>
          <div className="mlb2-test-search">
            <label className="mlb2-search">
              <MIcon size={16}>{ICON_SEARCH}</MIcon>
              <input
                ref={testInputRef}
                value={testQ}
                onChange={(e) => void searchTests(e.target.value)}
                placeholder="Search and add test…"
                autoComplete="off"
                aria-label="Search tests"
              />
            </label>
            {testSearchMsg ? (
              <p className={testHits.length ? 'mlb2-muted mlb2-hint' : 'error mlb2-hint'}>
                {testSearching ? 'Searching…' : testSearchMsg}
              </p>
            ) : null}
            {testHits.length > 0 ? (
              <ul className="mlb-suggest mlb-suggest-panel mlb2-suggest">
                {testHits.map((t) => (
                  <li key={`${t.kind || 't'}-${t.item_code}`}>
                    <button type="button" onClick={() => addTest(t)}>
                      <strong>{t.item_name}</strong>
                      <span>
                        {t.item_code} ·{' '}
                        {t.show_mrp_slash && (t.mrp || 0) > (t.rate || 0) ? (
                          <span className="nabl-rate">
                            <span className="price-slash-wrap">
                              <span className="price-mrp">{money(Number(t.mrp || 0))}</span>
                              <span className="price-slash" aria-hidden />
                            </span>
                            <span className="nabl-rate-bill">{money(Number(t.rate || 0))}</span>
                          </span>
                        ) : (
                          money(Number(t.rate || 0))
                        )}
                        {t.kind === 'panel' ? ' · Panel' : ''}
                      </span>
                      <NablSampleCell row={t} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="mlb2-table-wrap">
            <table className="mlb2-table mlb2-tests">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Test Name</th>
                  <th>Sample / Tube / Vol</th>
                  <th>Rate</th>
                  <th>Qty</th>
                  <th>Amount</th>
                  <th>Discount (%)</th>
                  <th>Discount Amt</th>
                  <th>Payable</th>
                  <th>Remark</th>
                  <th className="mlb2-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {totals.lines.length ? (
                  totals.lines.map((row) => (
                    <tr key={row.key}>
                      <td className="mlb2-nowrap">
                        <code>{row.item}</code>
                      </td>
                      <td>{row.item_name}</td>
                      <td>
                        <NablSampleCell row={row} />
                      </td>
                      <td>
                        <BillRateCell row={row} />
                      </td>
                      <td>
                        <input
                          className="mlb2-cell-input"
                          type="number"
                          min={1}
                          value={row.qty}
                          onChange={(e) => patchLine(row.key, { qty: Number(e.target.value) || 1 })}
                        />
                      </td>
                      <td className="mlb2-nowrap">{money(row.amount)}</td>
                      <td>
                        <input
                          className="mlb2-cell-input"
                          type="number"
                          min={0}
                          step="0.01"
                          value={row.hec_disc_percent}
                          onChange={(e) =>
                            patchLine(row.key, {
                              hec_disc_percent: Number(e.target.value) || 0,
                              _disc_source: 'pct',
                            })
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="mlb2-cell-input"
                          type="number"
                          min={0}
                          step="0.01"
                          value={row.hec_disc_amount}
                          onChange={(e) =>
                            patchLine(row.key, {
                              hec_disc_amount: Number(e.target.value) || 0,
                              _disc_source: 'amt',
                            })
                          }
                        />
                      </td>
                      <td className="mlb2-nowrap mlb2-strong">{money(row.hec_r_amount)}</td>
                      <td>
                        <input
                          className="mlb2-cell-input is-wide"
                          value={row.hec_remark}
                          onChange={(e) => patchLine(row.key, { hec_remark: e.target.value })}
                        />
                      </td>
                      <td className="mlb2-center">
                        <button
                          type="button"
                          className="mlb2-remove"
                          aria-label={`Remove ${row.item_name}`}
                          onClick={() => setLines((prev) => prev.filter((r) => r.key !== row.key))}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={11}>
                      <div className="mlb2-empty">
                        <MIcon size={28}>{ICON_EMPTY}</MIcon>
                        <strong>No tests added yet</strong>
                        <span>Search and add tests from the above search box</span>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <NablDrawPlan lines={totals.lines} />
        </section>

        <div className="mlb2-bottom">
          <section className="mlb2-card mlb2-mini">
            <div className="mlb2-card-head">
              <h3>
                <MIcon>
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
                </MIcon>
                Adjustments
              </h3>
              <button
                type="button"
                className="mlb2-btn is-outline is-sm"
                onClick={() =>
                  setAdjustments((prev) => [
                    ...prev,
                    { key: uid('a'), adjustment: '', percentage: 0, amount: 0, remark: '', conf_by: '' },
                  ])
                }
              >
                + Add
              </button>
            </div>
            <div className="mlb2-table-wrap">
              <table className="mlb2-table mlb2-compact">
                <thead>
                  <tr>
                    <th>Adjustment</th>
                    <th>%</th>
                    <th>Amount</th>
                    <th>Remark</th>
                    <th>Conf By</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {adjustments.length ? (
                    adjustments.map((row) => (
                      <tr key={row.key}>
                        <td>
                          <input
                            className="mlb2-cell-input is-wide"
                            value={row.adjustment}
                            onChange={(e) =>
                              setAdjustments((prev) =>
                                prev.map((r) => (r.key === row.key ? { ...r, adjustment: e.target.value } : r)),
                              )
                            }
                          />
                        </td>
                        <td>
                          <input
                            className="mlb2-cell-input"
                            type="number"
                            value={row.percentage}
                            onChange={(e) =>
                              setAdjustments((prev) =>
                                prev.map((r) =>
                                  r.key === row.key ? { ...r, percentage: Number(e.target.value) || 0 } : r,
                                ),
                              )
                            }
                          />
                        </td>
                        <td>
                          <input
                            className="mlb2-cell-input"
                            type="number"
                            value={row.amount}
                            onChange={(e) =>
                              setAdjustments((prev) =>
                                prev.map((r) =>
                                  r.key === row.key ? { ...r, amount: Number(e.target.value) || 0 } : r,
                                ),
                              )
                            }
                          />
                        </td>
                        <td>
                          <input
                            className="mlb2-cell-input is-wide"
                            value={row.remark}
                            onChange={(e) =>
                              setAdjustments((prev) =>
                                prev.map((r) => (r.key === row.key ? { ...r, remark: e.target.value } : r)),
                              )
                            }
                          />
                        </td>
                        <td>
                          <input
                            className="mlb2-cell-input is-wide"
                            value={row.conf_by}
                            onChange={(e) =>
                              setAdjustments((prev) =>
                                prev.map((r) => (r.key === row.key ? { ...r, conf_by: e.target.value } : r)),
                              )
                            }
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="mlb2-remove"
                            aria-label="Remove adjustment"
                            onClick={() => setAdjustments((prev) => prev.filter((r) => r.key !== row.key))}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6}>
                        <div className="mlb2-empty is-small">
                          <MIcon size={24}>{ICON_CAL}</MIcon>
                          <span>No adjustments added</span>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mlb2-card mlb2-mini">
            <div className="mlb2-card-head">
              <h3>
                <MIcon>
                  <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
                  <path d="M9 8h6M9 12h6" />
                </MIcon>
                Receipt Details
              </h3>
            </div>
            <div className="mlb2-stack">
              <label className="mlb2-field">
                <span>Receipt Amount</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={receiptAmount}
                  placeholder={String(totals.hec_net_amount.toFixed(2))}
                  onChange={(e) => setReceiptAmount(e.target.value)}
                />
              </label>
              <label className="mlb2-field">
                <span>Receipt Mode</span>
                <select value={receiptMode} onChange={(e) => setReceiptMode(e.target.value)}>
                  <option value="CASH">CASH</option>
                  <option value="CARD">CARD</option>
                  <option value="UPI">UPI</option>
                  <option value="CHEQUE">CHEQUE</option>
                  <option value="NEFT">NEFT</option>
                  <option value="OTHER">OTHER</option>
                </select>
              </label>
              <label className="mlb2-field">
                <span>Receipt No</span>
                <input value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)} placeholder="Auto if blank" />
              </label>
              <label className="mlb2-field">
                <span>Cheque/Ref No</span>
                <input value={chequeRef} onChange={(e) => setChequeRef(e.target.value)} placeholder="Enter cheque/ref no." />
              </label>
              <label className="mlb2-field">
                <span>Cheque/Ref Date</span>
                <input type="date" value={chequeDate} onChange={(e) => setChequeDate(e.target.value)} />
              </label>
              <label className="mlb2-field">
                <span>Bank</span>
                <input value={bank} onChange={(e) => setBank(e.target.value)} placeholder="Enter bank name" />
              </label>
            </div>
          </section>

          <section className="mlb2-card mlb2-mini">
            <div className="mlb2-card-head">
              <h3>
                <MIcon>
                  <circle cx="9" cy="8" r="3" />
                  <circle cx="17" cy="9" r="2.5" />
                  <path d="M3 20c.5-3.5 3-5.5 6-5.5s5.5 2 6 5.5M15 15c2.8 0 4.8 1.6 5.5 4.5" />
                </MIcon>
                Staff
              </h3>
              <button
                type="button"
                className="mlb2-btn is-outline is-sm"
                onClick={() => setStaffRows((prev) => [...prev, { key: uid('s'), staff_name: '', amount: 0 }])}
              >
                + Add
              </button>
            </div>
            <div className="mlb2-table-wrap">
              <table className="mlb2-table mlb2-compact">
                <thead>
                  <tr>
                    <th>Staff Name</th>
                    <th>Amt</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {staffRows.length ? (
                    staffRows.map((row) => (
                      <tr key={row.key}>
                        <td>
                          <input
                            className="mlb2-cell-input is-wide"
                            value={row.staff_name}
                            onChange={(e) =>
                              setStaffRows((prev) =>
                                prev.map((r) => (r.key === row.key ? { ...r, staff_name: e.target.value } : r)),
                              )
                            }
                          />
                        </td>
                        <td>
                          <input
                            className="mlb2-cell-input"
                            type="number"
                            value={row.amount}
                            onChange={(e) =>
                              setStaffRows((prev) =>
                                prev.map((r) =>
                                  r.key === row.key ? { ...r, amount: Number(e.target.value) || 0 } : r,
                                ),
                              )
                            }
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="mlb2-remove"
                            aria-label="Remove staff row"
                            onClick={() => setStaffRows((prev) => prev.filter((r) => r.key !== row.key))}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3}>
                        <div className="mlb2-empty is-small">
                          <MIcon size={24}>{ICON_CAL}</MIcon>
                          <span>No staff added</span>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mlb2-card mlb2-mini mlb2-totals">
            <div className="mlb2-card-head">
              <h3>
                <MIcon>
                  <rect x="5" y="3" width="14" height="18" rx="2" />
                  <path d="M8 7h8M8 11h2M12 11h2M8 15h2M12 15h2M16 11v4" />
                </MIcon>
                Bill Totals
              </h3>
            </div>
            <div className="mlb2-totals-body">
              <label className="mlb2-field mlb2-paid">
                <span>Amount Paid</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={amountPaid}
                  placeholder={String(totals.hec_net_amount.toFixed(2))}
                  onChange={(e) => setAmountPaid(e.target.value)}
                />
              </label>
              <dl className="mlb2-totals-list">
                <div>
                  <dt>No of Test</dt>
                  <dd>{totals.no_of_test}</dd>
                </div>
                <div>
                  <dt>Test Amount</dt>
                  <dd>{money(totals.hec_test_amount)}</dd>
                </div>
                <div>
                  <dt>Coll. Charge</dt>
                  <dd>{money(totals.hec_coll_charge)}</dd>
                </div>
                <div>
                  <dt>Addition</dt>
                  <dd>{money(totals.hec_addition)}</dd>
                </div>
                <div>
                  <dt>Deduction</dt>
                  <dd>{money(totals.hec_deduction)}</dd>
                </div>
                <div className="is-emph">
                  <dt>Net Amount</dt>
                  <dd>{money(totals.hec_net_amount)}</dd>
                </div>
                <div>
                  <dt>Received</dt>
                  <dd>
                    <input
                      type="number"
                      value={received}
                      placeholder={String((totals.hec_amount_paid || totals.hec_net_amount).toFixed(2))}
                      onChange={(e) => setReceived(e.target.value)}
                    />
                  </dd>
                </div>
                <div>
                  <dt>Refund</dt>
                  <dd>
                    <input type="number" value={refund} onChange={(e) => setRefund(e.target.value)} />
                  </dd>
                </div>
                <div>
                  <dt>Written Off</dt>
                  <dd>
                    <input type="number" value={writtenOff} onChange={(e) => setWrittenOff(e.target.value)} />
                  </dd>
                </div>
                <div className="is-emph">
                  <dt>Due Amount</dt>
                  <dd>{money(totals.hec_due_amount)}</dd>
                </div>
                <div className="is-strong">
                  <dt>Balance to Return</dt>
                  <dd>{money(totals.hec_balance_return)}</dd>
                </div>
              </dl>
            </div>
            <button className="mlb2-btn mlb2-save-wide" type="submit" disabled={busy === 'save'}>
              {busy === 'save' ? 'Saving…' : 'Save work order (Booked)'}
            </button>
          </section>
        </div>
      </form>
    </div>
  );
}
