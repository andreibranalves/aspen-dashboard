import { LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Spinner centralizado; o rótulo fica só para leitor de tela. */
export default function LoadingSpinner({ label, className }: { label: string; className?: string }) {
  return (
    <div role="status" className={cn('grid place-items-center py-10 text-fg-muted', className)}>
      <LoaderCircle className="size-6 animate-spin" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
