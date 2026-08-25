import { useRef } from 'react';
import { Archive, ArchiveRestore, MoreHorizontal } from 'lucide-react';

export interface CustomerActionMenuProps {
  archived: boolean;
  onArchiveToggle: () => void;
  customerName?: string;
}

/** Secondary customer actions stay available without competing with the name. */
export function CustomerActionMenu({
  archived,
  onArchiveToggle,
  customerName,
}: CustomerActionMenuProps) {
  const actionLabel = archived ? 'Restaurar cliente' : 'Arquivar cliente';
  const accessibleLabel = `Mais ações${customerName ? ` para ${customerName}` : ''}`;
  const Icon = archived ? ArchiveRestore : Archive;
  const summaryRef = useRef<HTMLElement>(null);

  return (
    <details className="group relative inline-block">
      <summary
        ref={summaryRef}
        role="button"
        aria-label={accessibleLabel}
        aria-haspopup="menu"
        title={accessibleLabel}
        className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-sm text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page [&::-webkit-details-marker]:hidden"
      >
        <MoreHorizontal className="size-4" aria-hidden="true" />
        <span className="sr-only">{accessibleLabel}</span>
      </summary>
      <div
        role="menu"
        aria-label={accessibleLabel}
        className="absolute right-0 top-full z-20 mt-1 min-w-44 rounded-md border border-line bg-surface p-1 shadow-lg"
      >
        <button
          type="button"
          role="menuitem"
          onClick={(event) => {
            event.currentTarget.closest('details')?.removeAttribute('open');
            summaryRef.current?.focus();
            onArchiveToggle();
          }}
          className="flex min-h-9 w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm text-fg transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Icon className="size-4" aria-hidden="true" />
          {actionLabel}
        </button>
      </div>
    </details>
  );
}
