import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Confirm } from './pages/Confirm';
import { ForgotPassword } from './pages/ForgotPassword';
import { ResetPassword } from './pages/ResetPassword';
import { Dashboard } from './pages/Dashboard';
import { AddChild } from './pages/AddChild';
import { AcceptOffer } from './pages/AcceptOffer';
import { LanguagePreference } from './pages/LanguagePreference';
import { AdminGuard } from './admin/AdminGuard';
import { AdminLogin } from './admin/AdminLogin';
import { AdminSearch } from './admin/AdminSearch';
import { AdminFamily } from './admin/AdminFamily';
import { AdminLottery } from './admin/AdminLottery';
import { AdminRollYear } from './admin/AdminRollYear';
import { AdminSurvey } from './admin/AdminSurvey';
import { AdminNotify } from './admin/AdminNotify';
import type { ReactNode } from 'react';

function Protected({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  if (loading) return <p className="container">Loading…</p>;
  return me ? <>{children}</> : <Navigate to="/login" replace />;
}

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/confirm" element={<Confirm />} />
        <Route path="/forgot" element={<ForgotPassword />} />
        <Route path="/reset" element={<ResetPassword />} />
        <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
        <Route path="/add-child" element={<Protected><AddChild /></Protected>} />
        <Route path="/children/:id/accept" element={<Protected><AcceptOffer /></Protected>} />
        <Route path="/children/:id/language" element={<Protected><LanguagePreference /></Protected>} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin" element={<AdminGuard><AdminSearch /></AdminGuard>} />
        <Route path="/admin/family/:parentId" element={<AdminGuard><AdminFamily /></AdminGuard>} />
        <Route path="/admin/lottery" element={<AdminGuard><AdminLottery /></AdminGuard>} />
        <Route path="/admin/roll-year" element={<AdminGuard><AdminRollYear /></AdminGuard>} />
        <Route path="/admin/survey" element={<AdminGuard><AdminSurvey /></AdminGuard>} />
        <Route path="/admin/notify" element={<AdminGuard><AdminNotify /></AdminGuard>} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Layout>
  );
}
