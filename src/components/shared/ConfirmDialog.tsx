import { useRef } from 'react';
import { AlertTriangle, CircleHelp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

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

/**
 * Confirmation built on the shared Dialog. Focus starts on Cancel so a stray
 * Enter never confirms a destructive action.
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
  const cancelRef = useRef<HTMLButtonElement>(null);
  const destructive = variant === 'destructive';
  const Icon = destructive ? AlertTriangle : CircleHelp;

  return (
    <Dialog
      open={open}
      onClose={() => onCancel?.()}
      title={title}
      description={message}
      initialFocusRef={cancelRef}
      icon={
        <span
          className={`grid size-10 shrink-0 place-items-center rounded-full ${destructive ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary-text'}`}
        >
          <Icon size={20} aria-hidden="true" />
        </span>
      }
      footer={
        <>
          <Button ref={cancelRef} type="button" variant="outline" onClick={() => onCancel?.()}>
            {cancelLabel}
          </Button>
          <Button type="button" variant={destructive ? 'destructive' : 'default'} onClick={() => onConfirm?.()}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
