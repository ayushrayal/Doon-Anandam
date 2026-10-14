import React from 'react';
import { useAuth } from '../../features/auth/index.js';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { IconMenu, IconLogout } from '../components/Icons.jsx';
import './Topbar.scss';

export function Topbar({ onToggleSidebar, title }) {
  const { user, logout } = useAuth();

  const userInitial = user?.name ? user.name.charAt(0).toUpperCase() : 'U';

  return (
    <header className="app-topbar">
      <div className="app-topbar__left">
        <button
          type="button"
          className="menu-btn"
          onClick={onToggleSidebar}
          aria-label="Toggle navigation menu"
        >
          <IconMenu size={18} />
        </button>

        <nav aria-label="Breadcrumb" className="breadcrumb-nav">
          <span className="breadcrumb-root">Portal</span>
          <span className="breadcrumb-sep">/</span>
          <h2 className="page-heading">{title}</h2>
        </nav>
      </div>

      <div className="app-topbar__right">
        <div className="topbar-user-badge">
          <div className="topbar-avatar" aria-hidden="true">
            {userInitial}
          </div>
          <div className="user-profile-details">
            <span className="user-profile-name">{user?.name || 'Administrator'}</span>
            <span className="user-profile-email">{user?.email || 'admin@doonanandam.com'}</span>
          </div>
          <StatusBadge type="role" value={user?.role} />
        </div>

        <div className="topbar-divider" aria-hidden="true" />

        <button
          type="button"
          className="logout-btn"
          onClick={logout}
          title="Sign out of CRM session"
        >
          <IconLogout size={15} className="logout-btn__icon" />
          <span className="logout-btn__label">Sign out</span>
        </button>
      </div>
    </header>
  );
}
