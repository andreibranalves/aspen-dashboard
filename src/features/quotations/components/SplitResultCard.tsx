import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiGet } from '@/lib/api/api';
import type { DraftEdited, StoredAutoQuoteDraft } from '@/types/domain';
import {
  clientIdentityKey,
  lookupDraftClients,
  type ClientCandidate,
  type ClientMatchResult,
  type ClientSearchPage,
} from '@/features/quotations/clientMatching';
import SplitResultCardContent, { type SplitResultCardProps } from './SplitResultCardContent';

export type { SplitResultCardProps } from './SplitResultCardContent';

type LookupState =
  | { key: string; status: 'ready'; result: ClientMatchResult }
  | { key: string; status: 'error' };

const IDENTITY_FIELDS = new Set<keyof DraftEdited>(['nome', 'empresa', 'email', 'telefone', 'cnpj']);

/** Customer resolution belongs to the unsaved card, not to extraction or the
 * issuance/recovery flow. Keep the existing quotation view and actions intact. */
export default function SplitResultCard(props: SplitResultCardProps) {
  const { draft } = props;
  const stored = draft as StoredAutoQuoteDraft;
  const key = `${draft.index}:${stored.creationRequestId || ''}:${clientIdentityKey(draft.edited)}`;
  const busy = Boolean(props.isProcessing || props.isSavingDraft || props.editingBlocked);
  const durable = Boolean(
    stored.saved || stored.issue || props.issue || stored.issueIdempotencyKey
    || stored.issueDispatchStarted || stored.issueRecoveryRequired
    || stored.sourceQuotationId || stored.sourceRevisionId
    || draft.status === 'done',
  );
  const enabled = !durable && !draft.edited.client_id && Boolean(draft.edited.nome.trim());
  const [lookup, setLookup] = useState<LookupState | null>(null);
  const [newClientKey, setNewClientKey] = useState('');
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const current = useRef({ props, key, busy, durable });
  current.current = { props, key, busy, durable };

  const selectClient = useCallback((client: ClientCandidate) => {
    const latest = current.current;
    if (latest.busy || latest.durable || client.arquivado || client.archived) return;
    const { draft: target, onUpdateField } = latest.props;
    generation.current += 1;
    // Never reuse a demand selected for another client. The parent reloads the
    // available demands when client_id changes; an explicit new demand survives.
    if (target.edited.client_id !== client.id && target.edited.opportunity_id) {
      onUpdateField(target.index, 'opportunity_id', undefined);
    }
    // Show the same canonical contact that the existing-ID save path uses.
    // This links the quotation; it does not overwrite the customer's record.
    onUpdateField(target.index, 'nome', client.nome || target.edited.nome);
    onUpdateField(target.index, 'empresa', client.empresa || '');
    onUpdateField(target.index, 'email', client.email || '');
    onUpdateField(target.index, 'telefone', client.telefone || '');
    onUpdateField(target.index, 'cnpj', client.cnpj || '');
    onUpdateField(target.index, 'client_id', client.id);
    setNewClientKey('');
  }, []);

  useEffect(() => {
    if (!enabled || busy) return;
    const requestGeneration = ++generation.current;
    const identity = { ...draft.edited };
    const isCurrent = () => generation.current === requestGeneration
      && current.current.key === key && !current.current.busy && !current.current.durable;
    const timer = setTimeout(() => {
      void lookupDraftClients(identity, (term, page) => apiGet<ClientSearchPage>(
        `/leads-clients?status=all&limit=200&page=${page}&search=${encodeURIComponent(term)}`,
      ), isCurrent).then((result) => {
        if (!isCurrent()) return;
        setLookup({ key, status: 'ready', result });
        if (result.automatic) selectClient(result.automatic);
      }).catch(() => {
        if (isCurrent()) setLookup({ key, status: 'error' });
      });
    }, 300);
    return () => {
      clearTimeout(timer);
      generation.current += 1;
    };
    // The key includes every identity field. Product/pricing edits must not
    // restart the lookup or invalidate a deliberate same-name decision.
  }, [key, enabled, busy, retry, selectClient]);

  const updateField: SplitResultCardProps['onUpdateField'] = (index, field, value) => {
    if (busy) return;
    if (IDENTITY_FIELDS.has(field) && value !== draft.edited[field]) {
      generation.current += 1;
      setLookup(null);
      setNewClientKey('');
      if (draft.edited.client_id) {
        props.onUpdateField(index, 'client_id', undefined);
        if (draft.edited.opportunity_id) props.onUpdateField(index, 'opportunity_id', undefined);
      }
    }
    props.onUpdateField(index, field, value);
  };

  const checked = lookup?.key === key ? lookup : null;
  const result = checked?.status === 'ready' ? checked.result : null;
  const needsChoice = Boolean(result?.matches.length && newClientKey !== key);
  const clientBlockMessage = !enabled ? null
    : checked?.status === 'error' ? 'Não foi possível verificar o cliente. Tente novamente.'
      : !result ? 'Verificando cliente…'
        : needsChoice ? 'Selecione o cadastro do cliente antes de continuar.'
          : null;
  const blocked = Boolean(clientBlockMessage);
  const panel = !durable && (
    <section aria-label="Cadastro do cliente" className="space-y-2 text-xs">
      {draft.edited.client_id ? (
        <p role="status" className="font-medium text-primary">Cliente existente vinculado</p>
      ) : enabled ? (
        <>
          {!checked && <p role="status" className="text-fg-muted">Verificando cliente…</p>}
          {checked?.status === 'error' && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2">
              <span>Não foi possível verificar o cliente.</span>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => {
                setLookup(null);
                setRetry((value) => value + 1);
              }}>Tentar novamente</Button>
            </div>
          )}
          {result && (result.matches.length === 0 || newClientKey === key) ? (
            <p role="status" className="text-fg-muted">Novo cliente</p>
          ) : result && (
            <>
              <p className="font-medium text-fg">Cadastros encontrados</p>
              <ul className="max-h-48 space-y-2 overflow-y-auto" aria-label="Clientes encontrados">
                {result.matches.map(({ client, conflicting, archived }) => (
                  <li key={client.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-line p-2">
                    <div className="min-w-0 break-words">
                      <p className="font-medium text-fg">{client.nome}</p>
                      <p className="text-fg-muted">{[client.empresa, client.email, client.telefone, client.documento || client.cnpj].filter(Boolean).join(' · ')}</p>
                      {archived ? <p className="text-fg-muted">Arquivado — reative o cadastro em Clientes.</p>
                        : conflicting && <p className="text-fg-muted">Dados diferentes — confirme o cadastro correto.</p>}
                    </div>
                    {!archived && <Button type="button" variant="outline" size="sm" disabled={busy}
                      onClick={() => selectClient(client)}>Usar cadastro</Button>}
                  </li>
                ))}
              </ul>
              {result.canCreateNew && <Button type="button" variant="ghost" size="sm" disabled={busy}
                onClick={() => setNewClientKey(key)}>É outro cliente</Button>}
            </>
          )}
        </>
      ) : null}
    </section>
  );

  return <SplitResultCardContent
    {...props}
    onUpdateField={updateField}
    issueBlocked={Boolean(props.issueBlocked || blocked)}
    opportunityBlockMessage={clientBlockMessage || props.opportunityBlockMessage}
    opportunitySelector={<>{panel}{props.opportunitySelector && <div className={!durable ? 'mt-3' : undefined}>{props.opportunitySelector}</div>}</>}
    onCreateQuote={(index) => { if (!blocked) props.onCreateQuote(index); }}
    onReviewQuote={(index) => { if (!blocked) props.onReviewQuote(index); }}
    onApply={props.onApply ? () => { if (!blocked) props.onApply?.(); } : undefined}
  />;
}
