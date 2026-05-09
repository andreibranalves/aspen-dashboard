import { useState, useCallback, useEffect } from 'react';
import Sidebar from './Sidebar.jsx';
import TopBar from './TopBar.jsx';
import { cn } from '@/lib/utils.js';

export default function Layout({ route, onNavigate, children }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth < 1024;
    }
    return false;
  });

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => !prev);
  }, []);

  // Auto-collapse on mobile after navigation
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
        className={cn(
          'flex-1 flex flex-col min-w-0 transition-all duration-300',
          'ml-0 lg:ml-16', // mobile: 0, desktop collapsed: 4rem
          !sidebarCollapsed && 'lg:ml-64', // desktop open: 16rem
        )}
      >
        <TopBar route={route} onMenuClick={toggleSidebar} />
        <main className="flex-1 overflow-auto p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
