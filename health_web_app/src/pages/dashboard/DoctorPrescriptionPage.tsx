import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  api,
  ClinicalPrescription,
  PrescriptionDiagnosticLine,
  PrescriptionDiagnosticOption,
  PrescriptionMedicineLine,
  PrescriptionMedicineOption,
} from '../../api';

type AppointmentContext = {
  appointment_id: string;
  patient_name?: string;
  appointment_date?: string;
  appointment_time?: string;
  consultation_mode?: string;
  status?: string;
};

const FREQUENCY_OPTIONS = [
  'Once daily',
  'Twice daily',
  'Three times daily',
  'At bedtime',
  'Before meals',
  'After meals',
  'As needed (SOS)',
  'Every 6 hours',
  'Every 8 hours',
  'Every 12 hours',
];

function emptyMedicineLine(): PrescriptionMedicineLine {
  return { medicine_item: '', dosage: '', frequency: '', duration: '', instructions: '' };
}

function emptyDiagnosticLine(): PrescriptionDiagnosticLine {
  return { diagnostic_test: '', notes: '' };
}

export function DoctorPrescriptionPage() {
  const { appointmentId } = useParams<{ appointmentId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const aptFromState = (location.state as { appointment?: AppointmentContext } | null)?.appointment;

  const [context, setContext] = useState<AppointmentContext | null>(aptFromState || null);
  const [existing, setExisting] = useState<ClinicalPrescription[]>([]);
  const [diagnosis, setDiagnosis] = useState('');
  const [clinicalNotes, setClinicalNotes] = useState('');
  const [medicines, setMedicines] = useState<PrescriptionMedicineLine[]>([emptyMedicineLine()]);
  const [diagnostics, setDiagnostics] = useState<PrescriptionDiagnosticLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [medQuery, setMedQuery] = useState<Record<number, string>>({});
  const [medOptions, setMedOptions] = useState<Record<number, PrescriptionMedicineOption[]>>({});
  const [diagQuery, setDiagQuery] = useState<Record<number, string>>({});
  const [diagOptions, setDiagOptions] = useState<Record<number, PrescriptionDiagnosticOption[]>>({});

  const load = useCallback(async () => {
    if (!appointmentId) return;
    const rxRes = await api.getAppointmentPrescriptions(appointmentId);
    setExisting(rxRes.data.prescriptions || []);
  }, [appointmentId]);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load appointment'));
  }, [load]);

  useEffect(() => {
    if (context || !appointmentId) return;
    void api
      .getMyProviderPortal()
      .then((portalRes) => {
        const apt = portalRes.data.upcoming_appointments?.find((a) => a.appointment_id === appointmentId);
        if (apt) setContext(apt);
      })
      .catch(() => undefined);
  }, [appointmentId, context]);

  const header = useMemo(() => {
    if (!context) return appointmentId || 'Consultation';
    const parts = [context.patient_name || 'Patient'];
    if (context.appointment_date) parts.push(context.appointment_date);
    if (context.appointment_time) parts.push(context.appointment_time.slice(0, 5));
    return parts.join(' · ');
  }, [appointmentId, context]);

  async function searchMedicines(index: number, q: string) {
    setMedQuery((prev) => ({ ...prev, [index]: q }));
    if (q.trim().length < 2) {
      setMedOptions((prev) => ({ ...prev, [index]: [] }));
      return;
    }
    try {
      const res = await api.searchPrescriptionMedicines(q.trim(), 15);
      setMedOptions((prev) => ({ ...prev, [index]: res.data.medicines || [] }));
    } catch {
      setMedOptions((prev) => ({ ...prev, [index]: [] }));
    }
  }

  async function searchDiagnostics(index: number, q: string) {
    setDiagQuery((prev) => ({ ...prev, [index]: q }));
    if (q.trim().length < 2) {
      setDiagOptions((prev) => ({ ...prev, [index]: [] }));
      return;
    }
    try {
      const res = await api.searchPrescriptionDiagnostics(q.trim(), 15);
      setDiagOptions((prev) => ({ ...prev, [index]: res.data.diagnostics || [] }));
    } catch {
      setDiagOptions((prev) => ({ ...prev, [index]: [] }));
    }
  }

  function pickMedicine(index: number, option: PrescriptionMedicineOption) {
    setMedicines((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        medicine_item: option.name,
        item_name: option.item_name || option.name,
      };
      return next;
    });
    setMedOptions((prev) => ({ ...prev, [index]: [] }));
    setMedQuery((prev) => ({ ...prev, [index]: option.item_name || option.name }));
  }

  function pickDiagnostic(index: number, option: PrescriptionDiagnosticOption) {
    setDiagnostics((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        diagnostic_test: option.name,
        test_name: option.test_name || option.name,
        item: option.item,
        item_name: option.item_name,
      };
      return next;
    });
    setDiagOptions((prev) => ({ ...prev, [index]: [] }));
    setDiagQuery((prev) => ({ ...prev, [index]: option.test_name || option.name }));
  }

  async function printPrescription(prescriptionId: string) {
    setError(null);
    try {
      const html = await api.getPrescriptionPrintHtml(prescriptionId);
      const win = window.open('', '_blank');
      if (win) {
        win.document.write(html);
        win.document.close();
      } else {
        setError('Popup blocked — allow popups to print the prescription.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open print view');
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!appointmentId) return;
    const cleanMeds = medicines.filter((m) => m.medicine_item?.trim());
    const cleanDiag = diagnostics.filter((d) => d.diagnostic_test?.trim() || d.item?.trim());
    if (!cleanMeds.length && !cleanDiag.length) {
      setError('Add at least one medicine or lab test.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.providerIssuePrescription({
        appointment_id: appointmentId,
        diagnosis: diagnosis.trim() || undefined,
        clinical_notes: clinicalNotes.trim() || undefined,
        medicines: cleanMeds,
        diagnostics: cleanDiag,
        submit: true,
      });
      setNotice(`Prescription ${res.data.prescription.name} issued.`);
      setDiagnosis('');
      setClinicalNotes('');
      setMedicines([emptyMedicineLine()]);
      setDiagnostics([]);
      setMedQuery({});
      setDiagQuery({});
      await load();
      await printPrescription(res.data.prescription.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not issue prescription');
    } finally {
      setBusy(false);
    }
  }

  if (!appointmentId) {
    return (
      <div className="card">
        <p className="error">Missing appointment.</p>
        <Link to="/dashboard/provider">Back to provider portal</Link>
      </div>
    );
  }

  return (
    <>
      <section className="hero hero-compact">
        <h1>E-prescription</h1>
        <p className="muted">{header}</p>
        {context?.consultation_mode ? (
          <p className="muted">
            {context.consultation_mode}
            {context.status ? ` · ${context.status}` : ''}
          </p>
        ) : null}
      </section>

      {error ? <div className="error">{error}</div> : null}
      {notice ? <div className="success">{notice}</div> : null}

      {existing.length ? (
        <div className="card" style={{ marginBottom: 20 }}>
          <h2>Prescriptions for this visit</h2>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Rx</th>
                  <th>Date</th>
                  <th>Diagnosis</th>
                  <th>Meds</th>
                  <th>Tests</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {existing.map((rx) => (
                  <tr key={rx.name}>
                    <td>{rx.name}</td>
                    <td>{rx.encounter_date || '—'}</td>
                    <td>{rx.diagnosis || '—'}</td>
                    <td>{rx.medicine_count ?? 0}</td>
                    <td>{rx.diagnostic_count ?? 0}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" className="btn btn-sm" onClick={() => void printPrescription(rx.name)}>
                        Print
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <form className="card" onSubmit={(e) => void submit(e)}>
        <h2>Write prescription</h2>

        <div style={{ display: 'grid', gap: 12, maxWidth: 720, marginBottom: 20 }}>
          <label>
            Diagnosis
            <input
              value={diagnosis}
              onChange={(e) => setDiagnosis(e.target.value)}
              placeholder="e.g. Acute upper respiratory infection"
            />
          </label>
          <label>
            Clinical notes
            <textarea
              rows={3}
              value={clinicalNotes}
              onChange={(e) => setClinicalNotes(e.target.value)}
              placeholder="Examination findings, advice, follow-up…"
            />
          </label>
        </div>

        <h3>Medicines</h3>
        <div style={{ display: 'grid', gap: 12, marginBottom: 20 }}>
          {medicines.map((line, index) => (
            <div key={index} className="card" style={{ padding: 12, background: '#f8fafc' }}>
              <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
                <label style={{ gridColumn: '1 / -1', position: 'relative' }}>
                  Medicine
                  <input
                    value={medQuery[index] ?? line.item_name ?? line.medicine_item ?? ''}
                    onChange={(e) => {
                      void searchMedicines(index, e.target.value);
                      setMedicines((prev) => {
                        const next = [...prev];
                        next[index] = { ...next[index], medicine_item: '', item_name: e.target.value };
                        return next;
                      });
                    }}
                    placeholder="Search pharmacy item…"
                    autoComplete="off"
                  />
                  {(medOptions[index] || []).length ? (
                    <ul
                      className="card"
                      style={{
                        position: 'absolute',
                        zIndex: 10,
                        left: 0,
                        right: 0,
                        margin: '4px 0 0',
                        padding: 0,
                        listStyle: 'none',
                        maxHeight: 180,
                        overflowY: 'auto',
                      }}
                    >
                      {medOptions[index].map((opt) => (
                        <li key={opt.name}>
                          <button
                            type="button"
                            className="btn btn-sm secondary"
                            style={{ width: '100%', textAlign: 'left', marginBottom: 4 }}
                            onClick={() => pickMedicine(index, opt)}
                          >
                            {opt.item_name || opt.name}
                            {opt.item_group ? <span className="muted"> · {opt.item_group}</span> : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </label>
                <label>
                  Dosage
                  <input
                    value={line.dosage || ''}
                    onChange={(e) =>
                      setMedicines((prev) => {
                        const next = [...prev];
                        next[index] = { ...next[index], dosage: e.target.value };
                        return next;
                      })
                    }
                    placeholder="1 tab"
                  />
                </label>
                <label>
                  Frequency
                  <select
                    value={line.frequency || ''}
                    onChange={(e) =>
                      setMedicines((prev) => {
                        const next = [...prev];
                        next[index] = { ...next[index], frequency: e.target.value };
                        return next;
                      })
                    }
                  >
                    <option value="">Select…</option>
                    {FREQUENCY_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Duration
                  <input
                    value={line.duration || ''}
                    onChange={(e) =>
                      setMedicines((prev) => {
                        const next = [...prev];
                        next[index] = { ...next[index], duration: e.target.value };
                        return next;
                      })
                    }
                    placeholder="5 days"
                  />
                </label>
                <label style={{ gridColumn: '1 / -1' }}>
                  Instructions
                  <input
                    value={line.instructions || ''}
                    onChange={(e) =>
                      setMedicines((prev) => {
                        const next = [...prev];
                        next[index] = { ...next[index], instructions: e.target.value };
                        return next;
                      })
                    }
                    placeholder="After food, avoid alcohol…"
                  />
                </label>
              </div>
              {medicines.length > 1 ? (
                <button
                  type="button"
                  className="btn btn-sm secondary"
                  style={{ marginTop: 8 }}
                  onClick={() => setMedicines((prev) => prev.filter((_, i) => i !== index))}
                >
                  Remove line
                </button>
              ) : null}
            </div>
          ))}
          <button
            type="button"
            className="btn secondary btn-sm"
            onClick={() => setMedicines((prev) => [...prev, emptyMedicineLine()])}
          >
            + Add medicine
          </button>
        </div>

        <h3>Lab tests / investigations</h3>
        <div style={{ display: 'grid', gap: 12, marginBottom: 20 }}>
          {diagnostics.length ? (
            diagnostics.map((line, index) => (
              <div key={index} className="card" style={{ padding: 12, background: '#f8fafc' }}>
                <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
                  <label style={{ gridColumn: '1 / -1', position: 'relative' }}>
                    Test
                    <input
                      value={diagQuery[index] ?? line.test_name ?? line.diagnostic_test ?? ''}
                      onChange={(e) => {
                        void searchDiagnostics(index, e.target.value);
                        setDiagnostics((prev) => {
                          const next = [...prev];
                          next[index] = { ...next[index], diagnostic_test: '', test_name: e.target.value };
                          return next;
                        });
                      }}
                      placeholder="Search diagnostic test…"
                      autoComplete="off"
                    />
                    {(diagOptions[index] || []).length ? (
                      <ul
                        className="card"
                        style={{
                          position: 'absolute',
                          zIndex: 10,
                          left: 0,
                          right: 0,
                          margin: '4px 0 0',
                          padding: 0,
                          listStyle: 'none',
                          maxHeight: 180,
                          overflowY: 'auto',
                        }}
                      >
                        {diagOptions[index].map((opt) => (
                          <li key={opt.name}>
                            <button
                              type="button"
                              className="btn btn-sm secondary"
                              style={{ width: '100%', textAlign: 'left', marginBottom: 4 }}
                              onClick={() => pickDiagnostic(index, opt)}
                            >
                              {opt.test_name || opt.name}
                              {opt.department ? <span className="muted"> · {opt.department}</span> : null}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </label>
                  <label style={{ gridColumn: '1 / -1' }}>
                    Notes
                    <input
                      value={line.notes || ''}
                      onChange={(e) =>
                        setDiagnostics((prev) => {
                          const next = [...prev];
                          next[index] = { ...next[index], notes: e.target.value };
                          return next;
                        })
                      }
                      placeholder="Fasting / urgency…"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="btn btn-sm secondary"
                  style={{ marginTop: 8 }}
                  onClick={() => setDiagnostics((prev) => prev.filter((_, i) => i !== index))}
                >
                  Remove test
                </button>
              </div>
            ))
          ) : (
            <p className="muted">Optional — prescribe lab tests from the diagnostic catalogue.</p>
          )}
          <button
            type="button"
            className="btn secondary btn-sm"
            onClick={() => setDiagnostics((prev) => [...prev, emptyDiagnosticLine()])}
          >
            + Add lab test
          </button>
        </div>

        <div className="toolbar">
          <button type="submit" className="btn" disabled={busy}>
            {busy ? 'Issuing…' : 'Issue prescription & print'}
          </button>
          <button type="button" className="btn secondary" onClick={() => navigate('/dashboard/provider')}>
            Back to appointments
          </button>
        </div>
      </form>
    </>
  );
}
