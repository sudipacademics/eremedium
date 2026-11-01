import { useEffect, useState } from 'react';
import { BRANCHES, SERVICES, UNITS, type UnitId } from '../data';
import { useOps } from '../store';
import { Modal } from './ui';

function todayValue() {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function formatWhen(value: string) {
  const [date, time] = value.split('T');
  const parsed = new Date(`${date}T${time || '09:00'}`);
  if (Number.isNaN(parsed.getTime())) return value;
  const day = parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const clock = parsed.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${day} · ${clock}`;
}

export function ActionModal() {
  const { modal, closeModal } = useOps();
  if (modal === 'booking') return <BookingForm onClose={closeModal} />;
  if (modal === 'requisition') return <RequisitionForm onClose={closeModal} />;
  if (modal === 'task') return <TaskForm onClose={closeModal} />;
  if (modal === 'issue') return <IssueForm onClose={closeModal} />;
  return null;
}

function BookingForm({ onClose }: { onClose: () => void }) {
  const { createBooking } = useOps();
  const [patient, setPatient] = useState('');
  const [mobile, setMobile] = useState('');
  const [unit, setUnit] = useState<UnitId>('lab');
  const [branch, setBranch] = useState(BRANCHES.find((item) => item.unit === 'lab')?.name ?? '');
  const [service, setService] = useState(SERVICES.lab[0]);
  const [when, setWhen] = useState(`${todayValue()}T10:00`);
  const [amount, setAmount] = useState('500');
  const [error, setError] = useState('');

  const branches = BRANCHES.filter((item) => item.unit === unit);

  useEffect(() => {
    setService(SERVICES[unit][0]);
    setBranch(BRANCHES.find((item) => item.unit === unit)?.name ?? '');
  }, [unit]);

  return (
    <Modal title="Create booking" onClose={onClose}>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = Number(amount);
          if (!patient.trim() || !branch || !service || !when || !Number.isFinite(parsed) || parsed <= 0) {
            setError('Add the patient, branch, service, time and a valid amount.');
            return;
          }
          createBooking({
            patient: patient.trim(),
            mobile: mobile.trim(),
            unit,
            branch,
            service,
            when: formatWhen(when),
            amount: Math.round(parsed),
          });
        }}
      >
        <label>
          Patient name
          <input value={patient} onChange={(event) => setPatient(event.target.value)} autoFocus required />
        </label>
        <label>
          Mobile
          <input value={mobile} onChange={(event) => setMobile(event.target.value)} inputMode="tel" placeholder="Optional" />
        </label>
        <div className="split-fields">
          <label>
            Unit
            <select value={unit} onChange={(event) => setUnit(event.target.value as UnitId)}>
              {UNITS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Branch
            <select value={branch} onChange={(event) => setBranch(event.target.value)}>
              {branches.map((item) => (
                <option key={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Service
          <select value={service} onChange={(event) => setService(event.target.value)}>
            {SERVICES[unit].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <div className="split-fields">
          <label>
            When
            <input type="datetime-local" value={when} onChange={(event) => setWhen(event.target.value)} required />
          </label>
          <label>
            Amount (₹)
            <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" required />
          </label>
        </div>
        {error ? <p className="error">{error}</p> : null}
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Create booking
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RequisitionForm({ onClose }: { onClose: () => void }) {
  const { createRequisition, draft } = useOps();
  const [item, setItem] = useState(draft?.item ?? '');
  const [unit, setUnit] = useState<UnitId>(draft?.unit ?? 'pharmacy');
  const [branch, setBranch] = useState(draft?.branch ?? 'Ashoknagar Pharmacy');
  const [qty, setQty] = useState('20');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const branches = BRANCHES.filter((entry) => entry.unit === unit);

  useEffect(() => {
    setBranch((current) => {
      const matches = BRANCHES.filter((entry) => entry.unit === unit);
      if (matches.some((entry) => entry.name === current)) return current;
      return matches[0]?.name ?? '';
    });
  }, [unit]);

  return (
    <Modal title="Raise requisition" onClose={onClose}>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = Number(qty);
          if (!item.trim() || !branch || !Number.isFinite(parsed) || parsed <= 0) {
            setError('Add the item, branch and a quantity.');
            return;
          }
          createRequisition({ item: item.trim(), unit, branch, qty: Math.round(parsed), note: note.trim() });
        }}
      >
        <label>
          Item
          <input value={item} onChange={(event) => setItem(event.target.value)} autoFocus required />
        </label>
        <div className="split-fields">
          <label>
            Unit
            <select value={unit} onChange={(event) => setUnit(event.target.value as UnitId)}>
              {UNITS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Branch
            <select value={branch} onChange={(event) => setBranch(event.target.value)}>
              {branches.map((entry) => (
                <option key={entry.id}>{entry.name}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Quantity
          <input value={qty} onChange={(event) => setQty(event.target.value)} inputMode="numeric" required />
        </label>
        <label>
          Note
          <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} placeholder="Why this is needed" />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Send for approval
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TaskForm({ onClose }: { onClose: () => void }) {
  const { createTask } = useOps();
  const [title, setTitle] = useState('');
  const [unit, setUnit] = useState<UnitId>('lab');
  const [priority, setPriority] = useState<'High' | 'Medium' | 'Low'>('Medium');
  const [due, setDue] = useState('Today, 06:00 PM');
  const [error, setError] = useState('');

  return (
    <Modal title="Assign task" onClose={onClose}>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!title.trim() || !due.trim()) {
            setError('Add a title and a due time.');
            return;
          }
          const unitName = UNITS.find((entry) => entry.id === unit)?.short ?? 'Operations';
          createTask({ title: title.trim(), detail: `${unitName} · Due: ${due.trim()}`, priority });
        }}
      >
        <label>
          Task
          <input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus required />
        </label>
        <div className="split-fields">
          <label>
            Unit
            <select value={unit} onChange={(event) => setUnit(event.target.value as UnitId)}>
              {UNITS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select value={priority} onChange={(event) => setPriority(event.target.value as 'High' | 'Medium' | 'Low')}>
              <option>High</option>
              <option>Medium</option>
              <option>Low</option>
            </select>
          </label>
        </div>
        <label>
          Due
          <input value={due} onChange={(event) => setDue(event.target.value)} required />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Assign task
          </button>
        </div>
      </form>
    </Modal>
  );
}

function IssueForm({ onClose }: { onClose: () => void }) {
  const { logIssue } = useOps();
  const [title, setTitle] = useState('');
  const [unit, setUnit] = useState<UnitId>('lab');
  const [severity, setSeverity] = useState<'High' | 'Medium' | 'Low'>('Medium');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  return (
    <Modal title="Log issue" onClose={onClose}>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!title.trim()) {
            setError('Describe the issue.');
            return;
          }
          logIssue({ title: title.trim(), unit, severity, note: note.trim() });
        }}
      >
        <label>
          Issue
          <input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus required />
        </label>
        <div className="split-fields">
          <label>
            Unit
            <select value={unit} onChange={(event) => setUnit(event.target.value as UnitId)}>
              {UNITS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Severity
            <select value={severity} onChange={(event) => setSeverity(event.target.value as 'High' | 'Medium' | 'Low')}>
              <option>High</option>
              <option>Medium</option>
              <option>Low</option>
            </select>
          </label>
        </div>
        <label>
          Note
          <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Log issue
          </button>
        </div>
      </form>
    </Modal>
  );
}
