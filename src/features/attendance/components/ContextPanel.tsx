import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import ErrorState from '@/components/shared/ErrorState';
import InlineAlert from '@/components/shared/InlineAlert';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SearchField } from '@/components/ui/search-field';
import LoadingSpinner from '@/features/attendance/components/LoadingSpinner';
import { fmtPhone, formatBRL, formatDate } from '@/lib/formatting/formatters';
import type { ApiError } from '@/lib/api/api';
import {
  fetchAttendanceContext,
  updateClientLink,
  type AttendanceContext,
  type ClientLinkInput,
  type ContextContact,
} from '@/lib/api/attendanceContextApi';
import { Heading } from '@/components/ui/heading';
import AiAssistantPanel from '@/features/attendance/components/AiAssistantPanel';

const SOURCE_LABELS: Record<NonNullable<AttendanceContext['matchSource']>, string> = {
  operator: 'Vinculado',
  phone: 'Pelo telefone',
  'phone-variant': 'Variação do telefone',
};

interface ContextPanelProps {
  conversationId: string;
  /** A new identity version re-reads the context. */
  identityVersion: number;
  onUseSuggestion: (text: string) => void;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function ContextPanel({ conversationId, identityVersion, onUseSuggestion }: ContextPanelProps) {
  const [context, setContext] = useState<AttendanceContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  // Only the latest request may paint: a slower answer for an older search
  // or an earlier link state is discarded.
  const request = useRef(0);

  const load = useCallback(
    async (term: string) => {
      const current = ++request.current;
      setError(null);
      try {
        const result = await fetchAttendanceContext(conversationId, term);
        if (current !== request.current) return;
        setContext(result);
        setSearching(term);
      } catch (loadError) {
        if (current !== request.current) return;
        setError(errorMessage(loadError, 'Não foi possível consultar o contexto comercial.'));
      }
    },
    [conversationId]
  );

  useEffect(() => {
    setContext(null);
    setSearch('');
    setNotice(null);
    void load('');
  }, [load, identityVersion]);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const term = search.trim();
    if (term.length === 1) return;
    setNotice(null);
    void load(term);
  };

  const changeLink = async (key: string, input: ClientLinkInput) => {
    const current = ++request.current;
    setPending(key);
    setNotice(null);
    try {
      const result = await updateClientLink(conversationId, input);
      if (current !== request.current) return;
      setContext(result);
      setSearch('');
      setSearching('');
    } catch (linkError) {
      if (current !== request.current) return;
      const data = (linkError as ApiError)?.data as { context?: AttendanceContext } | undefined;
      // A refused confirmation shows the current context, never the old view.
      if (data?.context) {
        setContext(data.context);
        setSearch('');
        setSearching('');
      }
      setNotice(errorMessage(linkError, 'Não foi possível atualizar o vínculo.'));
    } finally {
      if (current === request.current) setPending(null);
    }
  };

  const confirm = (candidate: ContextContact) =>
    void changeLink(candidate.id, {
      action: 'confirm',
      clientId: candidate.id,
      expectedVersion: context?.linking.version ?? null,
      expectedClientName: candidate.nome,
      expectedClientPhone: candidate.telefone,
    });

  const remove = () => {
    const version = context?.linking.version;
    if (version) void changeLink('remove', { action: 'remove', expectedVersion: version });
  };

  if (error && !context) {
    return (
      <ErrorState
        title="Contexto indisponível"
        description={error}
        onRetry={() => void load(searching)}
        variant="bare"
      />
    );
  }
  if (!context) {
    return <LoadingSpinner label="Carregando contexto" />;
  }

  const { linking } = context;
  const contact = context.match === 'matched' ? context.contact : null;
  const candidates = context.candidates || [];

  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-3 text-sm">
      {notice && <InlineAlert tone="warning">{notice}</InlineAlert>}
      {error && <InlineAlert tone="warning">{error}</InlineAlert>}

      {contact ? (
        <section className="space-y-1">
          <div className="flex items-start justify-between gap-2">
            <a href={context.actions?.openContact} className="min-w-0 font-semibold text-fg hover:underline">
              {contact.nome}
            </a>
            {context.matchSource && (
              <StatusBadge status={context.matchSource} label={SOURCE_LABELS[context.matchSource]} tone="tone-neutral-soft" />
            )}
          </div>
          {contact.telefone && <p className="text-fg-muted">{fmtPhone(contact.telefone)}</p>}
          {contact.email && <p className="truncate text-fg-muted">{contact.email}</p>}
        </section>
      ) : (
        context.reason && <p className="text-fg-muted">{context.reason}</p>
      )}

      {linking.version && (
        <Button variant="outline" className="self-start" disabled={Boolean(pending)} onClick={remove}>
          Desvincular
        </Button>
      )}

      {context.match === 'not_found' && context.actions?.createContact && (
        <a href={context.actions.createContact} className="text-link hover:underline">
          Cadastrar contato
        </a>
      )}

      {candidates.length > 0 && (
        <ul className="divide-y divide-border-subtle rounded-card border border-border-subtle">
          {candidates.map((candidate) => (
            <li key={`${candidate.tipo}:${candidate.id}`} className="flex items-center gap-2 p-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{candidate.nome}</p>
                <p className="truncate text-xs text-fg-muted">
                  {candidate.telefone ? fmtPhone(candidate.telefone) : candidate.email || (candidate.tipo === 'lead' ? 'Lead' : '')}
                </p>
              </div>
              {candidate.tipo === 'cliente' && linking.available && (
                <Button size="xs" variant="outline" disabled={Boolean(pending)} onClick={() => confirm(candidate)}>
                  Vincular
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {linking.available ? (
        <form onSubmit={submitSearch} className="flex gap-2">
          <SearchField
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar cliente"
            aria-label="Buscar cliente para vincular"
            maxLength={100}
            containerClassName="flex-1"
          />
          {searching && (
            <Button type="button" variant="ghost" onClick={() => void load('')}>
              Limpar
            </Button>
          )}
        </form>
      ) : (
        context.match !== 'matched' &&
        context.match !== 'conflict' && (
          <p className="text-fg-muted">Vínculo indisponível: conta do WhatsApp não identificada.</p>
        )
      )}

      {contact && (context.quotations?.length || 0) > 0 && (
        <section aria-label="Orçamentos" className="space-y-1">
          <Heading level="eyebrow">Orçamentos</Heading>
          <ul className="space-y-1">
            {context.quotations!.map((quotation) => (
              <li key={quotation.id} className="flex items-center justify-between gap-2">
                <a href={quotation.url} className="min-w-0 truncate text-link hover:underline">
                  {quotation.businessNumber}
                </a>
                <span className="shrink-0 text-xs text-fg-muted">
                  {quotation.status} · {formatDate(quotation.date)} · {formatBRL(quotation.total)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {contact && (context.deliveries?.length || 0) > 0 && (
        <section aria-label="Entregas" className="space-y-1">
          <Heading level="eyebrow">Entregas</Heading>
          <ul className="space-y-1">
            {context.deliveries!.map((delivery) => (
              <li key={delivery.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">{delivery.businessNumber}</span>
                <span className="shrink-0 text-xs text-fg-muted">
                  {delivery.status} · {formatDate(delivery.date)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <AiAssistantPanel conversationId={conversationId} onUseSuggestion={onUseSuggestion} />
    </div>
  );
}
