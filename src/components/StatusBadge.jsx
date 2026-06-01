// src/components/StatusBadge.jsx
// Standardized status badge — replaces inline emoji-based status chips.
// Color scheme maps to semantic states.

import { cn } from '@/lib/utils.js';
import { Check, X, Clock, AlertTriangle, Loader2 } from 'lucide-react';

const STATUS_STYLES = {
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800',
  warning: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800',
  error: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800',
  info: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800',
  neutral: 'bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700',
};

const STATUS_ICONS = {
  success: Check,
  warning: AlertTriangle,
  error: X,
  info: Clock,
  neutral: null,
};

export default function StatusBadge({
  label,
  variant = 'neutral', // 'success' | 'warning' | 'error' | 'info' | 'neutral'
  size = 'sm',        // 'sm' | 'md'
  pending = false,
  className,
}) {
  const Icon = pending ? Loader2 : STATUS_ICONS[variant];
  const style = STATUS_STYLES[variant] || STATUS_STYLES.neutral;
  const sizeClass = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-medium',
        style,
        sizeClass,
        className,
      )}
    >
      {Icon && (
        <Icon
          size={size === 'sm' ? 12 : 14}
          className={cn(pending && 'animate-spin')}
        />
      )}
      {label}
    </span>
  );
}
