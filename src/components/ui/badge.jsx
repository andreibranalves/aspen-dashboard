import { cn } from '@/lib/utils.js';

const badgeVariants = {
  Draft: 'bg-stone-100 text-stone-600 hover:bg-stone-100',
  Open: 'bg-blue-50 text-blue-700 hover:bg-blue-50',
  Replied: 'bg-yellow-50 text-yellow-800 hover:bg-yellow-50',
  Ordered: 'bg-green-50 text-green-700 hover:bg-green-50',
  Lost: 'bg-red-50 text-red-700 hover:bg-red-50',
  Expired: 'bg-gray-100 text-gray-400 hover:bg-gray-100',
  Cancelled: 'bg-gray-100 text-gray-300 line-through hover:bg-gray-100',
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
