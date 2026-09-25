import { useCallback, useState, type CSSProperties } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { MoneyInput } from '@/components/ui/money-input';
import { useToast } from '@/components/shared/toast';
import { formatBRL } from '@/lib/formatting/formatters';
import { cn } from '@/lib/utils';
import {
  ADVANCE_LABELS,
  DEADLINE_STATE_LABELS,
  PRODUCTION_STAGE_LABELS,
  applyProductionAction,
  defaultDeposit,
  nextStage,
  saldoOpen,
  todaySaoPaulo,
  type ProductionOrder,
} from '@/features/sales-orders/production';

export function formatCivilDate(value: string | null | undefined): string {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '—';
}

/** Mensagem do servidor (já em português e sem detalhe interno) ou o texto padrão. */
export function actionErrorMessage(cause: unknown, fallback: string): string {
  const message = (cause as { data?: { error?: unknown } })?.data?.error;
  return typeof message === 'string' && message ? message : fallback;
}

const BAR_TONES = {
  sem_prazo: 'bg-surface-muted',
  no_prazo: 'bg-primary',
  em_risco: 'bg-warning',
  atrasado: 'bg-destructive',
  concluido: 'bg-success',
} as const;

const LABEL_TONES = {
  sem_prazo: 'text-fg-muted',
  no_prazo: 'text-fg-muted',
  em_risco: 'text-warning',
  atrasado: 'text-destructive',
  concluido: 'text-success',
} as const;

/** Barra do prazo final: dias úteis consumidos sobre o prazo de produção. */
export function DeadlineBar({ order }: { order: ProductionOrder }) {
  const { production } = order;
  if (!production.deadline || !production.total_days) {
    if (production.stalled_days === null) return null;
    return (
      <p className="text-xs text-fg-muted">
        Parado há {production.stalled_days} {production.stalled_days === 1 ? 'dia' : 'dias'}
      </p>
    );
  }
  const elapsed = production.elapsed_days ?? 0;
  const width = Math.min(100, Math.round((elapsed / production.total_days) * 100));
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className={cn('font-medium', LABEL_TONES[production.state])}>
          {DEADLINE_STATE_LABELS[production.state]}
        </span>
        <span className="tabular-nums text-fg-muted">
          {elapsed}/{production.total_days} · {formatCivilDate(production.deadline)}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-surface-muted"
        role="progressbar"
        aria-label="Prazo de produção consumido"
        aria-valuemin={0}
        aria-valuemax={production.total_days}
        aria-valuenow={Math.min(elapsed, production.total_days)}
      >
        <div
          className={cn('h-full w-(--progress-w) rounded-full', BAR_TONES[production.state])}
          style={{ '--progress-w': `${width}%` } as CSSProperties}
        />
      </div>
    </div>
  );
}

interface AdvanceResult {
  notes?: Array<{ id: string; kind: string }>;
}

/**
 * Avança a etapa e oferece Desfazer no toast. `onChanged` recebe a resposta
 * do servidor depois do avanço e depois do desfazer.
 */
export function useAdvanceStage(onChanged: (result: unknown) => void) {
  const { toast } = useToast();
  return useCallback(
    async (order: ProductionOrder, date: string, depositAmount?: number) => {
      const target = nextStage(order.production_stage);
      if (!target) return;
      const result = await applyProductionAction<AdvanceResult>(order.id, {
        action: 'advance',
        expected_stage: order.production_stage,
        date,
        ...(depositAmount === undefined ? {} : { deposit_amount: depositAmount }),
      });
      onChanged(result);
      const noteId = result.notes?.find((note) => note.kind === 'stage')?.id;
      toast(
        `${order.order_number} em ${PRODUCTION_STAGE_LABELS[target]}.`,
        'success',
        noteId
          ? {
              label: 'Desfazer',
              onClick: () => {
                applyProductionAction(order.id, { action: 'undo', note_id: noteId })
                  .then(onChanged)
                  .catch(() => toast('Não foi possível desfazer a mudança.', 'error'));
              },
            }
          : undefined
      );
    },
    [onChanged, toast]
  );
}

interface AdvanceStageDialogProps {
  order: ProductionOrder | null;
  onClose: () => void;
  onAdvance: (order: ProductionOrder, date: string, depositAmount?: number) => Promise<void>;
}

export function AdvanceStageDialog({ order, onClose, onAdvance }: AdvanceStageDialogProps) {
  const [date, setDate] = useState(todaySaoPaulo);
  const [deposit, setDeposit] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openFor, setOpenFor] = useState<string | null>(null);

  if (order && openFor !== order.id) {
    setOpenFor(order.id);
    setDate(todaySaoPaulo());
    setDeposit(defaultDeposit(order.grand_total));
    setError(null);
  }
  if (!order && openFor !== null) setOpenFor(null);

  const stage = order?.production_stage;
  const asksDeposit = stage === 'aguardando_entrada';
  const delivering = stage === 'pronto';
  const depositValue = deposit ?? Number.NaN;
  const depositInvalid =
    asksDeposit && (!Number.isFinite(depositValue) || depositValue < 0 || depositValue > (order?.grand_total ?? 0));

  const submit = async () => {
    if (!order || !date || depositInvalid) return;
    setSaving(true);
    setError(null);
    try {
      await onAdvance(order, date, asksDeposit ? Math.round(depositValue * 100) / 100 : undefined);
      onClose();
    } catch (cause) {
      setError(actionErrorMessage(cause, 'Não foi possível mudar a etapa.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={Boolean(order)}
      onClose={onClose}
      dismissible={!saving}
      title={order && stage ? `${ADVANCE_LABELS[stage]} · ${order.order_number}` : ''}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form="advance-stage-form" disabled={saving || !date || depositInvalid}>
            {order && stage ? `Mover para ${PRODUCTION_STAGE_LABELS[nextStage(stage)!]}` : 'Mover'}
          </Button>
        </>
      }
    >
      <form
        id="advance-stage-form"
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label="Data">
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
        </Field>
        {asksDeposit && (
          <Field label="Valor da entrada (R$)" error={depositInvalid ? 'Informe um valor entre zero e o total do pedido.' : undefined}>
            <MoneyInput value={deposit} onValueChange={setDeposit} />
          </Field>
        )}
        {delivering && order && saldoOpen(order) && (
          <p className="flex items-start gap-2 text-sm text-warning" role="status">
            <AlertTriangle size={16} className="shrink-0" aria-hidden="true" />
            Saldo em aberto: recebido {formatBRL(order.received_amount)} de {formatBRL(order.grand_total)}.
          </p>
        )}
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
