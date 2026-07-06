import { useEffect, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { adminApi, ApiError } from '../api';

/** Gates admin routes: confirms an admin session via /api/admin/me. */
export function AdminGuard({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'ok' | 'no'>('loading');
  useEffect(() => {
    adminApi
      .me()
      .then(() => setState('ok'))
      .catch((e) => setState(e instanceof ApiError && e.status === 403 ? 'no' : 'no'));
  }, []);
  if (state === 'loading') return <p className="container">Loading…</p>;
  if (state === 'no') return <Navigate to="/admin/login" replace />;
  return <>{children}</>;
}
