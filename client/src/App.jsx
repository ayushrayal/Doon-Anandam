import React from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { RouterProvider, useRouter } from './context/RouterContext.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { DashboardPage } from './pages/DashboardPage.jsx';
import { UsersPage } from './pages/UsersPage.jsx';
import { AppLayout } from './components/layout/AppLayout.jsx';
import { LoadingState } from './components/common/LoadingState.jsx';
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

  // Route matching for authenticated session
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
    <RouterProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </RouterProvider>
  );
}

export default App;
