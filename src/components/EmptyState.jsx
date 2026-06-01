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
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
        <IconComponent size={36} className="text-gray-300 dark:text-gray-600" />
      </div>
      <h3 className="text-lg font-medium text-gray-900 dark:text-white">
        {title}
      </h3>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-gray-500 dark:text-gray-400">
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
