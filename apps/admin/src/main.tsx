import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { AuditPage, ImportPage, MetricsPage, ReportsPage, StaffPage } from './pages/OpsPages';
import { QuestionsPage } from './pages/QuestionsPage';
import { VersionPage } from './pages/VersionPage';
import './styles.css';

function App() {
  const { user, loading } = useAuth();
  if (loading) return <p className="center">Loading…</p>;
  if (!user) return <LoginPage />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/questions" replace />} />
        <Route path="/questions" element={<QuestionsPage />} />
        <Route path="/questions/new" element={<VersionPage />} />
        <Route path="/versions/:id" element={<VersionPage />} />
        <Route path="/review" element={<QuestionsPage reviewQueue />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/metrics" element={<MetricsPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/staff" element={<StaffPage />} />
        <Route path="*" element={<p>Not found.</p>} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
