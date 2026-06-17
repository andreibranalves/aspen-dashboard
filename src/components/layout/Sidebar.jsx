import {
  BarChart3,
  ShoppingCart,
  FileText,
  Sparkles,
  Columns3,
  Package,
  Users,
  Settings,
  MessageCircle,
  Menu,
  X,
  Moon,
  Sun,
} from 'lucide-react';
import { cn } from '@/lib/utils.js';

const NAV_SECTIONS = [
  {
    title: 'Operacional',
    items: [
      { hash: '/auto', label: 'Auto', icon: Sparkles },
      { hash: '/dashboard', label: 'Dashboard', icon: BarChart3 },
      { hash: '/sales-orders', label: 'Pedidos', icon: ShoppingCart },
      { hash: '/crm', label: 'CRM', icon: Columns3 },
    ],
  },
  {
    title: 'Cadastros',
    items: [
      { hash: '/quotations', label: 'Orçamentos', icon: FileText },
      { hash: '/products', label: 'Produtos', icon: Package },
      { hash: '/leads', label: 'Leads', icon: Users },
    ],
  },
  {
    title: 'Outros',
    items: [
      { hash: '/comunicacao', label: 'Comunicação', icon: MessageCircle },
      { hash: '/settings', label: 'Configurações', icon: Settings },
    ],
  },
];

/**
 * Sidebar — Alpine dark navigation.
 * shell background, line borders, fg text,
 * surface-muted hover, primary active indicator.
 */
export default function Sidebar({
  collapsed,
  onToggle,
  currentRoute,
  onNavigate,
  darkMode,
  toggleDarkMode,
}) {
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
          'fixed top-0 left-0 z-30 h-full bg-shell text-fg',
          'flex flex-col transition-all duration-300 overflow-hidden',
          collapsed ? 'w-0 lg:w-16' : 'w-64'
        )}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 border-b border-line shrink-0"
          style={{ height: '4rem' }}
        >
          {!collapsed && (
            <div className="flex items-center gap-2.5 whitespace-nowrap">
              <img
                src="/logo_branca.svg"
                alt="Aspen Estamparia"
                style={{ height: '2rem', width: 'auto' }}
              />
            </div>
          )}
          <button
            onClick={onToggle}
            className="p-1.5 rounded-md hover:bg-surface-muted transition-colors"
            aria-label={collapsed ? 'Abrir menu' : 'Fechar menu'}
          >
            {collapsed ? <Menu size={20} /> : <X size={20} />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-2 overflow-y-auto">
          {NAV_SECTIONS.map((section) => (
            <div key={section.title} className="mb-2">
              {/* Section header — hidden when collapsed */}
              {!collapsed && (
                <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-fg-muted/50">
                  {section.title}
                </div>
              )}
              {/* Section divider when collapsed */}
              {collapsed && <div className="mx-3 my-2 border-t border-line" />}
              {section.items.map(({ hash, label, icon: Icon }) => (
                <button
                  key={hash}
                  onClick={() => onNavigate(hash)}
                  className={cn(
                    'w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors',
                    'hover:bg-primary/5',
                    currentRoute === hash ? 'bg-primary/10 text-primary font-medium' : 'text-fg'
                  )}
                  title={collapsed ? label : undefined}
                >
                  <Icon size={20} className="shrink-0" />
                  {!collapsed && <span className="truncate">{label}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* Footer — Dark/Light toggle */}
        <div className="px-4 py-3 border-t border-line shrink-0 space-y-3">
          {/* Theme toggle */}
          <button
            type="button"
            onClick={toggleDarkMode}
            className={cn(
              'w-full flex items-center gap-3 rounded-md px-3 py-2 text-xs font-medium transition-colors',
              'hover:bg-surface-muted',
              collapsed && 'justify-center px-0'
            )}
            aria-label={darkMode ? 'Ativar modo claro' : 'Ativar modo escuro'}
            title={darkMode ? 'Modo claro' : 'Modo escuro'}
          >
            {darkMode ? (
              <Sun size={16} className="shrink-0" />
            ) : (
              <Moon size={16} className="shrink-0" />
            )}
            {!collapsed && <span>{darkMode ? 'Modo claro' : 'Modo escuro'}</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
