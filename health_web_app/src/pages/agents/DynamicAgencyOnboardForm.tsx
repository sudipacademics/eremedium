import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, AgencyOnboardFormField, AgencyOnboardFormSchema } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { isAgencyStaff } from '../../auth/roles';
import './agents-portal.css';

type Props = {
  formKey: string;
  className?: string;
  onSubmitted?: (result: { submission_id: string; linked_request?: string | null; message?: string }) => void;
};

function fieldInputType(ft: string) {
  if (ft === 'Email') return 'email';
  if (ft === 'Phone') return 'tel';
  if (ft === 'Number') return 'number';
  return 'text';
}

export function DynamicAgencyOnboardForm({ formKey, className, onSubmitted }: Props) {
  const { user, isAuthenticated } = useAuth();
  const [schema, setSchema] = useState<AgencyOnboardFormSchema | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    void api
      .getAgencyOnboardForm(formKey)
      .then((res) => {
        setSchema(res.data.form);
        const initial: Record<string, string> = {};
        for (const f of res.data.form.fields || []) {
          if (f.fieldtype === 'Check') initial[f.field_key] = '0';
          else if (f.field_key === 'deal_value') initial[f.field_key] = '100000';
          else initial[f.field_key] = '';
        }
        setValues(initial);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load form'))
      .finally(() => setLoading(false));
  }, [formKey]);

  const needsLogin = useMemo(() => {
    if (!schema) return false;
    return Boolean(schema.require_login) && !isAuthenticated;
  }, [schema, isAuthenticated]);

  function setField(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!schema) return;
    if (needsLogin) {
      setError('Please sign in to submit this form.');
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.submitAgencyOnboardForm(formKey, values);
      setMessage(res.data.message || schema.success_message || 'Submitted.');
      onSubmitted?.(res.data);
      // Reset non-sticky fields
      const reset: Record<string, string> = {};
      for (const f of schema.fields) {
        reset[f.field_key] = f.fieldtype === 'Check' ? '0' : f.field_key === 'deal_value' ? '100000' : '';
      }
      setValues(reset);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submit failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="muted">Loading form…</p>;
  if (error && !schema) return <p className="error">{error}</p>;
  if (!schema) return null;

  return (
    <section className={className || 'agents-panel'}>
      <h2>{schema.title}</h2>
      {schema.subtitle ? <p className="muted">{schema.subtitle}</p> : null}
      {needsLogin ? (
        <p className="muted">
          <Link className="btn" to={`/login?next=${encodeURIComponent(window.location.pathname)}`}>
            Sign in to continue
          </Link>
        </p>
      ) : null}
      {message ? <p className="success">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      <form className="agents-form-grid" onSubmit={(ev) => void onSubmit(ev)}>
        {schema.fields.map((field: AgencyOnboardFormField) => (
          <label
            key={field.field_key}
            className={field.span_full ? 'span-two' : undefined}
            style={field.span_full ? { gridColumn: '1 / -1' } : undefined}
          >
            {field.fieldtype === 'Check' ? (
              <span className="agents-check-row">
                <input
                  type="checkbox"
                  checked={values[field.field_key] === '1'}
                  required={Boolean(field.required)}
                  onChange={(ev) => setField(field.field_key, ev.target.checked ? '1' : '0')}
                />{' '}
                {field.label}
              </span>
            ) : (
              <>
                {field.label}
                {field.fieldtype === 'Select' ? (
                  <select
                    required={Boolean(field.required)}
                    value={values[field.field_key] || ''}
                    onChange={(ev) => setField(field.field_key, ev.target.value)}
                  >
                    <option value="">Select…</option>
                    {(field.options || []).map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : field.fieldtype === 'Textarea' || field.fieldtype === 'Text' ? (
                  <textarea
                    required={Boolean(field.required)}
                    rows={3}
                    placeholder={field.placeholder || ''}
                    value={values[field.field_key] || ''}
                    onChange={(ev) => setField(field.field_key, ev.target.value)}
                  />
                ) : (
                  <input
                    type={fieldInputType(field.fieldtype)}
                    required={Boolean(field.required)}
                    placeholder={field.placeholder || ''}
                    value={values[field.field_key] || ''}
                    onChange={(ev) => setField(field.field_key, ev.target.value)}
                    pattern={field.fieldtype === 'Phone' ? '[6-9][0-9]{9}' : undefined}
                  />
                )}
              </>
            )}
            {field.help_text ? <small className="muted">{field.help_text}</small> : null}
          </label>
        ))}
        <button className="btn" type="submit" disabled={saving || needsLogin}>
          {saving ? 'Submitting…' : schema.submit_label || 'Submit'}
        </button>
      </form>
      {user && isAgencyStaff(user.roles) && formKey === 'agents_portal' ? (
        <p className="muted" style={{ marginTop: 12 }}>
          Already an agent? <Link to="/agents/app">Open dashboard</Link>
        </p>
      ) : null}
    </section>
  );
}
