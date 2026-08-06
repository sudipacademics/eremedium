'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RFMS_API_BASE } from '@rfms/utils';

const API_BASE = RFMS_API_BASE;

type Centre = {
  id: string;
  hec_centre_id?: string;
  centre_name: string;
  status: string;
  wallet_amount: number;
  total_deposit: number;
  contact_number?: string;
  manual_address?: string;
  logistics_assignments?: { person_name: string; contact_number?: string; pickup_point?: string; logistics_cost?: number }[];
};

type SalesEntry = {
  id: string;
  hec_sales_id?: string;
  centre_name?: string;
  sales_date?: string;
  number_of_samples: number;
  business_value: number;
  assigned_logistics_person?: string;
  status: string;
  reach_user?: string;
  remarks?: string;
};

type Summary = {
  centres_count: number;
  sales_count: number;
  samples_total: number;
  business_value_total: number;
  pending_verification: number;
};

type Envelope<T> = { success?: boolean; data?: T; error?: { message?: string } };

export function B2bOperationsModule({ token, search, notify }: { token: string; search: string; notify: (message: string) => void }) {
  const [tab, setTab] = useState<'sales' | 'centres'>('sales');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [centres, setCentres] = useState<Centre[]>([]);
  const [sales, setSales] = useState<SalesEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [summaryRes, centresRes, salesRes] = await Promise.all([
        fetch(`${API_BASE}/admin/b2b/summary`, { headers }),
        fetch(`${API_BASE}/admin/b2b/centres`, { headers }),
        fetch(`${API_BASE}/admin/b2b/sales`, { headers }),
      ]);
      const summaryJson = await summaryRes.json() as Envelope<Summary>;
      const centresJson = await centresRes.json() as Envelope<Centre[]>;
      const salesJson = await salesRes.json() as Envelope<SalesEntry[]>;
      if (!summaryRes.ok || !summaryJson.success) throw new Error(summaryJson.error?.message ?? 'Unable to load B2B summary.');
      if (!centresRes.ok || !centresJson.success || !Array.isArray(centresJson.data)) throw new Error(centresJson.error?.message ?? 'Unable to load B2B centres.');
      if (!salesRes.ok || !salesJson.success || !Array.isArray(salesJson.data)) throw new Error(salesJson.error?.message ?? 'Unable to load B2B sales.');
      setSummary(summaryJson.data ?? null);
      setCentres(centresJson.data);
      setSales(salesJson.data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load B2B operations.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const visibleSales = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sales;
    return sales.filter((item) => `${item.centre_name} ${item.reach_user} ${item.assigned_logistics_person} ${item.status}`.toLowerCase().includes(q));
  }, [sales, search]);

  const visibleCentres = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return centres;
    return centres.filter((item) => `${item.centre_name} ${item.contact_number} ${item.status} ${item.manual_address}`.toLowerCase().includes(q));
  }, [centres, search]);

  async function verifySale(entry: SalesEntry, status: string) {
    setBusyId(entry.id);
    try {
      const response = await fetch(`${API_BASE}/admin/b2b/sales/${encodeURIComponent(entry.id)}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const payload = await response.json() as Envelope<{ entry: SalesEntry }>;
      if (!response.ok || !payload.success || !payload.data?.entry) throw new Error(payload.error?.message ?? 'Unable to update sales entry.');
      setSales((current) => current.map((item) => (item.id === entry.id ? payload.data!.entry : item)));
      notify(`B2B sales marked ${status.toLowerCase()}.`);
      void load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to update sales entry.');
    } finally {
      setBusyId('');
    }
  }

  return (
    <section className="b2b-operations">
      <div className="title-row">
        <div>
          <p className="franchisee-kicker">REACH sync</p>
          <h1>B2B Operations</h1>
          <p>Monitor B2B collection centres and daily sales synced from REACH. Verify entries, assign logistics and track performance.</p>
        </div>
        <button className="date" type="button" onClick={() => void load()}>Refresh</button>
      </div>
      <div className="module-summary">
        <section><span>Centres</span><b>{summary?.centres_count ?? 0}</b><small>Registered B2B collection centres</small></section>
        <section><span>Sales entries</span><b>{summary?.sales_count ?? 0}</b><small>Daily B2B submissions</small></section>
        <section><span>Samples</span><b>{summary?.samples_total ?? 0}</b><small>Total samples logged</small></section>
        <section><span>Business value</span><b>₹{(summary?.business_value_total ?? 0).toLocaleString('en-IN')}</b><small>{summary?.pending_verification ?? 0} pending verification</small></section>
      </div>
      <div className="support-module-tabs" role="tablist">
        <button type="button" className={tab === 'sales' ? 'active' : ''} onClick={() => setTab('sales')}>Sales performance</button>
        <button type="button" className={tab === 'centres' ? 'active' : ''} onClick={() => setTab('centres')}>Collection centres</button>
      </div>
      {error ? <p className="application-review-error">{error}</p> : null}
      {tab === 'sales' ? (
        <section className="panel data-panel">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Centre</th><th>Samples</th><th>Business value</th><th>Logistics</th><th>REACH user</th><th>Status</th><th /></tr></thead>
              <tbody>
                {loading ? <tr><td colSpan={8} className="empty">Loading B2B sales…</td></tr> : null}
                {!loading && !visibleSales.length ? <tr><td colSpan={8} className="empty">No B2B sales synced yet.</td></tr> : null}
                {visibleSales.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.sales_date || '—'}</td>
                    <td><b>{entry.centre_name || '—'}</b></td>
                    <td>{entry.number_of_samples}</td>
                    <td>₹{Number(entry.business_value || 0).toLocaleString('en-IN')}</td>
                    <td>{entry.assigned_logistics_person || '—'}</td>
                    <td>{entry.reach_user || '—'}</td>
                    <td>{entry.status}</td>
                    <td>
                      {String(entry.status).toLowerCase() === 'submitted' ? (
                        <button type="button" className="row-action" disabled={busyId === entry.id} onClick={() => void verifySale(entry, 'Verified')}>
                          {busyId === entry.id ? 'Saving…' : 'Verify'}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="panel data-panel">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Centre</th><th>Contact</th><th>Wallet</th><th>Deposit</th><th>Logistics</th><th>Status</th></tr></thead>
              <tbody>
                {loading ? <tr><td colSpan={6} className="empty">Loading centres…</td></tr> : null}
                {!loading && !visibleCentres.length ? <tr><td colSpan={6} className="empty">No B2B collection centres synced yet.</td></tr> : null}
                {visibleCentres.map((centre) => (
                  <tr key={centre.id}>
                    <td><b>{centre.centre_name}</b><br /><small>{centre.manual_address || '—'}</small></td>
                    <td>{centre.contact_number || '—'}</td>
                    <td>₹{Number(centre.wallet_amount || 0).toLocaleString('en-IN')}</td>
                    <td>₹{Number(centre.total_deposit || 0).toLocaleString('en-IN')}</td>
                    <td>{(centre.logistics_assignments || []).map((row) => row.person_name).join(', ') || '—'}</td>
                    <td>{centre.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </section>
  );
}
