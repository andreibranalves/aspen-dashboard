import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ExportMenuProps {
  /** Id do painel, ligado ao botão por aria-controls. */
  id: string;
  /** Opções de exportação, normalmente ExportCsvButton com `className="w-full justify-start"`. */
  children: ReactNode;
}

/** ExportMenu — um único "Exportar" que abre as exportações da página. */
export default function ExportMenu({ id, children }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const dismiss = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    const frame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
    });
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        dismiss(false);
      }
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      dismiss(true);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [dismiss, open]);

  return (
    <div className="relative">
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((current) => !current)}
      >
        Exportar <ChevronDown aria-hidden="true" />
      </Button>
      <div
        ref={menuRef}
        id={id}
        hidden={!open}
        aria-label="Exportar dados"
        className={`absolute right-0 top-full z-floating mt-2 w-60 max-w-[calc(100vw-2rem)] flex-col gap-1 rounded-control border border-line bg-surface p-2 shadow-lg ${open ? 'flex' : 'hidden'}`}
      >
        {children}
      </div>
    </div>
  );
}
