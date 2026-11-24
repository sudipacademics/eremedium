import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import './lab-tech-v2.css';
import './labtech-settings.css';

type Tab = 'pad' | 'whatsapp' | 'signatures';

type PadImage = { field: string; label: string; url: string };
type Pathologist = {
  employee: string;
  name: string;
  user?: string;
  designation?: string;
  department?: string;
  photo?: string;
  signature_url?: string;
};
type DeptDefault = {
  key: string;
  label: string;
  role?: string;
  name: string;
  qualification: string;
  signature_url?: string;
};

type LabtechSettings = {
  can_manage: boolean;
  reporting_pad: {
    identity: Record<string, string | number>;
    images: Record<string, PadImage>;
    source?: string;
  };
  whatsapp: {
    ready: boolean;
    provider: string;
    phone_number_id: string;
    sender_number: string;
    token_configured: boolean;
    hint: string;
    report_enabled: number;
    report_message: string;
  };
  department_defaults: DeptDefault[];
  pathologists: Pathologist[];
};

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

export function LabTechSettingsPage() {
  const [tab, setTab] = useState<Tab>('pad');
  const [data, setData] = useState<LabtechSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [identity, setIdentity] = useState<Record<string, string>>({});
  const [waEnabled, setWaEnabled] = useState(true);
  const [waMessage, setWaMessage] = useState('');
  const [deptDrafts, setDeptDrafts] = useState<Record<string, { name: string; qualification: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getLabtechSettings();
      const payload = res.data;
      setData(payload);
      const id = payload.reporting_pad?.identity || {};
      setIdentity({
        lab_name: String(id.lab_name || ''),
        lab_tagline: String(id.lab_tagline || ''),
        lab_address: String(id.lab_address || ''),
        lab_phone: String(id.lab_phone || ''),
        lab_website: String(id.lab_website || ''),
        nabl_accreditation: String(id.nabl_accreditation || ''),
        nabl_certificate_no: String(id.nabl_certificate_no || ''),
        report_footer: String(id.report_footer || ''),
        report_primary_color: String(id.report_primary_color || '#0b5cab'),
        show_authorized_badge: String(id.show_authorized_badge ?? 1),
      });
      setWaEnabled(!!Number(payload.whatsapp?.report_enabled ?? 1));
      setWaMessage(payload.whatsapp?.report_message || '');
      const drafts: Record<string, { name: string; qualification: string }> = {};
      for (const d of payload.department_defaults || []) {
        drafts[d.key] = { name: d.name || '', qualification: d.qualification || '' };
      }
      setDeptDrafts(drafts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const canManage = !!data?.can_manage;

  async function savePad(e: FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.saveLabtechReportingPad({
        identity: {
          ...identity,
          show_authorized_badge: Number(identity.show_authorized_badge) ? 1 : 0,
        },
      });
      setData(res.data);
      setNotice(res.message || 'Reporting pad saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save reporting pad');
    } finally {
      setBusy(false);
    }
  }

  async function uploadPadImage(field: string, file: File | undefined) {
    if (!file || !canManage) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const res = await api.saveLabtechReportingPad({
        images: { [field]: { file_name: file.name, file_data: dataUrl } },
      });
      setData(res.data);
      setNotice('Pad image updated');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload image');
    } finally {
      setBusy(false);
    }
  }

  async function saveWhatsApp(e: FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.saveLabtechWhatsapp({
        report_enabled: waEnabled ? 1 : 0,
        report_message: waMessage,
      });
      setData(res.data);
      setNotice(res.message || 'WhatsApp settings saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save WhatsApp settings');
    } finally {
      setBusy(false);
    }
  }

  async function uploadPathologistSig(employee: string, file: File | undefined) {
    if (!file || !canManage) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const res = await api.savePathologistSignature({
        employee,
        file_name: file.name,
        file_data: dataUrl,
      });
      setData(res.data);
      setNotice('Pathologist signature uploaded');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload signature');
    } finally {
      setBusy(false);
    }
  }

  async function clearPathologistSig(employee: string) {
    if (!canManage) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.savePathologistSignature({ employee, clear: 1 });
      setData(res.data);
      setNotice('Signature removed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not clear signature');
    } finally {
      setBusy(false);
    }
  }

  async function saveDept(key: string, file?: File, clearImage?: boolean) {
    if (!canManage) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const draft = deptDrafts[key] || { name: '', qualification: '' };
      const body: {
        department_key: string;
        name: string;
        qualification: string;
        file_name?: string;
        file_data?: string;
        clear_image?: number;
      } = {
        department_key: key,
        name: draft.name,
        qualification: draft.qualification,
      };
      if (clearImage) body.clear_image = 1;
      if (file) {
        body.file_name = file.name;
        body.file_data = await readFileAsDataUrl(file);
      }
      const res = await api.saveDepartmentSignatureDefault(body);
      setData(res.data);
      setNotice('Department signature saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save department signature');
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="lt-page lts-page">
        <p className="muted">Loading settings…</p>
      </div>
    );
  }

  const images = Object.values(data?.reporting_pad?.images || {});

  return (
    <div className="lt-page lts-page">
      <header className="lts-head">
        <div>
          <h1>Lab settings</h1>
          <p>Reporting pad, WhatsApp report delivery, and pathologist signatures.</p>
        </div>
        {!canManage ? <span className="lts-badge">View only — Lab Manager can edit</span> : null}
      </header>

      {error ? <div className="people-alert err">{error}</div> : null}
      {notice ? <div className="people-alert ok">{notice}</div> : null}

      <nav className="lts-tabs" aria-label="Settings sections">
        {(
          [
            ['pad', 'Reporting Page'],
            ['whatsapp', 'WhatsApp'],
            ['signatures', 'Pathologist signatures'],
          ] as Array<[Tab, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? 'on' : ''}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'pad' ? (
        <div className="lts-grid">
          <form className="lts-card" onSubmit={(e) => void savePad(e)}>
            <h2>Lab identity on reports</h2>
            <p className="muted">Shown with digital letterhead when the report is not printed on pre-printed pads.</p>
            <div className="lts-fields">
              {(
                [
                  ['lab_name', 'Lab / brand name'],
                  ['lab_tagline', 'Tagline'],
                  ['lab_phone', 'Phone'],
                  ['lab_website', 'Website'],
                  ['nabl_certificate_no', 'NABL certificate no.'],
                  ['report_primary_color', 'Accent colour'],
                ] as Array<[string, string]>
              ).map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    value={identity[key] || ''}
                    onChange={(e) => setIdentity((cur) => ({ ...cur, [key]: e.target.value }))}
                    disabled={!canManage || busy}
                  />
                </label>
              ))}
              <label className="span-2">
                Lab address
                <textarea
                  rows={2}
                  value={identity.lab_address || ''}
                  onChange={(e) => setIdentity((cur) => ({ ...cur, lab_address: e.target.value }))}
                  disabled={!canManage || busy}
                />
              </label>
              <label className="span-2">
                Accreditation line
                <input
                  value={identity.nabl_accreditation || ''}
                  onChange={(e) => setIdentity((cur) => ({ ...cur, nabl_accreditation: e.target.value }))}
                  disabled={!canManage || busy}
                />
              </label>
              <label className="span-2">
                Footer disclaimer
                <textarea
                  rows={2}
                  value={identity.report_footer || ''}
                  onChange={(e) => setIdentity((cur) => ({ ...cur, report_footer: e.target.value }))}
                  disabled={!canManage || busy}
                />
              </label>
              <label className="lts-check">
                <input
                  type="checkbox"
                  checked={!!Number(identity.show_authorized_badge)}
                  onChange={(e) =>
                    setIdentity((cur) => ({ ...cur, show_authorized_badge: e.target.checked ? '1' : '0' }))
                  }
                  disabled={!canManage || busy}
                />
                Show AUTHORIZED badge on reported PDFs
              </label>
            </div>
            {canManage ? (
              <button type="submit" className="emp-btn primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save identity'}
              </button>
            ) : null}
          </form>

          <section className="lts-card">
            <h2>Reporting pad artwork</h2>
            <p className="muted">
              Upload full-width header/footer strips used for NABL and Non-NABL PDFs. For pre-printed pads, staff can still
              choose headerless print in Result entry.
            </p>
            <div className="lts-pads">
              {images.map((img) => (
                <article key={img.field} className="lts-pad">
                  <header>
                    <b>{img.label}</b>
                    <small>{img.field}</small>
                  </header>
                  <div className="lts-pad-preview">
                    {img.url ? <img src={img.url} alt={img.label} /> : <span>No image uploaded</span>}
                  </div>
                  {canManage ? (
                    <label className="lts-file">
                      Replace image
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        disabled={busy}
                        onChange={(e) => void uploadPadImage(img.field, e.target.files?.[0])}
                      />
                    </label>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {tab === 'whatsapp' ? (
        <form className="lts-card lts-wa" onSubmit={(e) => void saveWhatsApp(e)}>
          <h2>WhatsApp report delivery</h2>
          <p className="muted">
            When a report is authorised, staff can send the patient a secure Patient Portal link over WhatsApp.
          </p>
          <div className={`lts-status ${data?.whatsapp?.ready ? 'ok' : 'warn'}`}>
            <b>{data?.whatsapp?.ready ? 'Connected' : 'Not ready'}</b>
            <span>{data?.whatsapp?.hint}</span>
            <small>
              Provider: {data?.whatsapp?.provider || '—'} · Phone ID:{' '}
              {data?.whatsapp?.phone_number_id || '—'} · Sender: {data?.whatsapp?.sender_number || '—'} · Token:{' '}
              {data?.whatsapp?.token_configured ? 'set' : 'missing'}
            </small>
          </div>
          <label className="lts-check">
            <input
              type="checkbox"
              checked={waEnabled}
              onChange={(e) => setWaEnabled(e.target.checked)}
              disabled={!canManage || busy}
            />
            Show WhatsApp share on authorised reports
          </label>
          <label>
            Message template
            <textarea
              rows={4}
              value={waMessage}
              onChange={(e) => setWaMessage(e.target.value)}
              disabled={!canManage || busy}
              placeholder="Hello {patient_name}, your report is ready…"
            />
            <small className="muted">Placeholders: {'{patient_name}'}, {'{report_id}'}</small>
          </label>
          {canManage ? (
            <button type="submit" className="emp-btn primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save WhatsApp settings'}
            </button>
          ) : null}
        </form>
      ) : null}

      {tab === 'signatures' ? (
        <section className="lts-card">
          <h2>Pathologist signatures</h2>
          <p className="muted">Upload a signature for each report footer box. These appear above the blue line on authorised reports.</p>
          <div className="lts-depts">
            {(data?.department_defaults || []).map((d) => (
              <article key={d.key} className="lts-dept">
                <header>
                  <b>{d.role || d.label}</b>
                  <small>{(d.label || '').toUpperCase()}</small>
                </header>
                <label>
                  Signatory name
                  <input
                    value={deptDrafts[d.key]?.name || ''}
                    onChange={(e) =>
                      setDeptDrafts((cur) => ({
                        ...cur,
                        [d.key]: { ...(cur[d.key] || { name: '', qualification: '' }), name: e.target.value },
                      }))
                    }
                    disabled={!canManage || busy}
                  />
                </label>
                <label>
                  Qualification
                  <input
                    value={deptDrafts[d.key]?.qualification || ''}
                    onChange={(e) =>
                      setDeptDrafts((cur) => ({
                        ...cur,
                        [d.key]: { ...(cur[d.key] || { name: '', qualification: '' }), qualification: e.target.value },
                      }))
                    }
                    disabled={!canManage || busy}
                  />
                </label>
                <div className="lts-sig-preview report-box">
                  {d.signature_url ? <img src={d.signature_url} alt="" /> : <span>No signature</span>}
                  <div className="lts-sig-line" />
                </div>
                {canManage ? (
                  <div className="lts-sig-actions">
                    <button type="button" className="emp-btn primary" disabled={busy} onClick={() => void saveDept(d.key)}>
                      Save details
                    </button>
                    <label className="lts-file">
                      Upload
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        disabled={busy}
                        onChange={(e) => void saveDept(d.key, e.target.files?.[0])}
                      />
                    </label>
                    {d.signature_url ? (
                      <button type="button" className="emp-btn outline" disabled={busy} onClick={() => void saveDept(d.key, undefined, true)}>
                        Remove
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
