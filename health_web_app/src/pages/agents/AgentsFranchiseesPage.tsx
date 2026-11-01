import { useEffect, useState } from 'react';
import {
  api,
  AgencyOnboardRequest,
  AgencyFranchiseeRow,
} from '../../api';
import { DynamicAgencyOnboardForm } from './DynamicAgencyOnboardForm';
import './agents-portal.css';

function money(n?: number) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export function AgentsFranchiseesPage() {
  const [requests, setRequests] = useState<AgencyOnboardRequest[]>([]);
  const [franchisees, setFranchisees] = useState<AgencyFranchiseeRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [completing, setCompleting] = useState<string | null>(null);

  async function load() {
    const [reqRes, franRes] = await Promise.all([
      api.getAgencyOnboardRequests(),
      api.getAgencyFranchisees(),
    ]);
    setRequests(reqRes.data.requests || []);
    setFranchisees(franRes.data.franchisees || []);
  }

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load franchisees'));
  }, []);

  async function onComplete(requestId: string) {
    setCompleting(requestId);
    setError(null);
    setMessage(null);
    try {
      const res = await api.completeAgencyFranchiseeOnboard(requestId);
      setMessage(`Franchisee ${res.data.franchise_name || res.data.franchisee} onboarded.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Complete failed');
    } finally {
      setCompleting(null);
    }
  }

  return (
    <>
      <h1>Franchisees & commissions</h1>
      <p className="muted">
        Submit an onboard request to FFMS. After FFMS approves, complete onboarding here.
        Form fields are managed in ERPNext → <b>Agency Onboard Form</b> (key: franchisee_onboard).
      </p>
      {message ? <p className="muted">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      <DynamicAgencyOnboardForm
        formKey="franchisee_onboard"
        onSubmitted={(res) => {
          setMessage(res.message || `Request ${res.linked_request || res.submission_id} submitted.`);
          void load().catch(() => undefined);
        }}
      />

      <section className="agents-panel">
        <h2>Onboard requests</h2>
        {requests.length === 0 ? (
          <p className="muted">No requests yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Prospect</th>
                <th>Status</th>
                <th>Deal</th>
                <th>Earned</th>
                <th>Payout</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {requests.map((row) => (
                <tr key={row.name}>
                  <td>
                    <b>{row.prospect_name}</b>
                    <br />
                    <small>
                      {row.mobile}
                      {row.franchise_model ? ` · ${row.franchise_model}` : ''}
                    </small>
                  </td>
                  <td>{row.status}</td>
                  <td>{money(row.deal_value)}</td>
                  <td>{money(row.commission_earned)}</td>
                  <td>
                    <small>{row.commission_payout_status || 'Pending FFMS'}</small>
                  </td>
                  <td>
                    {row.status === 'Approved' ? (
                      <button
                        className="btn"
                        type="button"
                        disabled={completing === row.name}
                        onClick={() => void onComplete(row.name)}
                      >
                        {completing === row.name ? 'Onboarding…' : 'Complete onboard'}
                      </button>
                    ) : row.franchise_name ? (
                      <small>{row.franchise_name}</small>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="agents-panel">
        <h2>Franchisees created</h2>
        {franchisees.length === 0 ? (
          <p className="muted">No attributed franchisees yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Franchisee</th>
                <th>Attributed</th>
                <th>Deal</th>
                <th>Commission earned</th>
                <th>Paid</th>
                <th>Payout</th>
              </tr>
            </thead>
            <tbody>
              {franchisees.map((row) => (
                <tr key={row.attribution_id}>
                  <td>{row.franchise_name || row.franchisee}</td>
                  <td>{row.attributed_on || '—'}</td>
                  <td>{money(row.deal_value)}</td>
                  <td>{money(row.commission_earned)}</td>
                  <td>{money(row.commission_paid)}</td>
                  <td>
                    <small>{row.commission_payout_status}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
