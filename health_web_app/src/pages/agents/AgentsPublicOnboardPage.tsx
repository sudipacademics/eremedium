import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { isAgencyStaff } from '../../auth/roles';
import { DynamicAgencyOnboardForm } from './DynamicAgencyOnboardForm';
import './agents-portal.css';

/** Public landing at /agents — admin-driven onboarding form. */
export function AgentsPublicOnboardPage() {
  const { user, isAuthenticated } = useAuth();
  const isAgent = Boolean(user && isAgencyStaff(user.roles));

  return (
    <div className="page agents-public-page">
      <header className="agents-public-hero">
        <p className="eyebrow">Remedium Agency</p>
        <h1>Agency Agents</h1>
        <p className="muted">
          Build franchise distribution with Remedium — recruit, activate, and earn through the BA network.
        </p>
        <div className="agents-public-actions">
          {isAgent ? (
            <Link className="btn" to="/agents/app">
              Open agent dashboard
            </Link>
          ) : (
            <Link className="btn secondary" to="/login?next=/agents/app">
              Agent login
            </Link>
          )}
        </div>
      </header>

      <DynamicAgencyOnboardForm formKey="agents_portal" />

      {!isAuthenticated ? (
        <p className="muted agents-public-footnote">
          Already onboarded? <Link to="/login?next=/agents/app">Sign in</Link> to access your portal.
        </p>
      ) : null}
    </div>
  );
}
