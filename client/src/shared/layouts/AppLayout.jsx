import React, { useState } from 'react';
import { Sidebar } from './Sidebar.jsx';
import { Topbar } from './Topbar.jsx';
import './AppLayout.scss';

export function AppLayout({ title, children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="app-layout">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="app-layout__main">
        <Topbar onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} title={title} />
        <main className="app-layout__content">
          {children}
        </main>
      </div>
    </div>
  );
}
