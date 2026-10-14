import React from 'react';
import './StatusBadge.scss';

export function StatusBadge({ type, value }) {
  if (type === 'status') {
    const isActive = Boolean(value);
    return (
      <span className={`status-badge status-badge--${isActive ? 'active' : 'inactive'}`}>
        <span className="status-badge__dot" aria-hidden="true" />
        <span className="status-badge__text">{isActive ? 'Active' : 'Inactive'}</span>
      </span>
    );
  }

  if (type === 'role') {
    const isAdmin = value === 'admin';
    return (
      <span className={`status-badge status-badge--role-${isAdmin ? 'admin' : 'sales'}`}>
        <span className="status-badge__text">{isAdmin ? 'Administrator' : 'Sales Executive'}</span>
      </span>
    );
  }

  return <span className="status-badge">{value}</span>;
}
