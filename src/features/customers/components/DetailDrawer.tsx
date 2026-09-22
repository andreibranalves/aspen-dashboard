import { useEffect, useRef, useCallback, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DetailDrawerProps {
  open: boolean;
  onClose?: () => void;
  title?: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * DetailDrawer — painel lateral reutilizável para drill-down operacional.
 * Mantém foco no painel e devolve o foco ao controle que o abriu.
 */
export function DetailDrawer({
  open,
  onClose,
  title,
  description,
  actions,
  children,
  className,
}: DetailDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));
        if (dialogs.at(-1) !== panelRef.current) return;
        event.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    []
  );

  useEffect(() => {
    if (!open) return undefined;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    document.addEventListener('keydown', handleKeyDown, true);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.overflow = '';
      restoreFocusRef.current?.focus?.();
      restoreFocusRef.current = null;
    };
  }, [handleKeyDown, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Detalhes'}
        className={cn(
          'relative z-10 m-3 flex h-[calc(100dvh-1.5rem)] w-[calc(100%-1.5rem)] flex-col rounded-card border border-line bg-surface shadow-2xl',
          'lg:max-w-xl',
          className
        )}
      >
        <div className="flex shrink-0 items-start justify-between border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1 pr-4">
            <h2 className="break-words text-lg font-semibold text-fg">{title || 'Detalhes'}</h2>
            {description && (
              <p className="mt-0.5 break-words text-sm text-fg-muted">{description}</p>
            )}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-control text-fg-muted transition-colors hover:bg-surface-subtle hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        {actions && (
          <div className="shrink-0 border-b border-line px-5 py-3">{actions}</div>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
