import { FormEvent, useEffect, useState } from 'react';
import { api, AgencyLevel } from '../../api';
import './agents-portal.css';

export function AgentsLevelsPage() {
  const [levels, setLevels] = useState<AgencyLevel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  async function load() {
    const res = await api.getAgencyLevels();
    setLevels(res.data.levels || []);
  }

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load levels'));
  }, []);

  async function onSave(event: FormEvent, level: AgencyLevel) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const fd = new FormData(form);
    setSaving(level.code);
    setMessage(null);
    setError(null);
    try {
      await api.saveAgencyLevel({
        level_code: level.code,
        conversion_pct: Number(fd.get('conversion_pct')),
        monthly_revenue_pct: Number(fd.get('monthly_revenue_pct')),
        override_pct: Number(fd.get('override_pct')),
        active: fd.get('active') === 'on' ? 1 : 0,
      });
      setMessage(`Updated ${level.code}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(null);
    }
  }

  if (error && !levels.length) return <div className="error">{error}</div>;

  return (
    <>
      <h1>Commission levels</h1>
      <p className="muted">Descending pyramid rates — editable by Agency Managers without code changes.</p>
      {message ? <p className="muted">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {levels.map((level) => (
        <section className="agents-panel" key={level.name}>
          <h2>
            Rank {level.rank} · {level.code} — {level.title}
          </h2>
          <form className="agents-form-grid" onSubmit={(e) => void onSave(e, level)}>
            <label>
              Conversion %
              <input name="conversion_pct" type="number" step="0.01" defaultValue={level.conversion_pct} required />
            </label>
            <label>
              Monthly revenue %
              <input
                name="monthly_revenue_pct"
                type="number"
                step="0.01"
                defaultValue={level.monthly_revenue_pct}
                required
              />
            </label>
            <label>
              Override %
              <input name="override_pct" type="number" step="0.01" defaultValue={level.override_pct} required />
            </label>
            <label>
              Active
              <input name="active" type="checkbox" defaultChecked={Boolean(level.active)} />
            </label>
            <button className="btn" type="submit" disabled={saving === level.code}>
              {saving === level.code ? 'Saving…' : 'Save'}
            </button>
          </form>
        </section>
      ))}
    </>
  );
}
