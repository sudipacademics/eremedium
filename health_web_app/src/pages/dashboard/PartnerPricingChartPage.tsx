import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  type PartnerPricingChart,
  type PartnerPricingImportReport,
  type PartnerPricingKey,
  type PartnerPricingRow,
} from '../../api';
import { matchesLabTestQuery } from '../../utils/labTestSearch';
import './partner-pricing.css';

const COLUMNS: Array<{ key: PartnerPricingKey; label: string; group: string }> = [
  { key: 'foco_billing', label: 'Billing', group: 'FOCO' },
  { key: 'foco_fee', label: 'Platform Fee', group: 'FOCO' },
  { key: 'mf_billing', label: 'Billing', group: 'Master FOCO' },
  { key: 'mf_fee', label: 'Platform Fee', group: 'Master FOCO' },
  { key: 'orange_billing', label: 'Billing', group: 'Orange FOCO' },
  { key: 'orange_fee', label: 'Platform Fee', group: 'Orange FOCO' },
  { key: 'mrp', label: 'MRP', group: '' },
];
const PAGE_SIZE = 50;

type Draft = Partial<Record<PartnerPricingKey, string>>;

function fmt(v: number | null | undefined) {
  return v == null ? '' : String(v);
}

function downloadBase64(filename: string, mimetype: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mimetype }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',').pop() || '');
    reader.onerror = () => reject(reader.error || new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

export function PartnerPricingChartPage() {
  const [chart, setChart] = useState<PartnerPricingChart | null>(null);
  const [configuredOnly, setConfiguredOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [report, setReport] = useState<PartnerPricingImportReport | null>(null);
  const [pendingImport, setPendingImport] = useState<{ name: string; content: string } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    const res = await api.getPartnerPricingChart(configuredOnly);
    setChart(res.data);
  }, [configuredOnly]);

  useEffect(() => {
    setError(null);
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load the pricing chart'));
  }, [load]);

  const categories = useMemo(
    () => Array.from(new Set((chart?.rows || []).map((r) => r.category).filter(Boolean))).sort(),
    [chart],
  );

  const filtered = useMemo(() => {
    const q = query.trim();
    return (chart?.rows || []).filter((r) => {
      if (category && r.category !== category) return false;
      if (!q) return true;
      return matchesLabTestQuery(q, [r.item_name, r.item_code, r.category]);
    });
  }, [chart, query, category]);

  useEffect(() => setPage(1), [query, category, configuredOnly]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const slice = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const dirtyCodes = Object.keys(drafts);

  function cellValue(row: PartnerPricingRow, key: PartnerPricingKey) {
    const d = drafts[row.item_code];
    if (d && key in d) return d[key] ?? '';
    return fmt(row[key]);
  }

  function setCell(row: PartnerPricingRow, key: PartnerPricingKey, value: string) {
    setDrafts((cur) => {
      const next = { ...cur, [row.item_code]: { ...(cur[row.item_code] || {}), [key]: value } };
      const changed = COLUMNS.some((c) => {
        const v = next[row.item_code][c.key];
        return v !== undefined && v.trim() !== fmt(row[c.key]);
      });
      if (!changed) delete next[row.item_code];
      return next;
    });
  }

  async function saveChanges() {
    if (!chart || !dirtyCodes.length) return;
    setBusy('save');
    setError(null);
    setNotice(null);
    setReport(null);
    try {
      const rows = dirtyCodes.map((code) => {
        const base = chart.rows.find((r) => r.item_code === code)!;
        const out: Record<string, string | number | null> = { item_code: code };
        for (const c of COLUMNS) out[c.key] = cellValue(base, c.key).trim() || null;
        return out as { item_code: string };
      });
      const res = await api.savePartnerPricingRows(rows);
      setReport(res.data);
      if (res.data.ok) {
        setDrafts({});
        setNotice(`Saved ${res.data.updated} test(s).`);
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(null);
    }
  }

  async function exportAs(fmtKind: 'xlsx' | 'pdf') {
    setBusy(fmtKind);
    setError(null);
    try {
      const res = await api.exportPartnerPricing(fmtKind, configuredOnly);
      downloadBase64(res.data.filename, res.data.mimetype, res.data.content_base64);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(null);
    }
  }

  async function onPickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy('import');
    setError(null);
    setNotice(null);
    setReport(null);
    try {
      const content = await fileToBase64(file);
      const res = await api.importPartnerPricing(file.name, content, true);
      setReport(res.data);
      setPendingImport(res.data.ok ? { name: file.name, content } : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import check failed');
    } finally {
      setBusy(null);
    }
  }

  async function applyImport() {
    if (!pendingImport) return;
    setBusy('apply');
    setError(null);
    try {
      const res = await api.importPartnerPricing(pendingImport.name, pendingImport.content, false);
      setReport(res.data);
      setPendingImport(null);
      if (res.data.ok) {
        setDrafts({});
        setNotice(`Imported ${pendingImport.name}: ${res.data.updated} updated, ${res.data.unchanged} unchanged.`);
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="ppc-page">
      <header className="ppc-head">
        <div>
          <h1>Partner Pricing Chart</h1>
          <p>
            Master price list for the partner circuit. Each test needs all six tier values to be on the circuit; FOCO,
            Master FOCO, Orange FOCO and mapped Vector catalogues are built from this chart only.
            {chart
              ? ` ${chart.on_circuit} of ${chart.total} tests are on the circuit${chart.incomplete ? `, ${chart.incomplete} incomplete` : ''}.`
              : ''}
          </p>
        </div>
        <div className="ppc-actions">
          <button type="button" className="btn secondary" disabled={busy === 'xlsx'} onClick={() => void exportAs('xlsx')}>
            {busy === 'xlsx' ? 'Exporting…' : 'Export Excel'}
          </button>
          <button type="button" className="btn secondary" disabled={busy === 'pdf'} onClick={() => void exportAs('pdf')}>
            {busy === 'pdf' ? 'Exporting…' : 'Export PDF'}
          </button>
          <button type="button" className="btn secondary" disabled={busy === 'import'} onClick={() => fileRef.current?.click()}>
            {busy === 'import' ? 'Checking…' : 'Import Excel'}
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.csv" hidden onChange={(e) => void onPickFile(e)} />
          <button type="button" className="btn" disabled={!dirtyCodes.length || busy === 'save'} onClick={() => void saveChanges()}>
            {busy === 'save' ? 'Saving…' : `Save changes${dirtyCodes.length ? ` (${dirtyCodes.length})` : ''}`}
          </button>
        </div>
      </header>

      {error ? <div className="error">{error}</div> : null}
      {notice ? <div className="ppc-notice">{notice}</div> : null}

      {report ? (
        <div className={`ppc-report${report.ok ? '' : ' bad'}`}>
          <b>
            {report.dry_run ? 'Import check' : 'Result'}: {report.rows} row(s) ·{' '}
            {report.dry_run ? `${report.updated} ready` : `${report.updated} updated · ${report.unchanged} unchanged`} ·{' '}
            {report.errors.length} error(s)
          </b>
          {report.errors.length ? (
            <ul>
              {report.errors.slice(0, 30).map((e) => (
                <li key={`${e.row}-${e.item_code}`}>
                  Row {e.row}
                  {e.item_code ? ` (${e.item_code})` : ''}: {e.error}
                </li>
              ))}
            </ul>
          ) : null}
          {pendingImport && report.dry_run && report.ok ? (
            <div className="ppc-report-actions">
              <button type="button" className="btn" disabled={busy === 'apply'} onClick={() => void applyImport()}>
                {busy === 'apply' ? 'Importing…' : `Apply ${pendingImport.name}`}
              </button>
              <button type="button" className="btn secondary" onClick={() => setPendingImport(null)}>
                Cancel
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="ppc-filters">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search test name or code…"
          aria-label="Search tests"
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <label className="ppc-check">
          <input type="checkbox" checked={configuredOnly} onChange={(e) => setConfiguredOnly(e.target.checked)} />
          On circuit only
        </label>
      </div>

      <div className="ppc-table-wrap">
        <table className="ppc-table">
          <thead>
            <tr>
              <th rowSpan={2}>Test</th>
              <th colSpan={2}>FOCO</th>
              <th colSpan={2}>Master FOCO</th>
              <th colSpan={2}>Orange FOCO</th>
              <th rowSpan={2}>MRP</th>
              <th rowSpan={2}>Circuit</th>
            </tr>
            <tr>
              {COLUMNS.filter((c) => c.group).map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.map((row) => (
              <tr key={row.item_code} className={drafts[row.item_code] ? 'dirty' : undefined}>
                <td className="ppc-test">
                  <b>{row.item_name}</b>
                  <small>
                    {row.item_code}
                    {row.category ? ` · ${row.category}` : ''}
                  </small>
                </td>
                {COLUMNS.map((c) => (
                  <td key={c.key}>
                    <input
                      inputMode="decimal"
                      value={cellValue(row, c.key)}
                      onChange={(e) => setCell(row, c.key, e.target.value)}
                      aria-label={`${row.item_name} ${c.group} ${c.label}`}
                    />
                  </td>
                ))}
                <td>
                  <span
                    className={`ppc-pill ${row.on_circuit ? 'on' : row.status === 'Incomplete' ? 'partial' : ''}`}
                    title={row.status === 'Incomplete' ? 'Some tier values are set; fill all six to put this test on the circuit' : undefined}
                  >
                    {row.status || (row.on_circuit ? 'On' : 'Off')}
                  </span>
                </td>
              </tr>
            ))}
            {!slice.length ? (
              <tr>
                <td colSpan={9} className="ppc-empty">
                  {chart ? 'No tests match.' : 'Loading…'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="ppc-pager">
        <span>
          {filtered.length ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, filtered.length)} of ${filtered.length}` : '0'}
        </span>
        <button type="button" className="btn secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Previous
        </button>
        <span>
          Page {page} / {pages}
        </span>
        <button type="button" className="btn secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
          Next
        </button>
      </div>

      <section className="ppc-legend">
        <h2>What each partner sees</h2>
        <ul>
          <li>
            <b>FOCO</b> (and any partner with the FOCO module): patient price = FOCO billing rate; deposit debit = FOCO platform
            fee (less the lab share with its own lab).
          </li>
          <li>
            <b>Master FOCO</b> share = Master billing − Master platform fee; <b>lab</b> share = Orange billing − Orange platform
            fee.
          </li>
          <li>
            <b>Vector</b> mapped to FOCO / Master / lab: dummy MRP patient bill; B2B bill = that tier&apos;s billing rate.
          </li>
          <li>
            A test is on the circuit only when all six tier values are set; partial rows (e.g. an Orange billing rate
            alone) are saved as <b>Incomplete</b> and never billed. Clear all six to take a test off. Blank MRP keeps the
            current MRP; saving an MRP on a <i>Pricing Pending</i> test publishes it to Lab Tests.
          </li>
        </ul>
      </section>
    </div>
  );
}
