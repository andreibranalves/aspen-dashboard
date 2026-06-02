import { Fragment } from 'react';
import { Menu, ChevronRight } from 'lucide-react';

/**
 * TopBar — breadcrumb (left) + page-specific actions (right).
 * "Aspen Estamparia" and dark mode toggle removed — toggle lives in Sidebar.
 */
export default function TopBar({ route, onMenuClick, breadcrumbItems, onNavigate, actions }) {
  return (
    <header className="flex items-center justify-between px-4 md:px-6 shrink-0 border-b border-framer-hairline bg-framer-canvas" style={{ height: '4rem' }}>
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onMenuClick}
          className="p-1.5 rounded-md hover:bg-framer-surface-2 transition-colors lg:hidden shrink-0"
          aria-label="Abrir menu"
        >
          <Menu size={20} className="text-framer-ink" />
        </button>
        <nav className="flex items-center gap-1.5 text-sm overflow-hidden">
          {breadcrumbItems.map((item, i) => (
            <Fragment key={`${item.label}-${i}`}>
              {i > 0 && <ChevronRight size={14} className="text-framer-ink-muted shrink-0" />}
              {item.hash ? (
                <button
                  type="button"
                  onClick={() => onNavigate(item.hash)}
                  className="text-framer-ink-muted hover:text-framer-ink transition-colors truncate"
                >
                  {item.label}
                </button>
              ) : (
                <span className="text-framer-ink font-medium truncate">{item.label}</span>
              )}
            </Fragment>
          ))}
        </nav>
      </div>
      {actions && (
        <div className="flex items-center gap-2 shrink-0">
          {actions}
        </div>
      )}
    </header>
  );
}
