import { useId, useRef, useState, type FormEvent } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
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
  hideUpdatedAt?: boolean;
  onResolve?: (decision: DeliveryResolution, note: string) => void | Promise<void>;
  className?: string;
}

function formatProgress(delivery: DeliveryView): string {
  const { accepted, delivered, total } = delivery.progress;
  if (total === 0) return 'Nenhuma etapa configurada';
  return `Aceitas pelo WhatsApp: ${accepted} de ${total} - Confirmadas como entregues: ${delivered} de ${total}`;
}

export function QuotationDeliveryStatus({
  delivery,
  pending = false,
  hideStatusLabel = false,
  hideUpdatedAt = false,
  onResolve,
  className,
}: QuotationDeliveryStatusProps) {
  const noteId = useId();
  const formId = useId();
  const [decision, setDecision] = useState<DeliveryResolution | null>(null);
  const [note, setNote] = useState('');
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  if (!delivery && !pending) return null;

  const projection = delivery ? projectDelivery(delivery) : null;
  const delayed = projection?.delayed === true;
  const canResolve = Boolean(delivery && !pending && projection?.requiresAction && onResolve);
  const canRetrySameRevision = Boolean(
    delivery && !pending && projection?.canRetrySameRevision && onResolve
  );
  const statusLabel = pending && !delivery ? 'Enviando' : projection?.label || 'Enviando';
  const statusTone =
    delivery?.state === 'failed' || delivery?.state === 'needs_review'
      ? 'text-destructive'
      : delivery?.state === 'delivered'
        ? 'text-success'
        : 'text-fg';
  const progressLabel = delivery ? formatProgress(delivery) : null;

  const openDialog = (nextDecision: DeliveryResolution) => {
    setDecision(nextDecision);
    setNote('');
    setDialogError(null);
  };

  const resetDialog = () => {
    setDecision(null);
    setNote('');
    setDialogError(null);
  };

  const closeDialog = () => {
    if (submitting) return;
    resetDialog();
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
          {!hideUpdatedAt && <p>Última atualização: {formatDateTime(delivery.updatedAt) || '—'}</p>}
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
            variant="outline"
            onClick={() => openDialog('confirmed_received')}
          >
            Cliente confirmou recebimento
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => openDialog('confirmed_not_received')}
          >
            Confirmado que não recebeu, reenviar
          </Button>
        </div>
      )}
      {canRetrySameRevision && delivery && (
        <div className="pt-1">
          <Button
            type="button"
            variant="outline"
            onClick={() => openDialog('retry_same_revision')}
          >
            Reenviar a mesma revisão
          </Button>
        </div>
      )}
      <Dialog
        open={decision !== null}
        onClose={closeDialog}
        dismissible={!submitting}
        initialFocusRef={noteRef}
        title={decision === 'retry_same_revision' ? 'Confirmar reenvio' : 'Confirmar resolução'}
        description={
          decision === 'confirmed_received'
                  ? 'Confirme que o cliente recebeu as mensagens já enviadas. O restante não enviado continua na fila.'
                  : decision === 'retry_same_revision'
                    ? 'Somente a etapa comprovadamente não enviada volta para a fila. O reenvio da mesma revisão depende do worker.'
                    : 'Confirme que o cliente não recebeu. Uma nova tentativa pode gerar duplicidade.'
        }
        footer={
          <>
              <Button type="button" variant="ghost" onClick={closeDialog} disabled={submitting}>
                Cancelar
              </Button>
              <Button
                type="submit"
                form={formId}
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
                {submitting
                  ? 'Confirmando…'
                  : decision === 'retry_same_revision'
                    ? 'Reenviar mesma revisão'
                    : 'Confirmar resolução'}
              </Button>
          </>
        }
      >
        <form id={formId} onSubmit={submitResolution} className="space-y-4 text-sm">
          <label className="flex flex-col gap-1" htmlFor={noteId}>
            <span className="font-medium">Justificativa</span>
            <Textarea
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
            />
          </label>
          {dialogError && (
            <p role="alert" className="text-destructive">
              {dialogError}
            </p>
          )}
        </form>
      </Dialog>
    </section>
  );
}

export default QuotationDeliveryStatus;
