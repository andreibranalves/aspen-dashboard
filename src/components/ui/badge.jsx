import { cn } from '@/lib/utils.js';

/**
 * StatusBadge — Framer dark status chips.
 * Surface-1 background with subtle colored text for each status.
 */
const badgeVariants = {
  Draft:     'bg-framer-surface-2 text-framer-ink-muted',
  Open:      'bg-framer-accent-blue/10 text-framer-accent-blue',
  Replied:   'bg-amber-500/10 text-amber-300',
  Ordered:   'bg-framer-success/10 text-framer-success',
  Lost:      'bg-red-500/10 text-red-400',
  Expired:   'bg-framer-surface-2 text-framer-ink-muted/50',
  Cancelled: 'bg-framer-surface-2 text-framer-ink-muted/40 line-through',
};

export function StatusBadge({ status, label, className }) {
  const variant = badgeVariants[status] || badgeVariants.Draft;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
        variant,
        className,
      )}
    >
      {label || status}
    </span>
  );
}
