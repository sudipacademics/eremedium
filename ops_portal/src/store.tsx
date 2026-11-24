import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  APPROVED_EARLIER,
  ASSETS,
  BRANCHES,
  INITIAL_APPROVALS,
  INITIAL_BOOKINGS,
  INITIAL_TASKS,
  INITIAL_TOTALS,
  MOVES,
  SERVICE_JOBS,
  STOCK,
  type Approval,
  type ApprovalStatus,
  type Booking,
  type Issue,
  type Requisition,
  type Task,
  type Totals,
  type UnitId,
} from './data';

export type ModalKind = 'booking' | 'requisition' | 'task' | 'issue' | null;

export type Draft = {
  item?: string;
  unit?: UnitId;
  branch?: string;
};

export type AlertTone = 'sla' | 'stock' | 'dispatch' | 'delay' | 'equip' | 'issue';

export type AlertItem = {
  id: string;
  text: string;
  tone: AlertTone;
  href: string;
  unread: boolean;
};

type BookingInput = {
  patient: string;
  mobile: string;
  unit: UnitId;
  branch: string;
  service: string;
  when: string;
  amount: number;
};

type ReqInput = { item: string; unit: UnitId; branch: string; qty: number; note: string };
type TaskInput = { title: string; detail: string; priority: Task['priority'] };
type IssueInput = { title: string; unit: UnitId; severity: Issue['severity']; note: string };

type OpsValue = {
  totals: Totals;
  tasks: Task[];
  approvals: Approval[];
  bookings: Booking[];
  requisitions: Requisition[];
  issues: Issue[];
  alerts: AlertItem[];
  approvalCounts: { pending: number; review: number; approved: number; rejected: number };
  modal: ModalKind;
  draft: Draft | null;
  toasts: { id: number; text: string }[];
  paletteOpen: boolean;
  bellOpen: boolean;
  openModal: (kind: Exclude<ModalKind, null>, draft?: Draft) => void;
  closeModal: () => void;
  setPaletteOpen: (open: boolean) => void;
  setBellOpen: (open: boolean) => void;
  toggleTask: (id: string) => void;
  setApprovalStatus: (id: string, status: ApprovalStatus) => void;
  markAlertsRead: () => void;
  createBooking: (input: BookingInput) => void;
  createRequisition: (input: ReqInput) => void;
  createTask: (input: TaskInput) => void;
  logIssue: (input: IssueInput) => void;
  dismissToast: (id: number) => void;
  notify: (text: string) => void;
};

const OpsContext = createContext<OpsValue | null>(null);

