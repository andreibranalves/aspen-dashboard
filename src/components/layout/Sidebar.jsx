import {
  FileText,
  Sparkles,
  Truck,
  Columns3,
  Package,
  Users,
  Settings,
  Menu,
  X,
  PlusCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils.js';

const NAV_ITEMS = [
  { hash: '/quotations', label: 'Orçamentos', icon: FileText },
  { hash: '/auto',       label: 'Auto',        icon: Sparkles },
  { hash: '/manual',     label: 'Novo Orçamento', icon: PlusCircle },
  { hash: '/freight',    label: 'Frete',       icon: Truck },
  { hash: '/crm',        label: 'CRM',         icon: Columns3 },
  { hash: '/products',   label: 'Produtos',    icon: Package },
  { hash: '/leads',      label: 'Leads',       icon: Users },
  { hash: '/settings',   label: 'Config',      icon: Settings },
];

/**
 * Sidebar — Framer dark navigation.
 * surface-1 background, hairline borders, ink text,
 * surface-2 hover, hairline active indicator.
 */
export default function Sidebar({ collapsed, onToggle, currentRoute, onNavigate }) {
  return (
    <>
      {/* Overlay mobile */}
      {!collapsed && (
        <div
          className="fixed inset-0 bg-black/60 z-20 lg:hidden backdrop-blur-sm"
          onClick={onToggle}
        />
      )}

      <aside
        className={cn(
          'fixed top-0 left-0 z-30 h-full bg-framer-surface-1 text-framer-ink',
          'flex flex-col transition-all duration-300 overflow-hidden',
          collapsed ? 'w-0 lg:w-16' : 'w-64',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between h-14 px-4 border-b border-framer-hairline shrink-0">
          {!collapsed && (
            <span className="font-semibold text-[15px] whitespace-nowrap tracking-[-0.8px]">
              Aspen Orçamento
            </span>
          )}
          <button
            onClick={onToggle}
            className="p-1.5 rounded-md hover:bg-framer-surface-2 transition-colors"
            aria-label={collapsed ? 'Abrir menu' : 'Fechar menu'}
          >
            {collapsed ? <Menu size={20} /> : <X size={20} />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-2 overflow-y-auto">
          {NAV_ITEMS.map(({ hash, label, icon: Icon }) => (
            <button
              key={hash}
              onClick={() => onNavigate(hash)}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors',
                'hover:bg-primary/5',
                currentRoute === hash
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-framer-ink-muted',
              )}
              title={collapsed ? label : undefined}
            >
              <Icon size={20} className="shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}
            </button>
          ))}
        </nav>

        {/* Footer */}
        {!collapsed && (
          <div className="px-4 py-3 border-t border-framer-hairline text-xs text-framer-ink-muted shrink-0">
            v3.0 · Framer
          </div>
        )}
      </aside>
    </>
  );
}
