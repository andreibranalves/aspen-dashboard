import { useState } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtPhone } from '@/lib/formatting/formatters';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { Text } from '@/components/ui/text';
import type {
  ClientResolutionCandidate,
  ClientResolutionView,
} from '@/features/quotations/automaticClientResolution';

function clientResolutionAnnouncement(view: ClientResolutionView): string {
  switch (view.state) {
    case 'checking':
      return 'Verificando cliente…';
    case 'linked':
      return `Cliente já cadastrado: ${view.nome}`;
    case 'choice':
      return choiceHeading(view);
    case 'archived':
      return 'Cliente arquivado.';
    case 'new_client':
      return view.confirmed ? 'Novo cliente confirmado.' : 'Novo cliente.';
    case 'error':
      return 'Não foi possível verificar o cliente.';
    default:
      return '';
  }
}

/** Heading of a choice, in the operator's words: what was found and why it
 * needs a decision. */
function choiceHeading(view: Extract<ClientResolutionView, { state: 'choice' }>): string {
  const count = view.candidates.length;
  switch (view.reason) {
    case 'identifier_in_use': {
      if (count === 1) {
        const [candidate] = view.candidates;
        const field = candidate.matchedBy.includes('email') ? 'e-mail' : 'telefone';
        return `Este ${field} já está no cadastro de ${candidate.nome}.`;
      }
      return 'O e-mail e o telefone já estão em outros cadastros.';
    }
    case 'identifier_conflict':
      return 'Cadastro encontrado, mas com dados diferentes.';
    case 'weak_matches_only':
      return count === 1 ? 'Cliente com nome parecido.' : `${count} clientes com nome parecido.`;
    case 'archived_match':
      return 'Só há cadastros arquivados com estes dados.';
    default:
      return `${count} cadastros com estes dados.`;
  }
}

function sameDigits(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = (left ?? '').replace(/\D/g, '');
  const b = (right ?? '').replace(/\D/g, '');
  return a.length > 0 && a === b;
}

function sameEmail(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = (left ?? '').trim().toLowerCase();
  return a.length > 0 && a === (right ?? '').trim().toLowerCase();
}

/** One contact of a candidate, marked against what the draft says: equal (✓),
 * different (≠) or unknown on one side (plain). */
function CandidateContact({
  value,
  draftValue,
  same,
}: {
  value: string | null;
  draftValue?: string;
  same: boolean;
}) {
  if (!value) return null;
  const differs = Boolean(draftValue?.trim()) && !same;
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs', differs ? 'text-warning' : 'text-fg-muted')}>
      {same && <Check size={12} className="text-success" aria-label="igual ao pedido" />}
      {differs && <span aria-label="diferente do pedido">≠</span>}
      {value}
    </span>
  );
}

interface ClientResolutionProps {
  view: ClientResolutionView;
  draftIdx: number;
  disabled: boolean;
  onSelectClient?: (draftIdx: number, candidate: ClientResolutionCandidate) => void;
  onConfirmNewClient?: (draftIdx: number) => void;
  onRetryClientResolution?: (draftIdx: number) => void;
  onClearClientSelection?: (draftIdx: number) => void;
}

/** Settled identity, next to the client name: one badge and at most one action.
 * A pending choice renders in ClientResolutionChoice, below the header. */