export function OpsProvider({ children }: { children: ReactNode }) {
  const [totals, setTotals] = useState<Totals>(INITIAL_TOTALS);
  const [tasks, setTasks] = useState<Task[]>(INITIAL_TASKS);
  const [approvals, setApprovals] = useState<Approval[]>(INITIAL_APPROVALS);
  const [bookings, setBookings] = useState<Booking[]>(INITIAL_BOOKINGS);
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [seen, setSeen] = useState<Record<string, boolean>>({ a2: true, a3: true, a4: true, a5: true });
  const [modal, setModal] = useState<ModalKind>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const seq = useRef(120);

  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { id, text }]);
    window.setTimeout(() => setToasts((list) => list.filter((item) => item.id !== id)), 3400);
  }, []);

  const nextId = (prefix: string) => {
    seq.current += 1;
    return `${prefix}-${seq.current}`;
  };

  const closeModal = useCallback(() => {
    setModal(null);
    setDraft(null);
  }, []);

  const openModal = useCallback((kind: Exclude<ModalKind, null>, next?: Draft) => {
    setDraft(next ?? null);
    setModal(kind);
    setPaletteOpen(false);
    setBellOpen(false);
  }, []);

  const alerts = useMemo<AlertItem[]>(() => {
    const below = BRANCHES.filter((branch) => branch.sla < 95).length;
    const low = STOCK.filter((item) => item.unit === 'pharmacy' && item.stock < item.reorder).length;
    const pendingDispatch = MOVES.filter((move) => move.kind === 'Sample dispatch' && move.status === 'Pending').length;
    const delayedAesthetic = SERVICE_JOBS.filter((job) => job.unit === 'aesthetic' && job.status === 'Delayed').length;
    const equipDue = ASSETS.filter((asset) => asset.unit === 'care' && asset.status === 'Under Service').length;
    const base: AlertItem[] = [
      { id: 'a1', text: `${below} branches below target SLA`, tone: 'sla', href: '/quality', unread: !seen.a1 },
      { id: 'a2', text: `${low} low-stock items (Pharmacy)`, tone: 'stock', href: '/inventory', unread: !seen.a2 },
      { id: 'a3', text: `${pendingDispatch} pending sample dispatch (Lab)`, tone: 'dispatch', href: '/logistics', unread: !seen.a3 },
      { id: 'a4', text: `${delayedAesthetic} delayed appointments (Aesthetic)`, tone: 'delay', href: '/services', unread: !seen.a4 },
      { id: 'a5', text: `${equipDue} equipment service due (Care)`, tone: 'equip', href: '/assets', unread: !seen.a5 },
    ];
    const raised = issues.map((issue) => ({
      id: issue.id,
      text: issue.title,
      tone: 'issue' as const,
      href: '/quality',
      unread: !seen[issue.id],
    }));
    return [...raised, ...base];
  }, [issues, seen]);

  const approvalCounts = useMemo(() => {
    const count = (status: ApprovalStatus) => approvals.filter((item) => item.status === status).length;
    return {
      pending: count('Pending'),
      review: count('In Review'),
      approved: count('Approved') + APPROVED_EARLIER,
      rejected: count('Rejected'),
    };
  }, [approvals]);

  const toggleTask = useCallback((id: string) => {
    setTasks((list) => list.map((task) => (task.id === id ? { ...task, done: !task.done } : task)));
  }, []);

  const setApprovalStatus = useCallback(
    (id: string, status: ApprovalStatus) => {
      setApprovals((list) => list.map((item) => (item.id === id ? { ...item, status, age: 'Just now' } : item)));
      const label = status === 'In Review' ? 'moved to review' : status.toLowerCase();
      toast(`${id} ${label}`);
    },
    [toast],
  );

  const markAlertsRead = useCallback(() => {
    setSeen((current) => {
      const next = { ...current };
      alerts.forEach((alert) => {
        next[alert.id] = true;
      });
      return next;
    });
  }, [alerts]);

  const createBooking = useCallback(
    (input: BookingInput) => {
      const id = nextId('BK');
      const booking: Booking = { ...input, id, status: 'Scheduled', session: true };
      setBookings((list) => [booking, ...list]);
      setTotals((current) => ({
        ...current,
        bookings: current.bookings + 1,
        revenue: current.revenue + input.amount,
        collections: current.collections + (input.unit === 'lab' ? 1 : 0),
        deliveries: current.deliveries + (input.unit === 'care' || input.unit === 'aesthetic' ? 1 : 0),
        today: { ...current.today, [input.unit]: current.today[input.unit] + 1 },
        week: { ...current.week, [input.unit]: current.week[input.unit] + 1 },
      }));
      toast(`Booking ${id} created for ${input.patient}`);
      closeModal();
    },
    [closeModal, toast],
  );

  const createRequisition = useCallback(
    (input: ReqInput) => {
      const id = nextId('RQ');
      setRequisitions((list) => [{ id, ...input, age: 'Just now' }, ...list]);
      setApprovals((list) => [
        {
          id: nextId('AP'),
          title: `Requisition · ${input.item}`,
          type: 'Purchase',
          unit: input.unit,
          requester: 'Operations Manager',
          status: 'Pending',
          age: 'Just now',
        },
        ...list,
      ]);
      toast(`Requisition ${id} sent for approval`);
      closeModal();
    },
    [closeModal, toast],
  );

  const createTask = useCallback(
    (input: TaskInput) => {
      const id = nextId('TS');
      setTasks((list) => [{ id, title: input.title, detail: input.detail, priority: input.priority, done: false }, ...list]);
      toast('Task assigned');
      closeModal();
    },
    [closeModal, toast],
  );

  const logIssue = useCallback(
    (input: IssueInput) => {
      const id = nextId('IS');
      setIssues((list) => [{ id, ...input }, ...list]);
      toast('Issue logged for the operations desk');
      closeModal();
    },
    [closeModal, toast],
  );

  const dismissToast = useCallback((id: number) => {
    setToasts((list) => list.filter((item) => item.id !== id));
  }, []);

  const value = useMemo<OpsValue>(
    () => ({
      totals,
      tasks,
      approvals,
      bookings,
      requisitions,
      issues,
      alerts,
      approvalCounts,
      modal,
      draft,
      toasts,
      paletteOpen,
      bellOpen,
      openModal,
      closeModal,
      setPaletteOpen,
      setBellOpen,
      toggleTask,
      setApprovalStatus,
      markAlertsRead,
      createBooking,
      createRequisition,
      createTask,
      logIssue,
      dismissToast,
      notify: toast,
    }),
    [
      toast,
      totals,
      tasks,
      approvals,
      bookings,
      requisitions,
      issues,
      alerts,
      approvalCounts,
      modal,
      draft,
      toasts,
      paletteOpen,
      bellOpen,
      openModal,
      closeModal,
      toggleTask,
      setApprovalStatus,
      markAlertsRead,
      createBooking,
      createRequisition,
      createTask,
      logIssue,
      dismissToast,
    ],
  );

  return <OpsContext.Provider value={value}>{children}</OpsContext.Provider>;
}

export function useOps() {
  const value = useContext(OpsContext);
  if (!value) throw new Error('useOps must be used inside OpsProvider');
  return value;
}
