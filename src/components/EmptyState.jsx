// src/components/EmptyState.jsx
// Standardized empty state — for lists, tables, and pages with no data.
// Uses Lucide icons (no emoji).

import { Package } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { cn } from '@/lib/utils.js';

const EMPTY_ICONS = {
  default: Package,
  products: Package,
  quotations: Package,
  orders: Package,
  leads: Package,
};

export default function EmptyState({
  icon: Icon,
  iconType = 'default', // 'default' | 'products' | 'quotations' | 'orders' | 'leads'
  title = 'Nenhum item encontrado',
  description = '',
  actionLabel = '',
  onAction,
  className,
}) {
  const IconComponent = Icon || EMPTY_ICONS[iconType] || EMPTY_ICONS.default;

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-16 px-4 text-center',
        className,
      )}
    >
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface-muted">
        <IconComponent size={36} className="text-fg-muted/40" />
      </div>
      <h3 className="text-lg font-medium text-fg">
        {title}
      </h3>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-fg-muted">
          {description}
        </p>
      )}
      {actionLabel && onAction && (
        <Button onClick={onAction} className="mt-4" size="sm">
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
