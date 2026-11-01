import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, type B2bCatalogItem } from '../../api';
import { matchesLabTestQuery } from '../../utils/labTestSearch';
import { peekWalkInItemQueue, queueWalkInItemCodes } from '../../utils/walkInDraft';
import './partner-catalog-v2.css';

type CatalogRow = B2bCatalogItem & {
  lab_category?: string;
  sample_type?: string;
};

type SortKey = 'name' | 'department' | 'sample' | 'mrp' | 'partner' | 'fee' | 'earn';

const UNCATEGORISED = 'Uncategorised';
const DOTS = ['#0f766e', '#7c3aed', '#dc2626', '#2563eb', '#ca8a04', '#db2777', '#059669', '#0891b2'];

function money(n: number) {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      {children}
    </svg>
  );
}

function dotColor(label: string) {
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) hash = (hash + label.charCodeAt(i)) % DOTS.length;
  return DOTS[hash];
}

function categoryOf(row: CatalogRow) {
  return (row.lab_category || row.item_group || '').trim() || UNCATEGORISED;
}

function sampleOf(row: CatalogRow) {
  return (row.sample_type || '').trim();
}

function rates(row: CatalogRow) {
  const mrp = Number(row.mrp || row.retail_rate || 0);
  const partner = Number(row.retail_rate || 0);
  const fee = Number(row.platform_fee ?? row.wholesale_rate ?? 0);
  const earn = Number(row.commission_value ?? row.margin ?? 0);
  const off = Boolean(row.show_mrp_slash) && mrp > partner && mrp > 0;
  return { mrp, partner, fee, earn, off, offPct: off ? Math.round((1 - partner / mrp) * 100) : 0 };
}

function Chip({ label }: { label: string }) {
  if (!label) return <span>—</span>;
  return (
    <span className="pc2-chip">
      <span className="pc2-dot" style={{ background: dotColor(label) }} />
      {label}
    </span>
  );
}

