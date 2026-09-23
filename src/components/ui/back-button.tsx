import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * BackButton — compact button with a left-chevron icon inside a solid primary circle.
 * Reference: navbar back action (circle arrow + "voltar" label).
 */
interface BackButtonProps {
  onClick?: () => void;
  label?: string;
  className?: string;
}

export default function BackButton({ onClick, label = 'voltar', className }: BackButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex min-h-9 items-center gap-2 rounded-control pl-1 pr-3 py-1 text-sm font-semibold',
        'border border-border-control bg-surface text-link hover:bg-primary/5 active:scale-[0.97]',
        'shrink-0 transition-colors duration-150',
        className
      )}
      aria-label={label}
    >
      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-on-solid">
        <ChevronLeft size={16} strokeWidth={2.5} />
      </span>
      <span>{label}</span>
    </button>
  );
}
