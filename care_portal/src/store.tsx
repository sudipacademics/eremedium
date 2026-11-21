import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from './api';
import type { Appointment, Asset, Branch, Invoice, Item, Level, Me, Meta, ModuleName, Patient, PhysioPackage, Practitioner, Service, ApptType, InvoiceType } from './types';

const LEVELS: Level[] = ['none', 'view', 'create', 'edit', 'approve', 'manage'];

export type ModalState =
  | { kind: 'patient'; patient?: Patient; then?: (p: Patient) => void }
  | { kind: 'appointment'; type: ApptType; patientId?: number; planId?: number }
  | { kind: 'appointmentEdit'; appointment: Appointment }
  | { kind: 'plan'; patientId?: number; packageId?: number }
  | { kind: 'planEdit'; planId: number }
  | { kind: 'invoice'; type?: InvoiceType; patientId?: number; appointment?: Appointment }
  | { kind: 'viewInvoice'; id: number }
  | { kind: 'payment'; invoice: Invoice }
  | { kind: 'item'; item?: Item }
  | { kind: 'stock'; item: Item; direction: 'in' | 'out' }
  | { kind: 'moves'; item: Item }
  | { kind: 'asset'; asset?: Asset }
  | { kind: 'assetService'; asset: Asset }
  | { kind: 'assetLogs'; asset: Asset }
  | { kind: 'branch'; branch?: Branch }
  | { kind: 'practitioner'; practitioner?: Practitioner }
  | { kind: 'service'; service?: Service; category?: ApptType }
  | { kind: 'diagnosticTest'; test?: Service }
  | { kind: 'diagnosticStarter' }
  | { kind: 'doctor'; doctor?: Practitioner }
  | { kind: 'physioPackage'; pkg?: PhysioPackage }
  | { kind: 'sessionBill'; id: number }
  | { kind: 'labBooking'; id: number };

type Toast = { id: number; text: string; tone: 'ok' | 'error' };

type CareValue = {
  me: Me;
  meta: Meta | null;
  tick: number;
  branch: number;
  branchQuery: string;
  setBranch: (id: number) => void;
  refresh: () => void;
  can: (module: ModuleName, level?: Level) => boolean;
  modal: ModalState | null;
  openModal: (modal: ModalState) => void;
  closeModal: () => void;
  toast: (text: string, tone?: Toast['tone']) => void;
  toasts: Toast[];
  dismissToast: (id: number) => void;
  mutate: <T>(work: () => Promise<T>, success?: string | ((value: T) => string)) => Promise<T | undefined>;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  onSignOut: () => void;
};

const CareContext = createContext<CareValue | null>(null);

export function CareProvider({ me, onSignOut, children }: { me: Me; onSignOut: () => void; children: ReactNode }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [tick, setTick] = useState(0);
  /* Branch-restricted staff always work in one of their HRMS branches; everyone else may pick "All branches" (0). */
  const allowedBranch = useCallback(
    (id: number) => (me.branches ? (me.branches.includes(id) ? id : me.branches[0] ?? 0) : id),
    [me],
  );
  const [branch, setBranchState] = useState<number>(() => allowedBranch(Number(localStorage.getItem('care_branch') || 0)));
  const [modal, setModal] = useState<ModalState | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    let alive = true;
    api<Meta>('/meta').then((data) => {
      if (!alive) return;
      setMeta(data);
      setBranchState((current) => allowedBranch(current && !data.branches.some((b) => b.id === current) ? 0 : current));
    }).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [tick, allowedBranch]);

  const setBranch = useCallback((id: number) => {
    const next = allowedBranch(id);
    localStorage.setItem('care_branch', String(next));
    setBranchState(next);
  }, [allowedBranch]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  const dismissToast = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const toast = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    seq.current += 1;
    const id = seq.current;
    setToasts((list) => [...list.slice(-3), { id, text, tone }]);
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), tone === 'error' ? 6000 : 3500);
  }, []);

  const can = useCallback(
    (module: ModuleName, level: Level = 'view') => {
      const have = me.modules[module] || 'none';
      return have !== 'none' && LEVELS.indexOf(have) >= LEVELS.indexOf(level);
    },
    [me],
  );

  const mutate = useCallback(
    async <T,>(work: () => Promise<T>, success?: string | ((value: T) => string)) => {
      try {
        const value = await work();
        if (success) toast(typeof success === 'function' ? success(value) : success);
        refresh();
        return value;
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Something went wrong', 'error');
        return undefined;
      }
    },
    [refresh, toast],
  );

  const value = useMemo<CareValue>(
    () => ({
      me,
      meta,
      tick,
      branch,
      branchQuery: branch ? `branch=${branch}` : '',
      setBranch,
      refresh,
      can,
      modal,
      openModal: (next) => {
        setPaletteOpen(false);
        setModal(next);
      },
      closeModal: () => setModal(null),
      toast,
      toasts,
      dismissToast,
      mutate,
      paletteOpen,
      setPaletteOpen,
      onSignOut,
    }),
    [me, meta, tick, branch, setBranch, refresh, can, modal, toast, toasts, dismissToast, mutate, paletteOpen, onSignOut],
  );

  return <CareContext.Provider value={value}>{children}</CareContext.Provider>;
}

export function useCare() {
  const value = useContext(CareContext);
  if (!value) throw new Error('useCare must be used inside CareProvider');
  return value;
}

/* Loads `path` and reloads it whenever anything in the portal changes. Keeps the last data while reloading. */
export function useApi<T>(path: string | null) {
  const { tick } = useCare();
  const [state, setState] = useState<{ data: T | undefined; error: string; loading: boolean }>({ data: undefined, error: '', loading: Boolean(path) });
  const [local, setLocal] = useState(0);

  useEffect(() => {
    if (!path) return;
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    api<T>(path)
      .then((data) => alive && setState({ data, error: '', loading: false }))
      .catch((err: Error) => alive && setState((s) => ({ ...s, error: err.message, loading: false })));
    return () => {
      alive = false;
    };
  }, [path, tick, local]);

  return { ...state, reload: () => setLocal((n) => n + 1) };
}

export function withQuery(path: string, params: Record<string, string | number | undefined | null | false>) {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '' && value !== false && value !== 0) q.set(key, String(value));
  }
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
