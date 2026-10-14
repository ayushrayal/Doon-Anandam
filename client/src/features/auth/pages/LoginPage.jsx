import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useRouter } from '../../../app/routing/RouterContext.jsx';
import { IconShield, IconEye, IconEyeOff, IconAlertTriangle } from '../../../shared/components/Icons.jsx';
import './LoginPage.scss';

export function LoginPage() {
  const { login } = useAuth();
  const { navigate } = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  const validate = () => {
    const errors = {};
    if (!email.trim()) {
      errors.email = 'Email address is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errors.email = 'Please enter a valid email address';
    }

    if (!password) {
      errors.password = 'Password is required';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');

    if (!validate()) {
      return;
    }

    setLoading(true);
    try {
      const user = await login(email.trim(), password);
      if (user) {
        navigate('/dashboard');
      }
    } catch (err) {
      setErrorMessage(err.message || 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-viewport">
      <div className="login-shell">
        {/* Brand Architecture Column */}
        <div className="login-shell__brand-panel">
          <div className="brand-panel__header">
            <div className="brand-badge">
              <span className="brand-monogram">DA</span>
            </div>
            <div className="brand-titles">
              <h1 className="brand-name">DOON ANANDAM</h1>
              <span className="brand-edition">Enterprise Real Estate CRM</span>
            </div>
          </div>

          <div className="brand-panel__center">
            <div className="security-notice-card">
              <div className="notice-icon-wrap" aria-hidden="true">
                <IconShield size={16} />
              </div>
              <div className="notice-content">
                <span className="notice-title">Operational Access Portal</span>
                <p className="notice-body">
                  Role-based real estate operations, lead tracking, and administrative controls.
                </p>
              </div>
            </div>
          </div>

          <div className="brand-panel__footer">
            <span className="system-pill">Encrypted Session</span>
            <span className="system-version">Doon Anandam CRM v1.0</span>
          </div>
        </div>

        {/* Form Console Column */}
        <div className="login-shell__form-panel">
          <div className="form-panel__inner">
            <header className="auth-header">
              <h2 className="auth-title">Sign In</h2>
              <p className="auth-subtitle">
                Enter your enterprise credentials to access the workspace.
              </p>
            </header>

            {errorMessage && (
              <div className="login-alert" role="alert">
                <IconAlertTriangle size={16} className="login-alert__icon" />
                <span className="login-alert__text">{errorMessage}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate className="auth-form">
              <div className="form-field">
                <label htmlFor="login-email" className="field-label">
                  Work Email
                </label>
                <input
                  id="login-email"
                  type="email"
                  className={`field-input ${fieldErrors.email ? 'field-input--error' : ''}`}
                  placeholder="name@doonanandam.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (fieldErrors.email) setFieldErrors({ ...fieldErrors, email: '' });
                  }}
                  autoComplete="email"
                  disabled={loading}
                  autoFocus
                />
                {fieldErrors.email && (
                  <span className="field-helper-error">{fieldErrors.email}</span>
                )}
              </div>

              <div className="form-field">
                <div className="field-label-row">
                  <label htmlFor="login-password" className="field-label">
                    Password
                  </label>
                </div>
                <div className="field-password-wrapper">
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    className={`field-input ${fieldErrors.password ? 'field-input--error' : ''}`}
                    placeholder="Enter account password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (fieldErrors.password) setFieldErrors({ ...fieldErrors, password: '' });
                    }}
                    autoComplete="current-password"
                    disabled={loading}
                  />
                  <button
                    type="button"
                    className="password-toggle-trigger"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <IconEyeOff size={15} /> : <IconEye size={15} />}
                  </button>
                </div>
                {fieldErrors.password && (
                  <span className="field-helper-error">{fieldErrors.password}</span>
                )}
              </div>

              <button
                type="submit"
                className="btn btn--primary btn--lg login-submit-btn"
                disabled={loading}
              >
                {loading ? (
                  <span className="btn-loading-content">
                    <span className="btn-spinner" aria-hidden="true" />
                    <span>Verifying session...</span>
                  </span>
                ) : (
                  'Sign In'
                )}
              </button>
            </form>

            <footer className="auth-footer">
              <p className="security-notice-text">
                Protected enterprise system &bull; Authorized personnel only
              </p>
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
}
