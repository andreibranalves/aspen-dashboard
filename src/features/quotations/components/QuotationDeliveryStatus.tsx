import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  projectDelivery,
  type DeliveryResolution,
  type DeliveryView,
} from '@/lib/api/quotationDeliveryApi';
import { formatDateTime } from '@/lib/formatting/formatters';

export interface QuotationDeliveryStatusProps {
  delivery: DeliveryView | null;
  pending?: boolean;
  hideStatusLabel?: boolean;
  onResolve?: (decision: DeliveryResolution, note: string) => void | Promise<void>;
  className?: string;
}

function formatProgress(delivery: DeliveryView): string {
  const { delivered, total } = delivery.progress;
  if (total === 0) return 'Nenhuma etapa configurada';
  return `Etapas entregues: ${delivered} de ${total}`;
}

export function QuotationDeliveryStatus({
  delivery,
  pending = false,
  hideStatusLabel = false,
  onResolve,
  className,
}: QuotationDeliveryStatusProps) {
  const titleId = useId();
  const noteId = useId();
  const [decision, setDecision] = useState<DeliveryResolution | null>(null);
  const [note, setNote] = useState('');
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !decision) return;
    if (!dialog.open) dialog.showModal();
    noteRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [decision]);

  if (!delivery && !pending) return null;

  const projection = delivery ? projectDelivery(delivery) : null;
  const delayed = projection?.delayed === true;
  const canResolve = Boolean(delivery && !pending && projection?.requiresAction && onResolve);
  const statusLabel = pending && !delivery ? 'Enviando' : projection?.label || 'Enviando';
  const statusTone =
    delivery?.state === 'failed' || delivery?.state === 'needs_review'
      ? 'text-destructive'
      : delivery?.state === 'delivered'
        ? 'text-success'
        : 'text-fg';
  const progressLabel = delivery ? formatProgress(delivery) : null;

  const openDialog = (nextDecision: DeliveryResolution) => {
    const activeElement = document.activeElement;
    previousFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null;
    setDecision(nextDecision);
    setNote('');
    setDialogError(null);
  };

  const resetDialog = () => {
    setDecision(null);
    setNote('');
    setDialogError(null);
    const previousFocus = previousFocusRef.current;
    previousFocusRef.current = null;
    if (previousFocus && document.contains(previousFocus)) previousFocus.focus();
  };

  const closeDialog = () => {
    if (submitting) return;
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
    else resetDialog();
  };

  const submitResolution = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!decision || !onResolve) return;
    const normalizedNote = note.trim();
    const hasControl = [...normalizedNote].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    });
    if (normalizedNote.length < 3 || normalizedNote.length > 500 || hasControl) {
      setDialogError('Informe uma justificativa entre 3 e 500 caracteres.');
      return;
    }
    setSubmitting(true);
    setDialogError(null);
    try {
      await onResolve(decision, normalizedNote);
      closeDialog();
    } catch {
      setDialogError('Não foi possível resolver a entrega. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className={cn('space-y-2 text-xs', className)}>
      {!hideStatusLabel && (
        <div
          role="status"
          aria-live="polite"
          aria-busy={pending}
          aria-label={`Status da entrega: ${statusLabel}`}
          className={cn('flex flex-wrap items-center gap-x-3 gap-y-1', statusTone)}
        >
          <strong>{statusLabel}</strong>
          {progressLabel && <span className="text-fg-muted">{progressLabel}</span>}
        </div>
      )}
      {delivery && (
        <div className="space-y-1 text-fg-muted">
          <p>Última atualização: {formatDateTime(delivery.updatedAt) || '—'}</p>
          {delivery.publicError && <p className="text-destructive">{delivery.publicError}</p>}
          {delayed && (
            <p className="text-warning">
              A aceitação do provedor está atrasada. Confirme o recebimento antes de reenviar.
            </p>
          )}
        </div>
      )}
      {canResolve && delivery && (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => openDialog('confirmed_received')}
          >
            Cliente confirmou recebimento
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => openDialog('confirmed_not_received')}
          >
            Confirmado que não recebeu, reenviar
          </Button>
        </div>
      )}
      {decision && (
        <dialog
          ref={dialogRef}
          aria-modal="true"
          aria-labelledby={titleId}
          onCancel={(event) => {
            event.preventDefault();
            closeDialog();
          }}
          onClose={resetDialog}
          className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-md overflow-y-auto rounded-lg border border-line bg-surface p-0 text-fg shadow-xl backdrop:bg-black/40"
        >
          <form onSubmit={submitResolution} className="space-y-4 p-5">
            <div>
              <h2 id={titleId} className="text-base font-semibold">
                Confirmar resolução
              </h2>
              <p className="mt-1 text-xs leading-5 text-fg-muted">
                {decision === 'confirmed_received'
                  ? 'Confirme que o cliente recebeu a mensagem.'
                  : 'Confirme que o cliente não recebeu. Uma nova tentativa pode gerar duplicidade.'}
              </p>
            </div>
            <label className="block space-y-1" htmlFor={noteId}>
              <span className="font-medium">Justificativa</span>
              <textarea
                ref={noteRef}
                id={noteId}
                aria-label="Justificativa"
                minLength={3}
                maxLength={500}
                required
                rows={4}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                disabled={submitting}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page"
              />
            </label>
            {dialogError && (
              <p role="alert" className="text-destructive">
                {dialogError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={closeDialog} disabled={submitting}>
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={
                  submitting ||
                  note.trim().length < 3 ||
                  note.trim().length > 500 ||
                  [...note].some((character) => {
                    const code = character.charCodeAt(0);
                    return code <= 0x1f || code === 0x7f;
                  })
                }
              >
                {submitting ? 'Confirmando…' : 'Confirmar resolução'}
              </Button>
            </div>
          </form>
        </dialog>
      )}
    </section>
  );
}

export default QuotationDeliveryStatus;
