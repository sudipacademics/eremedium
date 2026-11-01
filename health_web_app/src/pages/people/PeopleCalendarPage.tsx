import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  type PeopleCalendarBoard,
  type PeopleCalendarEvent,
  type PeopleCalendarEventType,
} from '../../api';
import { HrmsIcon } from '../../components/HrmsIcons';
import './people-portal.css';
import './people-hrms-shell.css';
import './people-employees.css';
import './people-departments.css';
import './people-attendance.css';
import './people-leave.css';
import './people-calendar.css';

type ViewMode = 'Month' | 'Week';
const VIEWS: ViewMode[] = ['Month', 'Week'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const TYPES: Array<{ id: PeopleCalendarEventType; label: string; tone: string; icon: string }> = [
  { id: 'Holiday', label: 'Holidays', tone: 'rose', icon: 'palm' },
  { id: 'Meeting', label: 'Meetings', tone: 'blue', icon: 'users' },
  { id: 'Training', label: 'Training', tone: 'violet', icon: 'training' },
  { id: 'Payroll', label: 'Payroll', tone: 'amber', icon: 'wallet' },
  { id: 'Birthday', label: 'Birthdays', tone: 'pink', icon: 'cake' },
  { id: 'Work Anniversary', label: 'Work Anniversaries', tone: 'purple', icon: 'gift' },
  { id: 'Other', label: 'Other Events', tone: 'green', icon: 'calendar' },
];

type FormState = {
  id?: string;
  title: string;
  event_type: string;
  event_date: string;
  start_time: string;
  end_time: string;
  all_day: boolean;
  audience: string;
  description: string;
};

function errMsg(e: unknown, fallback: string) {
  return e instanceof Error && e.message ? e.message : fallback;
}
function pad(n: number) {
  return String(n).padStart(2, '0');
}
function isoDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function parseIso(iso: string) {
  return new Date(`${iso.slice(0, 10)}T00:00:00`);
}
function fmtLong(iso: string) {
  return parseIso(iso).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtShort(iso: string) {
  return parseIso(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtTime(t?: string, allDay?: number | boolean) {
  if (allDay) return 'Full Day';
  if (!t) return '';
  const [hs, ms] = t.split(':');
  const h = Number(hs);
  if (Number.isNaN(h)) return t;
  const am = h >= 12 ? 'PM' : 'AM';
  const hr = ((h + 11) % 12) + 1;
  return `${pad(hr)}:${pad(Number(ms) || 0)} ${am}`;
}
function typeMeta(t: string) {
  return TYPES.find((x) => x.id === t) || TYPES[TYPES.length - 1];
}
function emptyForm(date: string, eventType = 'Meeting'): FormState {
  return {
    title: '',
    event_type: eventType,
    event_date: date,
    start_time: '10:00',
    end_time: '',
    all_day: eventType === 'Holiday' || eventType === 'Birthday' || eventType === 'Work Anniversary',
    audience: 'All Employees',
    description: '',
  };
}
function fromRow(e: PeopleCalendarEvent): FormState {
  return {
    id: e.id,
    title: e.title,
    event_type: e.event_type || 'Other',
    event_date: (e.event_date || '').slice(0, 10),
    start_time: e.start_time || '10:00',
    end_time: e.end_time || '',
    all_day: Boolean(e.all_day),
    audience: e.audience || 'All Employees',
    description: e.description || '',
  };
}
function monthCells(year: number, month: number) {
  const first = new Date(year, month, 1);
  const startDow = first.getDay();
  const daysIn = new Date(year, month + 1, 0).getDate();
  const prevDays = new Date(year, month, 0).getDate();
  const cells: Array<{ date: string; day: number; other: boolean }> = [];
  for (let i = 0; i < 42; i += 1) {
    const dayNum = i - startDow + 1;
    if (dayNum < 1) {
      const d = new Date(year, month - 1, prevDays + dayNum);
      cells.push({ date: isoDate(d), day: prevDays + dayNum, other: true });
    } else if (dayNum > daysIn) {
      const d = new Date(year, month + 1, dayNum - daysIn);
      cells.push({ date: isoDate(d), day: dayNum - daysIn, other: true });
    } else {
      cells.push({ date: isoDate(new Date(year, month, dayNum)), day: dayNum, other: false });
    }
  }
  while (cells.length > 35 && cells.slice(-7).every((c) => c.other)) {
    cells.splice(-7, 7);
  }
  return cells;
}

export function PeopleCalendarPage({ preview }: { preview?: PeopleCalendarBoard }) {
  const [isManager, setIsManager] = useState<boolean | null>(preview ? true : null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (preview) return;
    let alive = true;
    void (async () => {
      try {
        const res = await api.getPeopleHrmsDashboard();
        if (alive) setIsManager(Boolean(res.data.is_manager));
      } catch (err) {
        if (alive) setError(err instanceof Error && err.message ? err.message : 'Unable to load calendar');
      }
    })();
    return () => {
      alive = false;
    };
  }, [preview]);

  if (error) return <div className="people-alert err">{error}</div>;
  if (isManager === null) return <p className="lv-muted">Loading calendar…</p>;
  return <CalendarDesk preview={preview} manager={Boolean(isManager)} />;
}

function CalendarDesk({ preview, manager }: { preview?: PeopleCalendarBoard; manager: boolean }) {
  const [board, setBoard] = useState<PeopleCalendarBoard | null>(preview || null);
  const [loading, setLoading] = useState(!preview);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const todayIso = board?.today || isoDate(new Date());
  const [cursor, setCursor] = useState(() => parseIso(todayIso));
  const [selected, setSelected] = useState(todayIso);
  const [view, setView] = useState<ViewMode>('Month');
  const [visible, setVisible] = useState<Set<string>>(() => new Set(TYPES.map((t) => t.id)));
  const [filterOpen, setFilterOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addMenu, setAddMenu] = useState(false);
  const [form, setForm] = useState<FormState>(() => emptyForm(todayIso));

  const load = useCallback(async () => {
    if (preview) {
      setBoard(preview);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await api.getPeopleCalendar();
      setBoard(res.data);
    } catch (e) {
      setError(errMsg(e, 'Unable to load calendar'));
    } finally {
      setLoading(false);
    }
  }, [preview]);

  useEffect(() => {
    void load();
  }, [load]);

  const events = useMemo(
    () => (board?.events || []).filter((e) => visible.has(e.event_type || 'Other')),
    [board, visible],
  );
  const byDate = useMemo(() => {
    const map = new Map<string, PeopleCalendarEvent[]>();
    for (const e of events) {
      const key = (e.event_date || '').slice(0, 10);
      if (!key) continue;
      const list = map.get(key) || [];
      list.push(e);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        if (a.all_day && !b.all_day) return -1;
        if (!a.all_day && b.all_day) return 1;
        return (a.start_time || '').localeCompare(b.start_time || '');
      });
    }
    return map;
  }, [events]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const cells = useMemo(() => monthCells(year, month), [year, month]);
  const selectedEvents = byDate.get(selected) || [];
  const upcoming = useMemo(
    () => events.filter((e) => (e.event_date || '') > selected).slice(0, 5),
    [events, selected],
  );

  const weekStart = useMemo(() => {
    const d = parseIso(selected);
    d.setDate(d.getDate() - d.getDay());
    return d;
  }, [selected]);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => isoDate(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i))),
    [weekStart],
  );

  const k = board?.kpis;
  const kpis = [
    {
      label: "Today's Events",
      value: k?.today ?? 0,
      sub: `${k?.today_meetings || 0} meeting${k?.today_meetings === 1 ? '' : 's'}, ${k?.today_holidays || 0} holiday${k?.today_holidays === 1 ? '' : 's'}`,
      icon: 'calendar',
      tone: 'blue',
    },
    {
      label: 'Upcoming (Next 7 Days)',
      value: k?.upcoming_7 ?? 0,
      sub: `${k?.upcoming_meetings || 0} meetings, ${k?.upcoming_holidays || 0} holidays, ${k?.upcoming_others || 0} others`,
      icon: 'clock',
      tone: 'amber',
    },
    {
      label: 'Holidays This Month',
      value: k?.holidays_month ?? 0,
      sub: `${k?.holidays_upcoming || 0} upcoming`,
      icon: 'palm',
      tone: 'green',
    },
    {
      label: 'Birthdays This Month',
      value: k?.birthdays_month ?? 0,
      sub: `${k?.birthdays_today || 0} today`,
      icon: 'cake',
      tone: 'pink',
    },
  ];

  async function run(fn: () => Promise<unknown>, ok: string) {
    if (preview) {
      setNotice(ok);
      setAddOpen(false);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await fn();
      setNotice(ok);
      setAddOpen(false);
      await load();
    } catch (e) {
      setError(errMsg(e, 'Action failed'));
    } finally {
      setBusy(false);
    }
  }

  function shiftMonth(delta: number) {
    setCursor(new Date(year, month + delta, 1));
  }
  function goToday() {
    const d = parseIso(todayIso);
    setCursor(d);
    setSelected(todayIso);
  }
  function openAdd(type = 'Meeting') {
    setForm(emptyForm(selected, type));
    setAddOpen(true);
    setAddMenu(false);
  }

  async function saveEvent() {
    if (!form.title.trim() || !form.event_date) {
      setError('Title and date are required');
      return;
    }
    await run(
      () =>
        api.savePeopleCalendarEvent({
          id: form.id,
          title: form.title.trim(),
          event_type: form.event_type,
          event_date: form.event_date,
          start_time: form.all_day ? '' : form.start_time,
          end_time: form.all_day ? '' : form.end_time,
          all_day: form.all_day ? 1 : 0,
          audience: form.audience,
          description: form.description,
        }),
      form.id ? 'Event updated' : 'Event added',
    );
  }

  function toggleType(id: string) {
    setVisible((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function chipsFor(date: string) {
    const items = byDate.get(date) || [];
    if (items.length <= 2) return { show: items, more: 0 };
    return { show: items.slice(0, 1), more: items.length - 1 };
  }

  return (
    <div className="hrms-list-page emp-page dep-page lv-page cal-page">
      <div className="dep-head">
        <div className="dep-title">
          <span className="dep-title-icon lv-title-icon">
            <HrmsIcon name="calendar" size={28} />
          </span>
          <div>
            <h1>Calendar</h1>
            <p>View and manage important HR events, meetings, holidays, payroll dates and more.</p>
          </div>
        </div>
        <div className="dep-head-actions cal-head-actions">
          <div className="emp-filter-wrap">
            <button type="button" className={`emp-btn${filterOpen ? ' on' : ''}`} onClick={() => setFilterOpen((v) => !v)}>
              <HrmsIcon name="filter" size={16} /> Filter
            </button>
            {filterOpen ? (
              <div className="emp-popover emp-menu att-export-menu cal-filter-menu">
                {TYPES.map((t) => (
                  <label key={t.id} className="cal-check">
                    <input type="checkbox" checked={visible.has(t.id)} onChange={() => toggleType(t.id)} />
                    {t.label}
                  </label>
                ))}
              </div>
            ) : null}
          </div>
          <label className="dsg-select cal-view-select">
            <span>{view}</span>
            <HrmsIcon name="chevronDown" size={16} />
            <select value={view} onChange={(e) => setView(e.target.value as ViewMode)} aria-label="Calendar view">
              {VIEWS.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <button type="button" className="emp-btn outline cal-nav-btn" onClick={() => shiftMonth(-1)} aria-label="Previous month">
            <HrmsIcon name="chevronRight" size={16} style={{ transform: 'rotate(180deg)' }} />
          </button>
          <button type="button" className="emp-btn outline cal-nav-btn" onClick={() => shiftMonth(1)} aria-label="Next month">
            <HrmsIcon name="chevronRight" size={16} />
          </button>
          <button type="button" className="emp-btn" onClick={goToday}>
            Today
          </button>
          {manager ? (
            <div className="emp-filter-wrap cal-add-wrap">
              <button type="button" className="emp-btn primary lg" onClick={() => openAdd()}>
                <HrmsIcon name="plus" size={17} />
                Add Event
              </button>
              <button type="button" className="emp-btn primary cal-add-caret" aria-label="Add event type" onClick={() => setAddMenu((v) => !v)}>
                <HrmsIcon name="chevronDown" size={16} />
              </button>
              {addMenu ? (
                <div className="emp-popover emp-menu att-export-menu">
                  {TYPES.map((t) => (
                    <button key={t.id} type="button" onClick={() => openAdd(t.id)}>
                      {t.id}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {error ? <div className="people-alert err">{error}</div> : null}
      {notice ? (
        <div className="dsg-selbar">
          <span className="emp-notice">{notice}</span>
        </div>
      ) : null}

      <div className="att-kpis cal-kpis">
        {kpis.map((kp) => (
          <div key={kp.label} className="emp-card att-kpi">
            <span className={`dep-kpi-icon ${kp.tone}`}>
              <HrmsIcon name={kp.icon} size={22} />
            </span>
            <div>
              <b>{kp.label}</b>
              <strong>{loading && !board ? '…' : kp.value.toLocaleString()}</strong>
              <small>{kp.sub}</small>
            </div>
          </div>
        ))}
      </div>

      <div className="cal-body">
        <section className="emp-card cal-board">
          <header className="cal-month-head">
            {cursor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
          </header>
          {view === 'Month' ? (
            <div className="cal-grid">
              {WEEKDAYS.map((d) => (
                <b key={d}>{d}</b>
              ))}
              {cells.map((cell) => {
                const { show, more } = chipsFor(cell.date);
                const on = cell.date === selected;
                const isToday = cell.date === todayIso;
                return (
                  <button
                    key={cell.date}
                    type="button"
                    className={`cal-cell${cell.other ? ' other' : ''}${on ? ' on' : ''}${isToday ? ' today' : ''}`}
                    onClick={() => {
                      setSelected(cell.date);
                      if (cell.other) setCursor(parseIso(cell.date));
                    }}
                  >
                    <span className="cal-daynum">{cell.day}</span>
                    {show.map((e) => (
                      <span key={e.id} className={`cal-chip ${typeMeta(e.event_type).tone}`}>
                        {e.title}
                        {e.all_day ? '' : e.start_time ? ` ${fmtTime(e.start_time)}` : ''}
                      </span>
                    ))}
                    {more ? <small className="cal-more">+{more} more</small> : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="cal-week">
              {weekDays.map((date) => {
                const d = parseIso(date);
                const items = byDate.get(date) || [];
                return (
                  <button
                    key={date}
                    type="button"
                    className={`cal-week-col${date === selected ? ' on' : ''}${date === todayIso ? ' today' : ''}`}
                    onClick={() => {
                      setSelected(date);
                      setCursor(d);
                    }}
                  >
                    <b>
                      {WEEKDAYS[d.getDay()]} <span>{d.getDate()}</span>
                    </b>
                    {items.map((e) => (
                      <span key={e.id} className={`cal-chip ${typeMeta(e.event_type).tone}`}>
                        {e.title}
                        <small>{e.all_day ? 'Full Day' : fmtTime(e.start_time)}</small>
                      </span>
                    ))}
                  </button>
                );
              })}
            </div>
          )}
          <footer className="cal-legend">
            <b>Show/Hide</b>
            {TYPES.map((t) => (
              <label key={t.id} className="cal-check">
                <input type="checkbox" checked={visible.has(t.id)} onChange={() => toggleType(t.id)} />
                <i className={t.tone} />
                {t.label}
              </label>
            ))}
          </footer>
        </section>

        <aside className="cal-aside">
          <section className="emp-card cal-panel">
            <header>
              Events on {fmtLong(selected)}
              <span className="cal-count">{selectedEvents.length}</span>
            </header>
            {selectedEvents.length ? (
              <ul className="cal-day-list">
                {selectedEvents.map((e) => {
                  const meta = typeMeta(e.event_type);
                  return (
                    <li key={e.id} className={meta.tone}>
                      <span className={`cal-type ${meta.tone}`}>
                        <HrmsIcon name={meta.icon} size={15} />
                      </span>
                      <div>
                        <b>{e.title}</b>
                        <small>
                          {e.audience || 'All Employees'}
                          {' · '}
                          {e.all_day ? 'Full Day' : [fmtTime(e.start_time), fmtTime(e.end_time)].filter(Boolean).join(' – ') || '—'}
                        </small>
                      </div>
                      {manager ? (
                        <button
                          type="button"
                          className="cal-edit"
                          aria-label={`Edit ${e.title}`}
                          onClick={() => {
                            setForm(fromRow(e));
                            setAddOpen(true);
                          }}
                        >
                          <HrmsIcon name="pencil" size={14} />
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="lv-muted">No events on this day.</p>
            )}
          </section>

          <section className="emp-card cal-panel">
            <header>Mini Calendar</header>
            <div className="cal-mini-head">
              <button type="button" className="emp-btn outline cal-nav-btn" onClick={() => shiftMonth(-1)} aria-label="Previous mini month">
                <HrmsIcon name="chevronRight" size={14} style={{ transform: 'rotate(180deg)' }} />
              </button>
              <strong>{cursor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</strong>
              <button type="button" className="emp-btn outline cal-nav-btn" onClick={() => shiftMonth(1)} aria-label="Next mini month">
                <HrmsIcon name="chevronRight" size={14} />
              </button>
            </div>
            <div className="cal-mini">
              {WEEKDAYS.map((d) => (
                <b key={d}>{d.slice(0, 2)}</b>
              ))}
              {cells.map((cell) => {
                const has = (byDate.get(cell.date) || []).length > 0;
                return (
                  <button
                    key={`m-${cell.date}`}
                    type="button"
                    className={`cal-mini-day${cell.other ? ' other' : ''}${cell.date === selected ? ' on' : ''}${cell.date === todayIso ? ' today' : ''}${has ? ' has' : ''}`}
                    onClick={() => {
                      setSelected(cell.date);
                      if (cell.other) setCursor(parseIso(cell.date));
                    }}
                  >
                    {cell.day}
                    {has ? <i /> : null}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="emp-card cal-panel">
            <header>
              Upcoming Events
              <button type="button" className="cal-link" onClick={() => setSelected(todayIso)}>
                View All
              </button>
            </header>
            <ul className="cal-up-list">
              {upcoming.map((e) => {
                const meta = typeMeta(e.event_type);
                return (
                  <li key={e.id}>
                    <span className={`cal-type ${meta.tone}`}>
                      <HrmsIcon name={meta.icon} size={15} />
                    </span>
                    <div>
                      <b>{e.title}</b>
                      <small>
                        {fmtShort(e.event_date)}
                        {e.all_day ? '' : e.start_time ? `, ${fmtTime(e.start_time)}` : ''}
                      </small>
                    </div>
                  </li>
                );
              })}
              {!upcoming.length ? <li className="lv-muted">No upcoming events.</li> : null}
            </ul>
          </section>
        </aside>
      </div>

      {addOpen ? (
        <div className="cal-modal-bg" onClick={() => setAddOpen(false)} role="presentation">
          <div
            className="emp-card cal-modal"
            role="dialog"
            aria-labelledby="cal-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="cal-modal-title">{form.id ? 'Edit Event' : 'Add Event'}</h2>
            <label>
              Title *
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Event title" />
            </label>
            <label>
              Type
              <select value={form.event_type} onChange={(e) => setForm({ ...form, event_type: e.target.value })}>
                {TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Date *
              <input type="date" value={form.event_date} onChange={(e) => setForm({ ...form, event_date: e.target.value })} />
            </label>
            <label className="cal-check">
              <input type="checkbox" checked={form.all_day} onChange={(e) => setForm({ ...form, all_day: e.target.checked })} />
              All day / Full Day
            </label>
            {form.all_day ? null : (
              <div className="cal-when">
                <label>
                  Start
                  <input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
                </label>
                <label>
                  End
                  <input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
                </label>
              </div>
            )}
            <label>
              Audience
              <input value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} placeholder="All Employees" />
            </label>
            <label>
              Description
              <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
            <footer>
              {form.id ? (
                <button
                  type="button"
                  className="emp-btn"
                  disabled={busy}
                  onClick={() => void run(() => api.updatePeopleCalendarEvent(form.id as string, 'Cancelled'), 'Event cancelled')}
                >
                  Cancel Event
                </button>
              ) : null}
              <button type="button" className="emp-btn" onClick={() => setAddOpen(false)}>
                Close
              </button>
              <button type="button" className="emp-btn primary" disabled={busy || !form.title.trim()} onClick={() => void saveEvent()}>
                Save Event
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
