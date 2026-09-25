import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, ArchiveRestore, Eye, FileText, MoreHorizontal, ReceiptText, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MenuItem } from '@/components/ui/menu-item';

export interface CustomerActionMenuProps {
  archived: boolean;
  onArchiveToggle: () => void;
  customerName?: string;
  onDelete?: () => void;
  /** Abre a lista de orçamentos filtrada por este cliente. */
  onViewQuotations?: () => void;
  /** No celular as ações da linha vêm para o menu. */
  onNewQuotation?: () => void;
  onQuickView?: () => void;
}

/** Secondary customer actions stay available without competing with the name. */
export function CustomerActionMenu({
  archived,
  onArchiveToggle,
  customerName,
  onDelete,
  onViewQuotations,
  onNewQuotation,
  onQuickView,
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
    const handleFocusOut = (event: FocusEvent) => {
      const nextTarget = event.relatedTarget as Node | null;
      if (!menuRef.current?.contains(nextTarget) && !triggerRef.current?.contains(nextTarget)) {
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
    document.addEventListener('focusout', handleFocusOut);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('focusout', handleFocusOut);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [dismiss, open]);

  return (
    <div className="relative inline-block">
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost-muted"
        size="icon"
        aria-label={accessibleLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        title={accessibleLabel}
        onClick={() => setOpen((current) => !current)}
      >
        <MoreHorizontal aria-hidden="true" />
      </Button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={accessibleLabel}
          className="absolute right-0 top-full z-floating mt-1 min-w-44 rounded-control border border-line bg-surface p-1 shadow-lg"
        >
          {onNewQuotation && (
            <MenuItem ref={actionRef} role="menuitem" onClick={() => { dismiss(false); onNewQuotation(); }}>
              <ReceiptText aria-hidden="true" /> Novo orçamento
            </MenuItem>
          )}
          {onQuickView && (
            <MenuItem role="menuitem" onClick={() => { dismiss(false); onQuickView(); }}>
              <Eye aria-hidden="true" /> Visualização rápida
            </MenuItem>
          )}
          {onViewQuotations && (
            <MenuItem
              ref={onNewQuotation ? undefined : actionRef}
              role="menuitem"
              onClick={() => {
                dismiss(false);
                onViewQuotations();
              }}
            >
              <FileText aria-hidden="true" /> Ver orçamentos
            </MenuItem>
          )}
          <MenuItem
            ref={onViewQuotations ? undefined : actionRef}
            role="menuitem"
            onClick={() => {
              dismiss(true);
              onArchiveToggle();
            }}
          >
            <Icon aria-hidden="true" />
            {actionLabel}
          </MenuItem>
          {onDelete && (
            <MenuItem role="menuitem" tone="destructive" onClick={() => { dismiss(true); onDelete(); }}>
              <Trash2 aria-hidden="true" /> Excluir cliente
            </MenuItem>
          )}
        </div>
      )}
    </div>
  );
}
