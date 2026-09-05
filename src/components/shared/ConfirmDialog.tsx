import { useEffect, useId, useRef } from 'react';
import { AlertTriangle, CircleHelp, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'destructive' | 'default';
  onConfirm?: () => void;
  onCancel?: () => void;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

/**
 * Reusable confirmation dialog with the Aspen modal accessibility contract.
 * The invoking element receives focus again after cancel, confirm or Escape.
 */
export default function ConfirmDialog({
  open,
  title = 'Confirmar ação',
  message = 'Tem certeza que deseja prosseguir?',
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  variant = 'destructive',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const DialogIcon = variant === 'destructive' ? AlertTriangle : CircleHelp;
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const onCancelRef = useRef(onCancel);
  const onConfirmRef = useRef(onConfirm);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    onCancelRef.current = onCancel;
    onConfirmRef.current = onConfirm;
  }, [onCancel, onConfirm]);

  useEffect(() => {
    if (!open) return undefined;

    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();

    const dialog = dialogRef.current;
    const handleKeyDown = (event: KeyboardEvent) => {
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));
      if (dialogs.at(-1) !== dialog) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCancelRef.current?.();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const handleFocusIn = (event: FocusEvent) => {
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));
      if (dialogs.at(-1) !== dialog) return;
      if (dialog && !dialog.contains(event.target as Node)) cancelRef.current?.focus();
    };

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('focusin', handleFocusIn);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('focusin', handleFocusIn);
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={(event) => {
          if (event.target === event.currentTarget) onCancelRef.current?.();
        }}
        aria-hidden="true"
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="relative w-full max-w-md rounded-lg border border-line bg-surface p-6 shadow-2xl"
      >
        <div className="flex items-start gap-4">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
              variant === 'destructive' ? 'bg-destructive/10' : 'bg-primary/10'
            }`}
          >
            <DialogIcon
              size={20}
              className={variant === 'destructive' ? 'text-destructive' : 'text-primary'}
              aria-hidden="true"
            />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-semibold text-fg">
              {title}
            </h2>
            <p id={descriptionId} className="mt-2 text-sm text-fg-muted">
              {message}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onCancelRef.current?.()}
            aria-label="Fechar"
            className="min-h-9 min-w-9 shrink-0 rounded-sm p-1.5 text-fg-muted hover:bg-surface-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <Button
            ref={cancelRef}
            type="button"
            variant="outline"
            onClick={() => onCancelRef.current?.()}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={variant === 'destructive' ? 'destructive' : 'default'}
            onClick={() => onConfirmRef.current?.()}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
