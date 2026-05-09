import { useState, useCallback, useEffect } from 'react';
import Sidebar from './Sidebar.jsx';
import TopBar from './TopBar.jsx';

export default function Layout({ route, onNavigate, children }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    // Em mobile, começa fechado
    if (typeof window !== 'undefined') {
      return window.innerWidth < 1024;
    }
    return false;
  });

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => !prev);
  }, []);

  // Fecha sidebar automaticamente em mobile ao navegar
  useEffect(() => {
    if (window.innerWidth < 1024) {
      setSidebarCollapsed(true);
    }
  }, [route]);

  return (
    <div className="h-screen flex overflow-hidden bg-gray-50">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={toggleSidebar}
        currentRoute={route}
        onNavigate={onNavigate}
      />

      {/* Main content area */}
      <div
        className="flex-1 flex flex-col min-w-0 transition-all duration-300"
        style={{ marginLeft: sidebarCollapsed ? '4rem' : '16rem' }}
      >
        <TopBar route={route} />
        <main className="flex-1 overflow-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
