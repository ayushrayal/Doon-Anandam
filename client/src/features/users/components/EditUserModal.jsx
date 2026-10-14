import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../../shared/lib/api.js';
import { IconClose, IconAlertTriangle } from '../../../shared/components/Icons.jsx';
import './CreateUserModal.scss';

export function EditUserModal({ isOpen, user, onClose, onSuccess }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('sales_executive');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user) {
      setName(user.name || '');
      setRole(user.role || 'sales_executive');
      setError('');
    }
  }, [user]);

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

  if (!isOpen || !user) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || name.trim().length < 2) {
      setError('Name must be at least 2 characters long');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const data = await apiFetch(`/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: name.trim(),
          role,
        }),
      });
      onSuccess(data.user);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to update employee details');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={loading ? undefined : onClose} role="dialog" aria-modal="true">
      <div className="user-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="user-modal-header">
          <div>
            <h3 className="user-modal-title">Edit Employee Account</h3>
            <p className="user-modal-desc">
              Update name or role permissions for {user.name}
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
            <div className="label-with-hint">
              <label className="form-label">Email Address</label>
              <span className="readonly-badge">Immutable Identifier</span>
            </div>
            <input
              type="email"
              className="form-input form-input--readonly"
              value={user.email}
              disabled
              readOnly
            />
          </div>

          <div className="form-row">
            <label htmlFor="edit-name" className="form-label">
              Full Name
            </label>
            <input
              id="edit-name"
              type="text"
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={loading}
              autoFocus
            />
          </div>

          <div className="form-row">
            <label htmlFor="edit-role" className="form-label">
              Organizational Role
            </label>
            <select
              id="edit-role"
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
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
