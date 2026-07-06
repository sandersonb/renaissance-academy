import type { ReactNode } from 'react';
import { useAuth } from '../auth';

export function Layout({ children }: { children: ReactNode }) {
  const { me, logout } = useAuth();
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Renaissance Academy — Enrollment</span>
        {me && (
          <button className="link" onClick={() => void logout()}>
            Log out
          </button>
        )}
      </header>
      <main className="container">{children}</main>
    </div>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="error">{message}</div>;
}