export function ClientResolutionBadge({
  view,
  draftIdx,
  disabled,
  onConfirmNewClient,
  onRetryClientResolution,
  onClearClientSelection,
}: ClientResolutionProps) {
  if (view.state === 'idle') return null;
  return (
    <>
      <span className="sr-only" aria-live="polite">
        {clientResolutionAnnouncement(view)}
      </span>
      {view.state === 'checking' && (
        <StatusBadge status="checking" label="Verificando cliente…" tone="tone-neutral-soft" />
      )}
      {view.state === 'linked' && (
        <>
          <StatusBadge status="linked" label="Cliente cadastrado" tone="tone-neutral-soft" />
          <Button
            type="button"
            variant="ghost-muted"
            size="xs"
            disabled={disabled || !onClearClientSelection}
            onClick={() => onClearClientSelection?.(draftIdx)}
          >
            Trocar
          </Button>
        </>
      )}
      {view.state === 'new_client' && (
        <>
          <StatusBadge status="new_client" label="Novo cliente" tone="tone-success-soft" />
          {!view.confirmed && view.needsConfirmation && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={disabled || !onConfirmNewClient}
              onClick={() => onConfirmNewClient?.(draftIdx)}
            >
              Confirmar novo cliente
            </Button>
          )}
        </>
      )}
      {view.state === 'archived' && (
        <>
          <StatusBadge status="archived" label="Cadastro arquivado" tone="tone-warning-soft" />
          <Button type="button" variant="outline" size="xs" asChild>
            <a href={view.clientId ? `#/leads/cliente/${encodeURIComponent(view.clientId)}` : '#/leads'}>
              Abrir cadastro
            </a>
          </Button>
        </>
      )}
      {view.state === 'error' && (
        <>
          <StatusBadge status="error" label="Cliente não verificado" tone="tone-destructive-soft" />
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={disabled || !onRetryClientResolution}
            onClick={() => onRetryClientResolution?.(draftIdx)}
          >
            Tentar novamente
          </Button>
        </>
      )}
    </>
  );
}

const VISIBLE_CANDIDATES = 3;

/** Candidates the operator must choose between before saving. Every action is
 * a button, so the choice works by keyboard. */
export function ClientResolutionChoice({
  view,
  draftIdx,
  disabled,
  identity,
  onSelectClient,
  onConfirmNewClient,
}: ClientResolutionProps & {
  /** Contacts extracted for the draft, to mark each candidate's equal and different fields. */
  identity: { email?: string; telefone?: string };
}) {
  const [showAll, setShowAll] = useState(false);
  if (view.state !== 'choice') return null;
  const selectable = view.candidates.filter((candidate) => !candidate.arquivado);
  const visible = showAll ? selectable : selectable.slice(0, VISIBLE_CANDIDATES);
  const hidden = selectable.length - visible.length;

  return (
    <div className="flex flex-col gap-2 border-b border-line bg-surface-subtle px-5 py-4 md:px-6">
      <Text as="p" variant="title">{choiceHeading(view)}</Text>
      <ul className="divide-y divide-line overflow-hidden rounded-control border border-line bg-surface">
        {visible.map((candidate) => (
          <li key={candidate.id} className="flex items-center gap-3 px-3 py-2">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Text as="p" variant="title" truncate>
                {candidate.nome}
                {candidate.empresa && candidate.empresa !== candidate.nome && (
                  <span className="font-normal text-fg-muted"> · {candidate.empresa}</span>
                )}
              </Text>
              <div className="flex flex-wrap gap-x-3">
                <CandidateContact
                  value={candidate.email}
                  draftValue={identity.email}
                  same={sameEmail(candidate.email, identity.email)}
                />
                <CandidateContact
                  value={candidate.telefone ? fmtPhone(candidate.telefone) || candidate.telefone : null}
                  draftValue={identity.telefone}
                  same={sameDigits(candidate.telefone, identity.telefone)}
                />
                {candidate.documento && <Text variant="meta">{candidate.documento}</Text>}
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={disabled || !onSelectClient}
              onClick={() => onSelectClient?.(draftIdx, candidate)}
              aria-label={`Usar o cadastro de ${candidate.nome}`}
            >
              Usar
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        {hidden > 0 && (
          <Button type="button" variant="ghost" size="xs" onClick={() => setShowAll(true)}>
            Mostrar mais {hidden}
          </Button>
        )}
        {view.allowNewClient && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="ml-auto"
            disabled={disabled || !onConfirmNewClient}
            onClick={() => onConfirmNewClient?.(draftIdx)}
          >
            É outra pessoa: cadastrar novo
          </Button>
        )}
      </div>
    </div>
  );
}
