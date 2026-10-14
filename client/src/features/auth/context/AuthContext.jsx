import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../../shared/lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  const checkAuth = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiFetch('/auth/me');
      if (data && data.user) {
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch (err) {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = async (email, password) => {
    setAuthError(null);
    try {
      const data = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      if (data && data.user) {
        setUser(data.user);
        return data.user;
      }
    } catch (err) {
      setAuthError(err.message || 'Invalid email or password');
      throw err;
    }
  };

  const logout = async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch (err) {
      // Ignore network errors on logout
    } finally {
      setUser(null);
    }
  };

  const value = {
    user,
    loading,
    authError,
    setAuthError,
    login,
    logout,
    checkAuth,
    isAdmin: user?.role === 'admin',
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
