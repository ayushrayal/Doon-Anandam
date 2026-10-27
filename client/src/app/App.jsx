import React from 'react';
import { useAuth } from '../features/auth/index.js';
import { useRouter } from './routing/RouterContext.jsx';
import { AppProviders } from './providers/AppProviders.jsx';
import { LoginPage } from '../features/auth/index.js';
import { DashboardPage } from '../features/dashboard/index.js';
import { UsersPage } from '../features/users/index.js';
import { LeadsPage } from '../features/leads/index.js';
import { ImportPage } from '../features/import/index.js';
import { AppLayout } from '../shared/layouts/AppLayout.jsx';
import { LoadingState } from '../shared/components/LoadingState.jsx';
import './App.scss';

function AppContent() {
  const { user, loading, isAdmin } = useAuth();
  const { currentPath, navigate } = useRouter();

  if (loading) {
    return (
      <div className="app-loader-container">
        <div className="loader-brand">
          <div className="loader-monogram-badge" aria-hidden="true">DA</div>
          <h1 className="brand-wordmark">DOON ANANDAM</h1>
          <span className="brand-tagline">CRM PLATFORM</span>
        </div>
        <LoadingState message="Verifying secure CRM session..." />
      </div>
    );
  }

  // Unauthenticated user -> render Login Page
  if (!user) {
    return <LoginPage />;
  }

  // Route: Leads Management (Accessible to Admin & Sales Executive)
  if (currentPath === '/leads') {
    return (
      <AppLayout title="Lead Management">
        <LeadsPage />
      </AppLayout>
    );
  }

  // Route: Excel Lead Import (Admin: upload/history/records, Sales Executive: assigned imported leads)
  if (currentPath === '/import') {
    return (
      <AppLayout title={isAdmin ? 'Excel Lead Import' : 'Assigned Imported Leads'}>
        <ImportPage />
      </AppLayout>
    );
  }

  // Route: User Management (Admin only)
  if (currentPath === '/users') {
    if (!isAdmin) {
      // Non-admin attempted to visit /users -> redirect to dashboard
      navigate('/dashboard');
      return (
        <AppLayout title="Dashboard">
          <DashboardPage />
        </AppLayout>
      );
    }
    return (
      <AppLayout title="User Management">
        <UsersPage />
      </AppLayout>
    );
  }

  // Default route: Dashboard
  return (
    <AppLayout title="Dashboard">
      <DashboardPage />
    </AppLayout>
  );
}

function App() {
  return (
    <AppProviders>
      <AppContent />
    </AppProviders>
  );
}

export default App;
