import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * BackButton — pill button with a left-chevron icon inside a solid primary circle.
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
        'inline-flex items-center gap-2 rounded-full pl-1 pr-3 py-1 text-sm font-medium',
        'bg-surface border border-line text-primary hover:bg-primary/5 active:scale-[0.97]',
        'transition-all duration-200 shrink-0',
        className,
      )}
      aria-label={label}
    >
      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-white">
        <ChevronLeft size={16} strokeWidth={2.5} />
      </span>
      <span>{label}</span>
    </button>
  );
}
