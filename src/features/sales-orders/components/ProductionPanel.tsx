import { useCallback, useState, type ReactNode } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Heading } from '@/components/ui/heading';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { MoneyInput } from '@/components/ui/money-input';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/ui/badge';
import { useToast } from '@/components/shared/toast';
import { formatBRL, formatDateTime } from '@/lib/formatting/formatters';
import {
  ADVANCE_LABELS,
  PRODUCTION_STAGE_LABELS,
  applyProductionAction,
  needsAttention,
  stageReached,
  type ProductionAction,
  type ProductionOrder,
  type SalesOrderNote,
} from '@/features/sales-orders/production';
import {
  AdvanceStageDialog,
  DeadlineBar,
  actionErrorMessage,
  useAdvanceStage,
} from './ProductionControls';

type UpdateFields = Omit<Extract<ProductionAction, { action: 'update' }>, 'action'>;

/** Campo salvo ao sair dele, quando o valor mudou e é válido. */
function EditableField({
  label,
  type,
  value,
  onSave,
  min,
  max,
  step,
  clearable = false,
  disabled = false,
}: {
  label: string;
  type: 'date' | 'number';
  value: string;
  onSave: (value: string) => Promise<void>;
  min?: number;
  max?: number;
  step?: string;
  clearable?: boolean;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [source, setSource] = useState(value);
  if (source !== value) {
    setSource(value);
    setDraft(value);
  }
  const commit = () => {
    if (draft === value || (!draft && !clearable)) {
      setDraft(value);
      return;
    }
    void onSave(draft).catch(() => setDraft(value));
  };
  return (
    <Field label={label}>
      <Input
        type={type}
        value={draft}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </Field>
  );
}

/** Campo de dinheiro salvo ao sair do campo, em pt-BR (1.234,56). */
function EditableMoneyField({
  label,
  value,
  onSave,
  disabled = false,
}: {
  label: string;
  value: number | null;
  onSave: (value: number) => Promise<void>;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [source, setSource] = useState(value);
  if (source !== value) {
    setSource(value);
    setDraft(value);
  }
  const commit = () => {
    if (draft === value || draft === null) {
      setDraft(value);
      return;
    }
    void onSave(Math.round(draft * 100) / 100).catch(() => setDraft(value));
  };
  return (
    <Field label={label}>
      <MoneyInput
        value={draft}
        disabled={disabled}
        onValueChange={setDraft}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </Field>
  );
}

export function ProductionSection({
  order,
  readOnly,
  onChanged,
}: {
  order: ProductionOrder;
  readOnly: boolean;
  onChanged: (result: unknown) => void;
}) {
  const { toast } = useToast();
  const [advancing, setAdvancing] = useState<ProductionOrder | null>(null);
  const advance = useAdvanceStage(onChanged);
  const stage = order.production_stage;

  const update = useCallback(
    async (fields: UpdateFields) => {
      try {
        onChanged(await applyProductionAction(order.id, { action: 'update', ...fields }));
      } catch (cause) {
        toast(actionErrorMessage(cause, 'Não foi possível salvar a data.'), 'error');
        throw cause;
      }
    },
    [onChanged, order.id, toast]
  );

  const reached = (target: Parameters<typeof stageReached>[1]) => stageReached(stage, target);
  const artApproved = Boolean(order.art_approved_on);

  return (
    <section className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5" aria-labelledby="sales-order-production-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Heading level="section" id="sales-order-production-title">Produção</Heading>
          <StatusBadge
            status={stage}
            label={PRODUCTION_STAGE_LABELS[stage]}
            tone={
              order.production.state === 'atrasado'
                ? 'tone-destructive-soft'
                : needsAttention(order.production.state)
                  ? 'tone-warning-soft'
                  : stage === 'entregue'
                    ? 'tone-success-soft'
                    : 'tone-primary-soft'
            }
          />
        </div>
        {stage !== 'entregue' && !readOnly && (
          <Button variant="outline" onClick={() => setAdvancing(order)}>
            {ADVANCE_LABELS[stage]}
          </Button>
        )}
      </div>
      <DeadlineBar order={order} />
      <p className="text-sm tabular-nums">
        Recebido {formatBRL(order.received_amount)} de {formatBRL(order.grand_total)}
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {reached('aguardando_arte') && (
          <>
            <EditableField
              label="Entrada recebida"
              type="date"
              value={order.deposit_received_on || ''}
              disabled={readOnly}
              onSave={(value) => update({ deposit_received_on: value })}
            />
            <EditableMoneyField
              label="Valor da entrada (R$)"
              value={order.deposit_amount}
              disabled={readOnly}
              onSave={(value) => update({ deposit_amount: value })}
            />
          </>
        )}
        <EditableField
          label="Saldo recebido"
          type="date"
          clearable
          value={order.balance_received_on || ''}
          disabled={readOnly}
          onSave={(value) => update({ balance_received_on: value || null })}
        />
        {reached('em_producao') && (
          <EditableField
            label="Arte aprovada"
            type="date"
            value={order.art_approved_on || ''}
            disabled={readOnly}
            onSave={(value) => update({ art_approved_on: value })}
          />
        )}
        <EditableField
          label="Prazo de produção (dias úteis)"
          type="number"
          min={1}
          max={365}
          step="1"
          value={String(order.production_days)}
          disabled={readOnly}
          onSave={(value) => update({ production_days: Number(value) })}
        />
        {artApproved && (
          <div className="grid gap-1.5">
            <EditableField
              label={order.deadline_manual ? 'Prazo final (manual)' : 'Prazo final'}
              type="date"
              value={order.production.deadline || ''}
              disabled={readOnly}
              onSave={(value) => update({ deadline: value })}
            />
            {order.deadline_manual && !readOnly && (
              <Button variant="link" size="inline" className="justify-self-start" onClick={() => void update({ deadline: null }).catch(() => undefined)}>
                Recalcular pelo prazo de produção
              </Button>
            )}
          </div>
        )}
        {reached('pronto') && (
          <EditableField
            label="Pronto"
            type="date"
            value={order.ready_on || ''}
            disabled={readOnly}
            onSave={(value) => update({ ready_on: value })}
          />
        )}
        {reached('entregue') && (
          <EditableField
            label="Entregue"
            type="date"
            value={order.delivered_on || ''}
            disabled={readOnly}
            onSave={(value) => update({ delivered_on: value })}
          />
        )}
      </div>
      <AdvanceStageDialog order={advancing} onClose={() => setAdvancing(null)} onAdvance={advance} />
    </section>
  );
}

function NoteRow({
  note,
  onAction,
}: {
  note: SalesOrderNote;
  onAction: (action: ProductionAction) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  let body: ReactNode = <p className="whitespace-pre-wrap text-sm">{note.body}</p>;
  if (editing) {
    body = (
      <div className="grid gap-2">
        <Textarea value={draft} rows={3} maxLength={4000} onChange={(event) => setDraft(event.target.value)} aria-label="Editar anotação" />
        <div className="flex gap-2">
          <Button
            disabled={!draft.trim()}
            onClick={() =>
              void onAction({ action: 'edit_note', note_id: note.id, body: draft }).then((ok) => ok && setEditing(false))
            }
          >
            Salvar
          </Button>
          <Button variant="outline" onClick={() => { setDraft(note.body); setEditing(false); }}>
            Cancelar
          </Button>
        </div>
      </div>
    );
  }
  return (
    <li className="grid gap-1 border-l border-line pl-4">
      <div className="flex items-center justify-between gap-2 text-xs text-fg-muted">
        <span>{formatDateTime(note.created_at)}{note.kind === 'stage' ? ' · Etapa' : ''}</span>
        {note.kind === 'note' && !editing && (
          <span className="flex gap-1">
            <Button variant="ghost-muted" size="icon" aria-label="Editar anotação" onClick={() => setEditing(true)}>
              <Pencil aria-hidden="true" />
            </Button>
            <Button
              variant="ghost-muted-destructive"
              size="icon"
              aria-label="Excluir anotação"
              onClick={() => void onAction({ action: 'delete_note', note_id: note.id })}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </span>
        )}
      </div>
      {body}
    </li>
  );
}

export function NotesSection({
  orderId,
  notes,
  onChanged,
}: {
  orderId: string;
  notes: SalesOrderNote[];
  onChanged: (result: unknown) => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const run = useCallback(
    async (action: ProductionAction): Promise<boolean> => {
      setSaving(true);
      try {
        onChanged(await applyProductionAction(orderId, action));
        return true;
      } catch (cause) {
        toast(actionErrorMessage(cause, 'Não foi possível salvar a anotação.'), 'error');
        return false;
      } finally {
        setSaving(false);
      }
    },
    [onChanged, orderId, toast]
  );

  return (
    <section className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5" aria-labelledby="sales-order-notes-title">
      <Heading level="section" id="sales-order-notes-title">Anotações</Heading>
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!draft.trim()) return;
          void run({ action: 'add_note', body: draft }).then((ok) => ok && setDraft(''));
        }}
      >
        <Textarea
          value={draft}
          rows={2}
          maxLength={4000}
          onChange={(event) => setDraft(event.target.value)}
          aria-label="Nova anotação"
        />
        <Button type="submit" className="justify-self-end" disabled={saving || !draft.trim()}>
          Adicionar
        </Button>
      </form>
      {notes.length > 0 && (
        <ol className="grid gap-4">
          {notes.map((note) => (
            <NoteRow key={`${note.id}-${note.updated_at}`} note={note} onAction={run} />
          ))}
        </ol>
      )}
    </section>
  );
}

