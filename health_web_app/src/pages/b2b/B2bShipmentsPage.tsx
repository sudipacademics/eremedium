import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, type PartnerShipment, type PartnerShipmentsPayload } from '../../api';
import { PartnersPageHeader } from '../../components/B2bLayout';
import './partner-earnings.css';

function when(raw?: string | null) {
  if (!raw) return '—';
  const d = new Date(String(raw).replace(' ', 'T'));
  return Number.isNaN(d.getTime())
    ? String(raw)
    : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
}

function statusPill(status: string) {
  const tone = status === 'Delivered' ? 'ok' : status === 'Shipped' ? 'warn' : 'muted';
  return <span className={`pe-pill pe-${tone}`}>{status === 'Delivered' ? 'Received at lab' : status}</span>;
}

function ShipmentTable({
  rows,
  incoming,
  busy,
  onReceive,
}: {
  rows: PartnerShipment[];
  incoming?: boolean;
  busy?: string | null;
  onReceive?: (id: string) => void;
}) {
  return (
    <div className="partners-table-card">
      <table>
        <thead>
          <tr>
            <th>Shipment</th>
            <th>{incoming ? 'From' : 'To lab'}</th>
            <th>Samples</th>
            <th>LR / Docket</th>
            <th>Courier</th>
            <th>Icebox °C</th>
            <th>Shipped</th>
            <th>Status</th>
            {incoming ? <th /> : null}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((s) => (
              <tr key={s.id}>
                <td title={s.samples.map((x) => x.trf).join(', ')}>{s.id}</td>
                <td>{incoming ? s.shipper_name || s.shipper : s.to_lab_name || s.to_lab || '—'}</td>
                <td>{s.sample_count}</td>
                <td>{s.lr_number || '—'}</td>
                <td>{s.courier || '—'}</td>
                <td>{s.icebox_temp_c ?? '—'}</td>
                <td>{when(s.shipped_on)}</td>
                <td>
                  {statusPill(s.status)}
                  {s.delivered_on ? <div className="pe-muted">{when(s.delivered_on)}</div> : null}
                </td>
                {incoming ? (
                  <td>
                    {s.status === 'Shipped' ? (
                      <button
                        type="button"
                        className="partners-btn partners-btn-primary"
                        disabled={busy === s.id}
                        onClick={() => onReceive?.(s.id)}
                      >
                        {busy === s.id ? 'Saving…' : 'Mark received'}
                      </button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={incoming ? 9 : 8}>No shipments yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function B2bShipmentsPage() {
  const [data, setData] = useState<PartnerShipmentsPayload | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [lr, setLr] = useState('');
  const [courier, setCourier] = useState('');
  const [temp, setTemp] = useState('');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api.getPartnerShipments();
    setData(res.data);
    setPicked([]);
  }, []);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load shipments'));
  }, [load]);

  const circuit = data?.circuit;
  const selfLab = circuit?.tier === 'Orange FOCO' || Boolean(circuit?.has_lab);
  const pending = data?.pending || [];
  const allPicked = pending.length > 0 && picked.length === pending.length;

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!picked.length) {
      setError('Select at least one sample.');
      return;
    }
    setBusy('create');
    setError(null);
    setNotice(null);
    try {
      const res = await api.createPartnerShipment({
        trfs: picked,
        lr_number: lr,
        courier,
        icebox_temp_c: temp,
        remarks,
      });
      setNotice(
        selfLab
          ? `Accession recorded for ${res.data.shipment.sample_count} sample(s).`
          : `Shipment ${res.data.shipment.id} recorded with ${res.data.shipment.sample_count} sample(s). The Master FOCO share credits when the lab marks it received.`,
      );
      setLr('');
      setCourier('');
      setTemp('');
      setRemarks('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the shipment');
    } finally {
      setBusy(null);
    }
  }

  async function onReceive(id: string) {
    setBusy(id);
    setError(null);
    setNotice(null);
    try {
      const res = await api.receivePartnerShipment(id);
      setNotice(`Shipment ${id} received at lab.${res.data.mf_credits_posted ? ' Master FOCO share credited.' : ''}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not confirm the shipment');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PartnersPageHeader
        title="B2B Accession & Shipment"
        lead={
          <>
            Accession samples billed by the FOCOs in your circuit and record the icebox shipment to the lab. This is a
            record only — no new charge. The Master FOCO share credits once the receiving lab marks the shipment
            received.
          </>
        }
      />

      {error ? <div className="partners-alert error">{error}</div> : null}
      {notice ? <div className="partners-alert">{notice}</div> : null}

      {data && !data.can_ship && !data.incoming.length ? (
        <div className="partners-table-card pe-circuit">
          <p className="pe-muted pe-circuit-note">
            Accession and shipment are for Master FOCO and Orange FOCO / lab partners.
            {circuit?.tier ? ` This hub is a ${circuit.tier}.` : ' This hub is not on the partner circuit yet.'}
          </p>
        </div>
      ) : null}

      {data?.can_ship ? (
        <form className="partners-table-card pe-circuit" onSubmit={(e) => void onCreate(e)}>
          <h2 className="pe-section-title">{selfLab ? 'Samples to accession' : 'Samples to accession & ship'}</h2>
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select all samples"
                    checked={allPicked}
                    onChange={() => setPicked(allPicked ? [] : pending.map((p) => p.trf))}
                  />
                </th>
                <th>Bill / TRF</th>
                <th>Patient</th>
                <th>Tests</th>
                <th>Billed by</th>
                <th>Billed on</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {pending.length ? (
                pending.map((p) => (
                  <tr key={p.trf}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${p.trf}`}
                        checked={picked.includes(p.trf)}
                        onChange={() =>
                          setPicked((cur) => (cur.includes(p.trf) ? cur.filter((x) => x !== p.trf) : [...cur, p.trf]))
                        }
                      />
                    </td>
                    <td>{p.trf}</td>
                    <td>{p.patient_name || '—'}</td>
                    <td>{p.tests || '—'}</td>
                    <td>
                      {p.billed_by_name || p.billed_by || '—'}
                      {p.via_vector ? <div className="pe-muted">via Vector {p.via_vector_name || p.via_vector}</div> : null}
                    </td>
                    <td>{when(p.created)}</td>
                    <td>{p.order_status || '—'}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7}>No samples awaiting accession.</td>
                </tr>
              )}
            </tbody>
          </table>

          {pending.length ? (
            <div className="pe-ship-form">
              {!selfLab ? (
                <>
                  <label className="partners-field">
                    <span>LR / Docket No.</span>
                    <span className="partners-input-wrap">
                      <input value={lr} onChange={(e) => setLr(e.target.value)} placeholder="e.g. LR-10422" />
                    </span>
                  </label>
                  <label className="partners-field">
                    <span>Courier / Logistics</span>
                    <span className="partners-input-wrap">
                      <input value={courier} onChange={(e) => setCourier(e.target.value)} placeholder="Runner / courier name" />
                    </span>
                  </label>
                </>
              ) : null}
              <label className="partners-field">
                <span>Icebox temp (°C)</span>
                <span className="partners-input-wrap">
                  <input type="number" step="0.1" value={temp} onChange={(e) => setTemp(e.target.value)} placeholder="2 – 8" />
                </span>
              </label>
              <label className="partners-field">
                <span>Remarks</span>
                <span className="partners-input-wrap">
                  <input value={remarks} onChange={(e) => setRemarks(e.target.value)} />
                </span>
              </label>
              <button type="submit" className="partners-btn partners-btn-primary" disabled={busy === 'create' || !picked.length}>
                {busy === 'create'
                  ? 'Saving…'
                  : selfLab
                    ? `Record accession (${picked.length})`
                    : `Accession & ship (${picked.length})`}
              </button>
            </div>
          ) : null}
        </form>
      ) : null}

      {data?.outgoing.length ? (
        <>
          <h2 className="pe-section-title">Outgoing shipments</h2>
          <ShipmentTable rows={data.outgoing} />
        </>
      ) : null}

      {data?.incoming.length ? (
        <>
          <h2 className="pe-section-title">Incoming shipments to your lab</h2>
          <ShipmentTable rows={data.incoming} incoming busy={busy} onReceive={(id) => void onReceive(id)} />
        </>
      ) : null}
    </>
  );
}
