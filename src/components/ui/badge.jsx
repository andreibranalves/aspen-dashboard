import { cn } from '@/lib/utils.js';

const badgeVariants = {
  Draft: 'bg-muted text-muted-foreground hover:bg-muted',
  Open: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 hover:bg-blue-500/10',
  Replied: 'bg-amber-500/10 text-amber-800 dark:text-amber-300 hover:bg-amber-500/10',
  Ordered: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10',
  Lost: 'bg-red-500/10 text-red-700 dark:text-red-300 hover:bg-red-500/10',
  Expired: 'bg-muted text-muted-foreground/60 hover:bg-muted',
  Cancelled: 'bg-muted text-muted-foreground/50 line-through hover:bg-muted',
};

export function StatusBadge({ status, label, className }) {
  const variant = badgeVariants[status] || badgeVariants.Draft;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none',
        variant,
        className,
      )}
    >
      {label || status}
    </span>
  );
}
