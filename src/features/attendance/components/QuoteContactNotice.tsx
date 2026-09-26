import type { ReactNode } from 'react';
import InlineAlert from '@/components/shared/InlineAlert';
import { Button } from '@/components/ui/button';
import { fmtPhone } from '@/lib/formatting/formatters';
import type { AtendimentoContact, ContactEvidence } from '@/lib/api/atendimentoQuoteDraftApi';

const messageTime = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
});

/** The client sent a name, e-mail and phone the operator can trust. */
export function contactComplete(contact: AtendimentoContact): boolean {
  return Boolean(contact.name && contact.email && contact.phone);
}

function Row({ label, value, source }: { label: string; value: ReactNode; source?: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-16 shrink-0 text-fg-muted">{label}</dt>
      <dd className="min-w-0 break-words text-fg">
        {value}
        {source && <span className="text-xs text-fg-muted"> · {source}</span>}
      </dd>
    </div>
  );
}

function fromMessage(evidence: ContactEvidence) {
  return `mensagem de ${messageTime.format(new Date(evidence.at))}`;
}

export default function QuoteContactNotice({ contact, pending, onContinue, onDismiss }: {
  contact: AtendimentoContact;
  pending: boolean;
  onContinue: () => void;
  onDismiss: () => void;
}) {
  const missingName = contact.nameUnavailable ? 'Leitura do nome indisponível' : 'Não encontrado na conversa';
  return (
    <InlineAlert tone="warning" className="m-2" title="Dados do cliente incompletos">
      <div className="space-y-2">
        <dl className="space-y-1">
          {contact.name ? (
            <Row label="Nome" value={contact.name.value} source={fromMessage(contact.name)} />
          ) : (
            <Row label="Nome" value={missingName} source={contact.profileName && `perfil do WhatsApp: ${contact.profileName}`} />
          )}
          {contact.company && <Row label="Empresa" value={contact.company.value} source={fromMessage(contact.company)} />}
          {contact.email ? (
            <Row label="E-mail" value={contact.email.value} source={fromMessage(contact.email)} />
          ) : (
            <Row label="E-mail" value="Não encontrado na conversa" />
          )}
          {contact.phone ? (
            <Row label="Telefone" value={fmtPhone(contact.phone)} source="WhatsApp" />
          ) : (
            <Row label="Telefone" value="Não identificado" />
          )}
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button size="xs" disabled={pending} onClick={onContinue}>
            {pending ? 'Abrindo…' : 'Abrir orçamento assim'}
          </Button>
          <Button size="xs" variant="ghost" disabled={pending} onClick={onDismiss}>
            Fechar
          </Button>
        </div>
      </div>
    </InlineAlert>
  );
}
