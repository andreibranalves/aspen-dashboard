// src/components/StatusBadge.jsx
// Standardized status badge — replaces inline emoji-based status chips.
// Color scheme maps to semantic states.

import { cn } from '@/lib/utils';
import { Check, X, Clock, AlertTriangle, Loader2 } from 'lucide-react';

const STATUS_STYLES = {
  success: 'tone-success-soft',
  warning: 'tone-warning-soft',
  error: 'tone-destructive-soft',
  info: 'tone-info-soft',
  neutral: 'tone-neutral-soft',
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
