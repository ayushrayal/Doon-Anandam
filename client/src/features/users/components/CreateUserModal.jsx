import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../../shared/lib/api.js';
import { IconClose, IconAlertTriangle, IconEye, IconEyeOff } from '../../../shared/components/Icons.jsx';
import './CreateUserModal.scss';

export function CreateUserModal({ isOpen, onClose, onSuccess }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState('sales_executive');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !loading) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, loading, onClose]);

  if (!isOpen) return null;

  const validate = () => {
    const errs = {};
    if (!name.trim() || name.trim().length < 2) {
      errs.name = 'Full name must be at least 2 characters long';
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errs.email = 'Please provide a valid company email address';
    }
    if (!password || password.length < 8) {
      errs.password = 'Temporary password must be at least 8 characters';
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!validate()) return;

    setLoading(true);
    try {
      const data = await apiFetch('/users', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
          role,
        }),
      });
      onSuccess(data.user);
      onClose();
      // Reset form
      setName('');
      setEmail('');
      setPassword('');
      setShowPassword(false);
      setRole('sales_executive');
    } catch (err) {
      setError(err.message || 'Failed to create user account');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={loading ? undefined : onClose} role="dialog" aria-modal="true">
      <div className="user-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="user-modal-header">
          <div>
            <h3 className="user-modal-title">Provision New Employee</h3>
            <p className="user-modal-desc">
              Create an account with role-based access to the Doon Anandam CRM
            </p>
          </div>
          <button
            type="button"
            className="user-modal-close"
            onClick={onClose}
            disabled={loading}
            aria-label="Close modal"
          >
            <IconClose size={18} />
          </button>
        </div>

        {error && (
          <div className="modal-alert-box" role="alert">
            <IconAlertTriangle size={15} className="modal-alert-icon" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="user-modal-form">
          <div className="form-row">
            <label htmlFor="create-name" className="form-label">
              Full Name
            </label>
            <input
              id="create-name"
              type="text"
              className={`form-input ${fieldErrors.name ? 'form-input--error' : ''}`}
              placeholder="e.g. Rahul Sharma"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (fieldErrors.name) setFieldErrors({ ...fieldErrors, name: '' });
              }}
              disabled={loading}
              autoFocus
            />
            {fieldErrors.name && <span className="field-error-hint">{fieldErrors.name}</span>}
          </div>

          <div className="form-row">
            <label htmlFor="create-email" className="form-label">
              Company Email Address
            </label>
            <input
              id="create-email"
              type="email"
              className={`form-input ${fieldErrors.email ? 'form-input--error' : ''}`}
              placeholder="rahul.sharma@doonanandam.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (fieldErrors.email) setFieldErrors({ ...fieldErrors, email: '' });
              }}
              disabled={loading}
            />
            {fieldErrors.email && <span className="field-error-hint">{fieldErrors.email}</span>}
          </div>

          <div className="form-row">
            <label htmlFor="create-password" className="form-label">
              Temporary Password (min. 8 characters)
            </label>
            <div className="password-input-group">
              <input
                id="create-password"
                type={showPassword ? 'text' : 'password'}
                className={`form-input ${fieldErrors.password ? 'form-input--error' : ''}`}
                placeholder="Enter temporary password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (fieldErrors.password) setFieldErrors({ ...fieldErrors, password: '' });
                }}
                disabled={loading}
              />
              <button
                type="button"
                className="password-peek-trigger"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <IconEyeOff size={15} /> : <IconEye size={15} />}
              </button>
            </div>
            {fieldErrors.password && <span className="field-error-hint">{fieldErrors.password}</span>}
          </div>

          <div className="form-row">
            <label htmlFor="create-role" className="form-label">
              Organizational Role
            </label>
            <select
              id="create-role"
              className="form-select"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              disabled={loading}
            >
              <option value="sales_executive">Sales Executive — Client &amp; Lead Management</option>
              <option value="admin">Administrator — Full System &amp; Employee Access</option>
            </select>
          </div>

          <div className="user-modal-footer">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={loading}
            >
              {loading ? 'Provisioning...' : 'Provision Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
