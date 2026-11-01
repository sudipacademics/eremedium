import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import { canManageInventory, isRequesterOnly } from '../../../auth/roles';
import { MyRequestsView } from './MyRequestsView';
import type { InvDashboard, InvItem, InvItemFilters } from '../../../types/labInventory';
import { InvContext, INV_ICONS, errMsg, Svg, addDaysIso, todayIso, downloadExport } from './shared';
import { MaterialListTab } from './MaterialListTab';
import { ItemFormModal } from './ItemFormModal';
import { StockInTab } from './StockInTab';
import { StockAdjustmentTab } from './StockAdjustmentTab';
import { RequisitionTab } from './RequisitionTab';
import { DispatchTab } from './DispatchTab';
import { HistoryTab } from './HistoryTab';
import { ReportsTab } from './ReportsTab';
import '../lab-tech-v2.css';
import './inventory.css';

type TabKey = 'list' | 'stock-in' | 'adjust' | 'requisitions' | 'dispatch' | 'history' | 'reports';

const TABS: Array<{ key: TabKey; label: string; icon: keyof typeof INV_ICONS }> = [
  { key: 'list', label: 'Material List', icon: 'list' },
  { key: 'stock-in', label: 'Stock In', icon: 'stockIn' },
  { key: 'adjust', label: 'Stock Adjustment', icon: 'adjust' },
  { key: 'requisitions', label: 'Material Requisition', icon: 'requisition' },
  { key: 'dispatch', label: 'Dispatch / Transfer', icon: 'truck' },
  { key: 'history', label: 'Stock History', icon: 'history' },
  { key: 'reports', label: 'Reports', icon: 'reports' },
];

type KpiTone = 'blue' | 'teal' | 'amber' | 'pink' | 'purple' | 'cyan';

function Kpi({
  tone,
  icon,
  value,
  label,
  hint,
  onClick,
}: {
  tone: KpiTone;
  icon: keyof typeof INV_ICONS;
  value: ReactNode;
  label: string;
  hint: string;
  onClick?: () => void;
}) {
  return (
    <button type="button" className={`inv-kpi tone-${tone}`} onClick={onClick}>
      <span className="inv-kpi-copy">
        <strong>{value}</strong>
        <b>{label}</b>
        <small>{hint}</small>
      </span>
      <span className="inv-kpi-icon">
        <Svg size={22}>{INV_ICONS[icon]}</Svg>
      </span>
    </button>
  );
}

export function InventoryManagementPage() {
  const { user } = useAuth();
  return isRequesterOnly(user?.roles) ? <MyRequestsView /> : <InventoryWorkspace />;
}