export function B2bCatalogPage() {
  const [items, setItems] = useState<CatalogRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [sample, setSample] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [queued, setQueued] = useState<string[]>(() => peekWalkInItemQueue());

  useEffect(() => {
    let cancelled = false;
    void Promise.all([api.getB2bCatalog(), api.getLabCatalog().catch(() => null)])
      .then(([portal, publicCat]) => {
        if (cancelled) return;
        const extras = new Map(
          (publicCat?.data.items || []).map((row) => [
            row.name,
            { lab_category: row.lab_category || '', sample_type: row.sample_type || '' },
          ]),
        );
        setItems(
          (portal.data.items || []).map((row) => ({
            ...row,
            ...(extras.get(row.item_code) || {}),
          })),
        );
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load catalog');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const franchiseeType = items[0]?.franchisee_type || 'Pulse';
  const isVector = franchiseeType === 'Vector';
  const feeLabel = isVector ? 'Platform fee' : 'FOCO Commission';

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of items) {
      const key = categoryOf(row);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);

  const samples = useMemo(() => {
    return Array.from(new Set(items.map(sampleOf).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim();
    const rows = items.filter((row) => {
      if (category && categoryOf(row) !== category) return false;
      if (sample && sampleOf(row) !== sample) return false;
      if (!q) return true;
      return matchesLabTestQuery(q, [row.item_name, row.item_code, categoryOf(row), sampleOf(row)]);
    });
    const dir = sortAsc ? 1 : -1;
    return rows.sort((a, b) => {
      const ra = rates(a);
      const rb = rates(b);
      const cmp =
        sortKey === 'name'
          ? a.item_name.localeCompare(b.item_name)
          : sortKey === 'department'
            ? categoryOf(a).localeCompare(categoryOf(b))
            : sortKey === 'sample'
              ? sampleOf(a).localeCompare(sampleOf(b))
              : sortKey === 'mrp'
                ? ra.mrp - rb.mrp
                : sortKey === 'partner'
                  ? ra.partner - rb.partner
                  : sortKey === 'fee'
                    ? ra.fee - rb.fee
                    : ra.earn - rb.earn;
      return cmp * dir;
    });
  }, [items, query, category, sample, sortKey, sortAsc]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  function resetFilters() {
    setQuery('');
    setCategory('');
    setSample('');
  }

  function addToOrder(code: string) {
    queueWalkInItemCodes([code]);
    setQueued(peekWalkInItemQueue());
  }

  function downloadPriceList() {
    const rows = filtered
      .map((row, i) => {
        const r = rates(row);
        return `<tr><td>${i + 1}</td><td>${escapeHtml(row.item_name)}</td><td>${escapeHtml(row.item_code)}</td><td>${escapeHtml(categoryOf(row))}</td><td>${escapeHtml(sampleOf(row) || '—')}</td><td>${money(r.mrp)}</td><td>${money(r.partner)}</td><td>${money(r.fee)}</td><td>${money(r.earn)}</td></tr>`;
      })
      .join('');
    const html = `<!doctype html><html><head><title>Remedium price list</title><style>body{font:14px/1.4 sans-serif;padding:24px;color:#0f172a}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #e2e8f0;padding:8px;text-align:left}h1{font-size:20px}</style></head><body><h1>Remedium test catalog</h1><p>${filtered.length} tests · ${isVector ? 'Vector wholesale' : 'FOCO minus commission'}</p><table><thead><tr><th>#</th><th>Test</th><th>Code</th><th>Department</th><th>Sample</th><th>MRP</th><th>Partner rate</th><th>${escapeHtml(feeLabel)}</th><th>Your earnings</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
    const popup = window.open('', '_blank');
    if (!popup) return;
    popup.document.write(html);
    popup.document.close();
    popup.focus();
    popup.print();
  }

  return (
    <div className="pc2">
      <div className="pc2-head">
        <div>
          <h1>Test Catalog</h1>
          <p>
            {isVector ? (
              <>
                Explore our diagnostic test catalog with fair pricing. Patients pay unsashed <strong>MRP</strong>.
                Platform fee is Vector wholesale.
              </>
            ) : (
              <>Explore our diagnostic test catalog with fair pricing. Platform fee is FOCO minus commission.</>
            )}
          </p>
        </div>
        <button type="button" className="pc2-download" onClick={downloadPriceList} disabled={!filtered.length}>
          <Icon>
            <path d="M12 3v12M8 11l4 4 4-4M5 21h14" />
          </Icon>
          Download Price List (PDF)
        </button>
      </div>

      <div className="pc2-toolbar">
        <label className="pc2-search">
          <Icon>
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3-3" />
          </Icon>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search test name, code or category..."
            aria-label="Search catalog"
          />
        </label>
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All Categories</option>
          {categories.map(([name]) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Department">
          <option value="">All Departments</option>
          {categories.map(([name]) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select value={sample} onChange={(e) => setSample(e.target.value)} aria-label="Sample">
          <option value="">All Samples</option>
          {samples.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <button type="button" className="pc2-reset" onClick={resetFilters} aria-label="Reset filters">
          <Icon>
            <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" />
          </Icon>
        </button>
      </div>

      {queued.length ? (
        <div className="pc2-queue">
          <span>
            {queued.length} test{queued.length === 1 ? '' : 's'} added to the walk-in order.
          </span>
          <Link to="/b2b/order">Continue to order</Link>
        </div>
      ) : null}

      {error ? <div className="pc2-alert">{error}</div> : null}

      <div className="pc2-body">
        <aside className="pc2-side" aria-label="Categories">
          <button type="button" className={!category ? 'is-on' : ''} onClick={() => setCategory('')}>
            <Icon>
              <rect x="4" y="4" width="7" height="7" rx="1.5" />
              <rect x="13" y="4" width="7" height="7" rx="1.5" />
              <rect x="4" y="13" width="7" height="7" rx="1.5" />
              <rect x="13" y="13" width="7" height="7" rx="1.5" />
            </Icon>
            All Tests
            <i>{items.length}</i>
          </button>
          {categories.map(([name, count]) => (
            <button
              type="button"
              key={name}
              className={category === name ? 'is-on' : ''}
              onClick={() => setCategory(name === category ? '' : name)}
            >
              <Icon>
                <path d="M9 3h6l1 4H8zM7 7h10v13H7z" />
              </Icon>
              {name}
              <i>{count}</i>
            </button>
          ))}
        </aside>

        <div className="pc2-table-wrap">
          {filtered.length ? (
            <table className="pc2-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>
                    <button type="button" onClick={() => toggleSort('name')}>
                      Test Name
                    </button>
                  </th>
                  <th>
                    <button type="button" onClick={() => toggleSort('department')}>
                      Department
                    </button>
                  </th>
                  <th>
                    <button type="button" onClick={() => toggleSort('sample')}>
                      Sample Type
                    </button>
                  </th>
                  <th>
                    <button type="button" onClick={() => toggleSort('mrp')}>
                      MRP (₹)
                    </button>
                  </th>
                  <th>
                    <button type="button" onClick={() => toggleSort('partner')}>
                      Partner Rate (₹)
                    </button>
                  </th>
                  <th>
                    <button type="button" onClick={() => toggleSort('fee')}>
                      {feeLabel} (₹)
                    </button>
                  </th>
                  <th>
                    <button type="button" onClick={() => toggleSort('earn')}>
                      Your Earnings (₹)
                    </button>
                  </th>
                  <th className="pc2-action">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => {
                  const r = rates(row);
                  const added = queued.includes(row.item_code);
                  return (
                    <tr key={row.item_code}>
                      <td>{i + 1}</td>
                      <td>{row.item_name}</td>
                      <td>
                        <Chip label={categoryOf(row)} />
                      </td>
                      <td>
                        <Chip label={sampleOf(row)} />
                      </td>
                      <td>{money(r.mrp)}</td>
                      <td>
                        {money(r.partner)}
                        {r.off ? <span className="pc2-off">{r.offPct}% off</span> : null}
                      </td>
                      <td>{money(r.fee)}</td>
                      <td>{money(r.earn)}</td>
                      <td className="pc2-action">
                        <button
                          type="button"
                          className={`pc2-add${added ? ' is-on' : ''}`}
                          onClick={() => addToOrder(row.item_code)}
                          disabled={added}
                        >
                          {added ? 'Added' : 'Add to Order'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="pc2-empty">{items.length ? 'No tests match these filters.' : 'No lab items configured.'}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
