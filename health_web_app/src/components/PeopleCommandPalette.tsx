import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, PeopleEmployeeRow } from '../api';
import { useAuth } from '../auth/AuthContext';
import { isPeopleManager } from '../auth/roles';

type PaletteItem = {
  id: string;
  label: string;
  hint?: string;
  path: string;
  group: string;
};

const STATIC_NAV: PaletteItem[] = [
  { id: 'nav-dash', label: 'Dashboard', path: '/people', group: 'Pages', hint: 'Home' },
  { id: 'nav-me', label: 'My Profile', path: '/people/profile', group: 'Pages' },
  { id: 'nav-emp', label: 'Employees', path: '/people/employees', group: 'Pages' },
  { id: 'nav-att', label: 'Attendance', path: '/people/attendance', group: 'Pages' },
  { id: 'nav-leave', label: 'Leave Management', path: '/people/leave', group: 'Pages' },
  { id: 'nav-pay', label: 'Payroll', path: '/people/payslips', group: 'Pages' },
  { id: 'nav-geo', label: 'Geofencing', path: '/people/settings/geofencing', group: 'Pages' },
  { id: 'nav-roles', label: 'Role & Permissions', path: '/people/settings/roles', group: 'Pages' },
  { id: 'nav-rec', label: 'Recruitment', path: '/people/recruitment', group: 'Pages' },
  { id: 'nav-onb', label: 'Onboarding', path: '/people/onboarding', group: 'Pages' },
  { id: 'nav-dept', label: 'Departments', path: '/people/departments', group: 'Pages' },
  { id: 'nav-des', label: 'Designations', path: '/people/designations', group: 'Pages' },
  { id: 'nav-grades', label: 'Grades', path: '/people/grades', group: 'Pages' },
  { id: 'nav-pol', label: 'Policies', path: '/people/policies', group: 'Pages' },
  { id: 'nav-ast', label: 'Assets', path: '/people/assets', group: 'Pages' },
  { id: 'nav-ann', label: 'Announcements', path: '/people/announcements', group: 'Pages' },
  { id: 'nav-cal', label: 'Calendar', path: '/people/calendar', group: 'Pages' },
  { id: 'nav-rpt', label: 'Reports', path: '/people/reports', group: 'Pages' },
  { id: 'nav-ax', label: 'Analytics', path: '/people/analytics', group: 'Pages' },
];

type Props = {
  open: boolean;
  onClose: () => void;
};

export function PeopleCommandPalette({ open, onClose }: Props) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const manager = isPeopleManager(user?.roles);
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [employees, setEmployees] = useState<PeopleEmployeeRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    if (!open) return;
    setQ('');
    setEmployees([]);
    setActiveIdx(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open || !manager) return;
    const term = q.trim();
    if (term.length < 2) {
      setEmployees([]);
      return;
    }
    let active = true;
    const handle = window.setTimeout(() => {
      void (async () => {
        setSearching(true);
        try {
          const res = await api.listPeopleEmployees({ limit: 12, q: term });
          if (active) setEmployees(res.data.employees || []);
        } catch {
          if (active) setEmployees([]);
        } finally {
          if (active) setSearching(false);
        }
      })();
    }, 220);
    return () => {
      active = false;
      window.clearTimeout(handle);
    };
  }, [q, open, manager]);

  const navItems = useMemo(() => {
    const term = q.trim().toLowerCase();
    const base = manager
      ? STATIC_NAV
      : STATIC_NAV.filter((i) =>
          ['/people', '/people/attendance', '/people/leave', '/people/payslips', '/people/profile'].includes(
            i.path,
          ),
        );
    if (!term) return base.slice(0, 8);
    return base.filter(
      (i) => i.label.toLowerCase().includes(term) || i.path.toLowerCase().includes(term),
    );
  }, [q, manager]);

  const items = useMemo(() => {
    const empItems: PaletteItem[] = employees.map((e) => ({
      id: `emp-${e.id}`,
      label: e.name,
      hint: [e.id, e.department, e.designation].filter(Boolean).join(' · '),
      path: `/people/employees?q=${encodeURIComponent(e.name)}`,
      group: 'Employees',
    }));
    return [...empItems, ...navItems];
  }, [employees, navItems]);

  useEffect(() => {
    setActiveIdx(0);
  }, [items.length, q]);

  const go = useCallback(
    (item: PaletteItem) => {
      onClose();
      navigate(item.path);
    },
    [navigate, onClose],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        onClose();
      } else if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, Math.max(items.length - 1, 0)));
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      } else if (ev.key === 'Enter' && items[activeIdx]) {
        ev.preventDefault();
        go(items[activeIdx]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, items, activeIdx, go, onClose]);

  if (!open) return null;

  return (
    <div className="hrms-palette-backdrop" role="presentation" onClick={onClose}>
      <div
        className="hrms-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search People HRMS"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="hrms-palette-input">
          <span aria-hidden>⌕</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search employees, jobs, pages…"
            aria-label="Search"
          />
          <kbd>Esc</kbd>
        </div>
        <ul className="hrms-palette-list">
          {!items.length ? (
            <li className="hrms-palette-empty">
              {searching ? 'Searching…' : q.trim() ? 'No matches' : 'Type to search employees or pages'}
            </li>
          ) : (
            items.map((item, idx) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={idx === activeIdx ? 'active' : undefined}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => go(item)}
                >
                  <span>
                    <b>{item.label}</b>
                    {item.hint ? <small>{item.hint}</small> : null}
                  </span>
                  <em>{item.group}</em>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
