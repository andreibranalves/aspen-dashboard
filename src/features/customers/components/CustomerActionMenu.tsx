import { useCallback, useEffect, useRef, useState } from 'react';
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  const dismiss = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    actionRef.current?.focus();
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        dismiss(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        dismiss(true);
        return;
      }
      if (event.key === 'Tab' && !menuRef.current?.contains(event.target as Node)) {
        dismiss(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [dismiss, open]);

  return (
    <div className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        aria-label={accessibleLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        title={accessibleLabel}
        onClick={() => setOpen((current) => !current)}
        className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-sm text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page"
      >
        <MoreHorizontal className="size-4" aria-hidden="true" />
        <span className="sr-only">{accessibleLabel}</span>
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={accessibleLabel}
          className="absolute right-0 top-full z-20 mt-1 min-w-44 rounded-md border border-line bg-surface p-1 shadow-lg"
        >
          <button
            ref={actionRef}
            type="button"
            role="menuitem"
            onClick={() => {
              dismiss(true);
              onArchiveToggle();
            }}
            className="flex min-h-9 w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm text-fg transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Icon className="size-4" aria-hidden="true" />
            {actionLabel}
          </button>
        </div>
      )}
    </div>
  );
}
