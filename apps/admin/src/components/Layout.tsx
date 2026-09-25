import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth';

export function Layout() {
  const { user, signOut, hasRole } = useAuth();
  return (
    <div className="shell">
      <header className="topbar">
        <strong>IMC Arena · Staff</strong>
        <nav aria-label="Main">
          <NavLink to="/questions">Questions</NavLink>
          <NavLink to="/review">Review queue</NavLink>
          {hasRole('editor', 'administrator') && <NavLink to="/import">Import</NavLink>}
          <NavLink to="/reports">Reports</NavLink>
          {hasRole('administrator') && <NavLink to="/metrics">Metrics</NavLink>}
          {hasRole('administrator', 'support') && <NavLink to="/audit">Audit</NavLink>}
          {hasRole('administrator') && <NavLink to="/staff">Staff</NavLink>}
        </nav>
        <span className="who">
          {user?.roles.join(', ')}{' '}
          <button type="button" className="link" onClick={() => void signOut()}>
            Sign out
          </button>
        </span>
      </header>
      <main id="main">
        <Outlet />
      </main>
    </div>
  );
}

export function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="error">
      {message}
    </div>
  );
}
