import { Link, NavLink, Outlet } from 'react-router-dom';
import { clearSession, getSessionCookie } from '../api';

export function Layout() {
  const loggedIn = Boolean(getSessionCookie());

  return (
    <div className="layout">
      <header className="header">
        <div className="header-inner">
          <Link to="/" className="brand">
            Health Ecosystem
          </Link>
          <nav className="nav">
            <NavLink to="/" end>
              Home
            </NavLink>
            <NavLink to="/lab">Lab Tests</NavLink>
            <NavLink to="/pharmacy">Pharmacy</NavLink>
            <NavLink to="/login">{loggedIn ? 'Account' : 'Login'}</NavLink>
            {loggedIn && (
              <button
                className="btn secondary"
                onClick={() => {
                  clearSession();
                  window.location.href = '/login';
                }}
              >
                Logout
              </button>
            )}
          </nav>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </div>
  );
}
