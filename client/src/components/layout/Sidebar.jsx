import React from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useRouter } from '../../context/RouterContext.jsx';
import { IconDashboard, IconUsers, IconBuilding, IconClose, IconLeads } from '../common/Icons.jsx';
import './Sidebar.scss';

export function Sidebar({ isOpen, onClose }) {
  const { user, isAdmin } = useAuth();
  const { currentPath, navigate } = useRouter();

  const handleNav = (path) => {
    navigate(path);
    if (onClose) onClose();
  };

  const userInitial = user?.name ? user.name.charAt(0).toUpperCase() : 'U';

  return (
    <>
      <aside className={`app-sidebar ${isOpen ? 'app-sidebar--open' : ''}`}>
        <div className="app-sidebar__brand">
          <div className="brand-logo-mark" aria-hidden="true">
            <span className="brand-monogram">DA</span>
          </div>
          <div className="brand-text-block">
            <h1 className="brand-wordmark">DOON ANANDAM</h1>
            <span className="brand-tagline">Enterprise CRM</span>
          </div>
          {isOpen && (
            <button
              type="button"
              className="sidebar-close-btn"
              onClick={onClose}
              aria-label="Close navigation"
            >
              <IconClose size={18} />
            </button>
          )}
        </div>

        <div className="app-sidebar__section-label">Operational Workspaces</div>

        <nav className="app-sidebar__nav" aria-label="Main Navigation">
          <button
            type="button"
            className={`nav-item ${currentPath === '/dashboard' || currentPath === '/' ? 'nav-item--active' : ''}`}
            onClick={() => handleNav('/dashboard')}
          >
            <span className="nav-item__indicator" aria-hidden="true" />
            <IconDashboard size={18} className="nav-item__icon" />
            <span className="nav-item__label">Dashboard</span>
          </button>

          <button
            type="button"
            className={`nav-item ${currentPath === '/leads' ? 'nav-item--active' : ''}`}
            onClick={() => handleNav('/leads')}
          >
            <span className="nav-item__indicator" aria-hidden="true" />
            <IconLeads size={18} className="nav-item__icon" />
            <span className="nav-item__label">Leads</span>
          </button>

          {isAdmin && (
            <button
              type="button"
              className={`nav-item ${currentPath === '/users' ? 'nav-item--active' : ''}`}
              onClick={() => handleNav('/users')}
            >
              <span className="nav-item__indicator" aria-hidden="true" />
              <IconUsers size={18} className="nav-item__icon" />
              <span className="nav-item__label">User Management</span>
            </button>
          )}
        </nav>

        <div className="app-sidebar__footer">
          <div className="user-mini-card">
            <div className="user-avatar" aria-hidden="true">
              {userInitial}
            </div>
            <div className="user-mini-info">
              <span className="user-name" title={user?.name || 'Authorized User'}>
                {user?.name || 'Authorized User'}
              </span>
              <span className="user-role-label">
                {isAdmin ? 'Administrator' : 'Sales Executive'}
              </span>
            </div>
          </div>
        </div>
      </aside>

      {isOpen && (
        <div
          className="sidebar-backdrop"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
    </>
  );
}
