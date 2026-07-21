import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { dashboardLabel, isHrStaff } from '../auth/roles';

export function AccountPage() {
  const { user, defaultRoute, logout } = useAuth();

  if (!user) {
    return null;
  }

  return (
    <>
      <h1>Account</h1>
      <div className="card card-wide">
        <dl className="detail-list">
          <div>
            <dt>Name</dt>
            <dd>{user.fullName || '—'}</dd>
          </div>
          <div>
            <dt>Email / user ID</dt>
            <dd>{user.user}</dd>
          </div>
          <div>
            <dt>Roles</dt>
            <dd>
              <div className="tag-row">
                {user.roles.map((role) => (
                  <span key={role} className="badge">
                    {role}
                  </span>
                ))}
              </div>
            </dd>
          </div>
          {user.franchisee && (
            <div>
              <dt>Linked franchise</dt>
              <dd>
                {user.franchisee.franchise_name} ({user.franchisee.branch_code})
              </dd>
            </div>
          )}
        </dl>
        <div className="toolbar" style={{ marginTop: 20 }}>
          <Link className="btn" to={defaultRoute}>
            Go to {dashboardLabel(user.roles)} dashboard
          </Link>
          {isHrStaff(user.roles) && (
            <Link className="btn secondary" to="/dashboard/hr">
              HR self-service
            </Link>
          )}
          <button className="btn secondary" type="button" onClick={logout}>
            Logout
          </button>
        </div>
      </div>
    </>
  );
}