function InventoryWorkspace() {
  const { user } = useAuth();
  const canManage = canManageInventory(user?.roles);
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.key === params.get('tab'))?.key || 'list') as TabKey;
  const [dash, setDash] = useState<InvDashboard | null>(null);
  const [catalog, setCatalog] = useState<InvItem[]>([]);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [listPreset, setListPreset] = useState<{ filters: InvItemFilters; key: number } | null>(null);
  const [stockInPreset, setStockInPreset] = useState<string[] | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, c] = await Promise.all([api.getInventoryDashboard(), api.listInventoryItems({ show: 'active' }, 1, 2000)]);
      setDash(d.data);
      setCatalog(c.data.rows);
      setUpdatedAt(new Date());
      setError(null);
    } catch (e) {
      setError(errMsg(e, 'Could not load inventory'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  const refreshAll = useCallback(() => {
    setVersion((v) => v + 1);
    void load();
  }, [load]);

  const notify = useCallback((msg: string) => {
    setError(null);
    setNotice(msg);
  }, []);
  const fail = useCallback((err: unknown) => setError(errMsg(err)), []);

  const ctx = useMemo(
    () => ({
      meta: dash?.meta ?? null,
      canManage: canManage && Boolean(dash?.meta.can_manage ?? true),
      catalog,
      version,
      refreshAll,
      notify,
      fail,
    }),
    [dash, canManage, catalog, version, refreshAll, notify, fail],
  );

  function go(next: TabKey) {
    const p = new URLSearchParams(params);
    if (next === 'list') p.delete('tab');
    else p.set('tab', next);
    setParams(p, { replace: true });
  }

  function showList(filters: InvItemFilters) {
    setListPreset({ filters, key: Date.now() });
    go('list');
  }

  async function exportList(fmt: 'xlsx' | 'csv') {
    setMenuOpen(false);
    try {
      const res = await api.exportLabInventory('items', fmt, { show: 'active' });
      downloadExport(res.data);
    } catch (e) {
      setError(errMsg(e, 'Export failed'));
    }
  }

  const k = dash?.kpis;
  const n = (v?: number) => (v === undefined ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: 3 }));

  return (
    <InvContext.Provider value={ctx}>
      <div className="lt-page inv-page">
        <section className="lt-hero inv-hero">
          <div className="lt-hero-icon">
            <Svg size={30}>{INV_ICONS.box}</Svg>
          </div>
          <div className="inv-hero-copy">
            <h2>Inventory Management</h2>
            <p>Manage material inventory, process requisitions and dispatch materials to franchise and other units.</p>
          </div>
          <div className="inv-hero-tools">
            <span className="inv-live">
              <i aria-hidden /> Live
              {updatedAt
                ? ` · updated ${updatedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}`
                : ''}
            </span>
            <button type="button" className="inv-hero-btn" onClick={refreshAll} disabled={loading}>
              <Svg size={16}>{INV_ICONS.refresh}</Svg>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </section>

        <section className="inv-kpis" aria-label="Inventory summary">
          <Kpi tone="blue" icon="box" value={n(k?.total_items)} label="Total Items" hint="All inventory items" onClick={() => showList({})} />
          <Kpi tone="teal" icon="stack" value={n(k?.available_stock)} label="Available Stock" hint="Units in stock (non-expired)" onClick={() => showList({ status: 'In Stock' })} />
          <Kpi tone="amber" icon="warn" value={n(k?.low_stock_items)} label="Low Stock Items" hint="At or below minimum level" onClick={() => showList({ status: 'Low Stock' })} />
          <Kpi
            tone="pink"
            icon="calendar"
            value={n(k?.expiring_soon)}
            label="Expiring Soon"
            hint={`Batches within ${dash?.meta.expiry_window_days ?? 90} days`}
            onClick={() => showList({ expiry_from: todayIso(), expiry_to: addDaysIso(dash?.meta.expiry_window_days ?? 90) })}
          />
          <Kpi tone="purple" icon="doc" value={n(k?.pending_requisitions)} label="Pending Requisitions" hint="Awaiting approval" onClick={() => go('requisitions')} />
          <Kpi tone="cyan" icon="truck" value={n(k?.dispatched_this_month)} label="Dispatched (This Month)" hint="Total dispatches" onClick={() => go('dispatch')} />
        </section>

        {error ? (
          <div className="inv-alert is-error" role="alert">
            {error}
            <button type="button" onClick={() => setError(null)} aria-label="Dismiss">
              ×
            </button>
          </div>
        ) : null}
        {notice ? <div className="inv-alert" role="status">{notice}</div> : null}

        <section className="inv-card">
          <div className="inv-tabs-row">
            <nav className="inv-tabs" role="tablist" aria-label="Inventory sections">
              {TABS.map((t) => (
                <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'is-active' : ''} onClick={() => go(t.key)}>
                  <Svg size={17}>{INV_ICONS[t.icon]}</Svg>
                  {t.label}
                  {t.key === 'requisitions' && k?.pending_requisitions ? <span className="inv-tab-count">{k.pending_requisitions}</span> : null}
                </button>
              ))}
            </nav>
            <div className="inv-add" ref={menuRef}>
              {ctx.canManage ? (
                <button type="button" className="inv-add-main" onClick={() => setAddOpen(true)}>
                  <Svg size={16}>{INV_ICONS.plus}</Svg>
                  Add New Item
                </button>
              ) : null}
              <button
                type="button"
                className={`inv-add-caret${ctx.canManage ? '' : ' is-solo'}`}
                aria-label="More actions"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((v) => !v)}
              >
                {ctx.canManage ? '▾' : 'Export ▾'}
              </button>
              {menuOpen ? (
                <div className="lt-row-menu-pop inv-add-menu" role="menu">
                  {ctx.canManage ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          go('stock-in');
                        }}
                      >
                        Receive stock (Stock In)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          go('dispatch');
                        }}
                      >
                        New dispatch / transfer
                      </button>
                    </>
                  ) : null}
                  <button type="button" onClick={() => void exportList('xlsx')}>
                    Export material list (Excel)
                  </button>
                  <button type="button" onClick={() => void exportList('csv')}>
                    Export material list (CSV)
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          <div className="inv-tab-body">
            {tab === 'list' ? (
              <MaterialListTab
                preset={listPreset}
                onStockIn={(items) => {
                  setStockInPreset(items);
                  go('stock-in');
                }}
              />
            ) : null}
            {tab === 'stock-in' ? <StockInTab preset={stockInPreset} onPresetUsed={() => setStockInPreset(null)} /> : null}
            {tab === 'adjust' ? <StockAdjustmentTab /> : null}
            {tab === 'requisitions' ? <RequisitionTab /> : null}
            {tab === 'dispatch' ? <DispatchTab /> : null}
            {tab === 'history' ? <HistoryTab /> : null}
            {tab === 'reports' ? <ReportsTab /> : null}
          </div>
        </section>

        {!ctx.canManage ? (
          <p className="inv-readonly-note">
            You have read-only access to inventory. Stock movements, approvals and dispatches are done by the Lab Manager.
          </p>
        ) : null}
      </div>

      {addOpen ? (
        <ItemFormModal
          onClose={() => setAddOpen(false)}
          onSaved={(name) => {
            setAddOpen(false);
            ctx.notify(`Item ${name} saved`);
            refreshAll();
          }}
        />
      ) : null}
    </InvContext.Provider>
  );
}
