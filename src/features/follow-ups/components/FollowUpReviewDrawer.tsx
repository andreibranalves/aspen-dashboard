import { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { DetailDrawer } from '@/components/shared/DetailDrawer';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/badge';
import { useToast } from '@/components/shared/toast';
import {
  approveFollowUp,
  dismissFollowUp,
  type DismissReason,
  type FollowUpView,
} from '@/lib/api/followUpApi';
import { fmtPhone, formatBRL, formatDateTime } from '@/lib/formatting/formatters';

interface FollowUpReviewDrawerProps {
  followUp: FollowUpView | null;
  onClose: () => void;
  onChanged: () => void;
}

const DISMISS_OPTIONS: Array<{ value: DismissReason; label: string }> = [
  { value: 'already_handled', label: 'Já tratado' },
  { value: 'do_not_contact', label: 'Não contatar' },
  { value: 'no_continuity', label: 'Sem continuidade' },
  { value: 'wrong_contact', label: 'Contato incorreto' },
  { value: 'other', label: 'Outro' },
];

const STATE_LABELS: Record<string, string> = {
  ready: 'Pronto',
  waiting: 'Aguardando 24h',
  awaiting_receipt: 'Atenção',
  held: 'Atenção',
  approved: 'Aprovado',
  processing: 'Processando',
  sent: 'Enviado',
  cancelled: 'Cancelado',
  dismissed: 'Dispensado',
  needs_review: 'Atenção',
  failed: 'Falhou',
};

function defaultMessage(followUp: FollowUpView): string {
  const greeting = followUp.clientName.trim() ? `Olá, ${followUp.clientName.trim()}.` : 'Olá.';
  return `${greeting}\n\nPassando para saber se você teve a chance de ver o orçamento ${followUp.businessNumber}. Qualquer dúvida, estou à disposição.`;
}

function formatDate(value: string | null): string {
  if (!value) return 'Sem recibo';
  return Number.isNaN(new Date(value).getTime()) ? 'Data indisponível' : formatDateTime(value);
}

function toneForState(value: string): string {
  if (value === 'ready' || value === 'sent' || value === 'approved') return 'tone-success-soft';
  if (value === 'waiting' || value === 'processing') return 'tone-warning-soft';
  if (value === 'failed' || value === 'needs_review') return 'tone-destructive-soft';
  return 'tone-neutral-muted';
}

export default function FollowUpReviewDrawer({
  followUp,
  onClose,
  onChanged,
}: FollowUpReviewDrawerProps) {
  const { toast } = useToast();
  const [message, setMessage] = useState('');
  const [reason, setReason] = useState<DismissReason>('already_handled');
  const [pending, setPending] = useState<'approve' | 'dismiss' | null>(null);

  const canApprove = followUp?.state === 'ready';
  const canDismiss =
    followUp?.state === 'ready' ||
    followUp?.state === 'waiting' ||
    followUp?.state === 'held' ||
    followUp?.state === 'awaiting_receipt';
  const currentMessage = message;

  useEffect(() => {
    setMessage(followUp?.messageSnapshot || (followUp ? defaultMessage(followUp) : ''));
    setReason('already_handled');
  }, [
    followUp?.followUpId,
    followUp?.messageSnapshot,
    followUp?.clientName,
    followUp?.businessNumber,
  ]);
  async function handleApprove() {
    if (!followUp) return;
    setPending('approve');
    try {
      await approveFollowUp({
        quotationId: followUp.quotationId,
        eligibilityVersion: followUp.eligibilityVersion!,
        message: currentMessage,
      });
      toast('Follow-up aprovado.');
      onClose();
      onChanged();
    } catch (error) {
      toast(
        error instanceof Error ? error.message : 'Não foi possível aprovar o follow-up.',
        'error'
      );
    } finally {
      setPending(null);
    }
  }

  async function handleDismiss() {
    if (!followUp) return;
    setPending('dismiss');
    try {
      await dismissFollowUp({
        quotationId: followUp.quotationId,
        eligibilityVersion: followUp.eligibilityVersion || '',
        reason,
      });
      toast('Follow-up dispensado.');
      onClose();
      onChanged();
    } catch (error) {
      toast(
        error instanceof Error ? error.message : 'Não foi possível dispensar o follow-up.',
        'error'
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <DetailDrawer
      open={followUp !== null}
      onClose={onClose}
      title={followUp ? `Follow-up · ${followUp.businessNumber}` : 'Follow-up'}
      actions={
        followUp && canDismiss ? (
          <div className="flex flex-wrap gap-2">
            {canApprove && (
              <div className="flex flex-col items-end gap-1">
                <Button
                  type="button"
                  variant="success"
                  onClick={handleApprove}
                  disabled={pending !== null}
                >
                  <Check aria-hidden="true" />
                  {pending === 'approve' ? 'Aprovando…' : 'Aprovar e enviar retorno'}
                </Button>
                <span className="text-right text-xs text-fg-muted">
                  A aprovação autoriza o envio desta mensagem.
                </span>
              </div>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={handleDismiss}
              disabled={pending !== null}
            >
              <X aria-hidden="true" />
              {pending === 'dismiss' ? 'Dispensando…' : 'Dispensar'}
            </Button>
          </div>
        ) : null
      }
    >
      {followUp && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 rounded-control border border-line bg-surface-subtle p-3">
            <StatusBadge
              status={followUp.state}
              label={STATE_LABELS[followUp.state] || followUp.state}
              className={toneForState(followUp.state)}
            />
            <span className="text-sm text-fg-muted">{followUp.clientName}</span>
          </div>

          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-control border border-line bg-surface p-3">
              <dt className="text-xs text-fg-muted">Orçamento</dt>
              <dd className="break-words font-medium text-fg">{followUp.businessNumber}</dd>
            </div>
            <div className="rounded-control border border-line bg-surface p-3">
              <dt className="text-xs text-fg-muted">Valor</dt>
              <dd className="whitespace-nowrap font-medium tabular-nums text-fg">
                {formatBRL(followUp.amount)}
              </dd>
            </div>
            <div className="rounded-control border border-line bg-surface p-3">
              <dt className="text-xs text-fg-muted">Destino</dt>
              <dd className="whitespace-nowrap font-medium text-fg">
                {fmtPhone(followUp.canonicalPhone) || 'Telefone indisponível'}
              </dd>
            </div>
            <div className="rounded-control border border-line bg-surface p-3">
              <dt className="text-xs text-fg-muted">Motivo</dt>
              <dd className="font-medium text-fg">{followUp.reasonLabel}</dd>
            </div>
            <div className="rounded-control border border-line bg-surface p-3">
              <dt className="text-xs text-fg-muted">Recibo do provedor</dt>
              <dd className="font-medium text-fg">{formatDate(followUp.firstProviderReceiptAt)}</dd>
            </div>
            <div className="rounded-control border border-line bg-surface p-3">
              <dt className="text-xs text-fg-muted">Disponível em</dt>
              <dd className="font-medium text-fg">{formatDate(followUp.dueAt)}</dd>
            </div>
          </dl>

          <div className="space-y-2">
            <label htmlFor="follow-up-message" className="text-sm font-medium text-fg">
              Mensagem
            </label>
            <textarea
              id="follow-up-message"
              value={currentMessage}
              onChange={(event) => setMessage(event.target.value)}
              disabled={!canApprove || pending !== null}
              maxLength={4000}
              rows={7}
              className="flex w-full min-w-0 resize-y rounded-control border border-line bg-surface-subtle px-3 py-2 text-sm leading-5 text-fg placeholder:text-fg-muted disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          {canDismiss && (
            <div className="space-y-2">
              <label htmlFor="follow-up-dismiss-reason" className="text-sm font-medium text-fg">
                Motivo da dispensa
              </label>
              <Select
                id="follow-up-dismiss-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value as DismissReason)}
                disabled={pending !== null}
                containerClassName="w-full" className="w-full"
              >
                {DISMISS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>
      )}
    </DetailDrawer>
  );
}
