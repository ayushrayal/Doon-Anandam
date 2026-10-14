import React from 'react';
import { RouterProvider } from '../routing/RouterContext.jsx';
import { AuthProvider } from '../../features/auth/context/AuthContext.jsx';

export function AppProviders({ children }) {
  return (
    <RouterProvider>
      <AuthProvider>
        {children}
      </AuthProvider>
    </RouterProvider>
  );
}
