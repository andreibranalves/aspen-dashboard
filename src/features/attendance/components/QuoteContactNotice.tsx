import InlineAlert from '@/components/shared/InlineAlert';
import { Button } from '@/components/ui/button';
import { fmtPhone } from '@/lib/formatting/formatters';
import type { AtendimentoContact } from '@/lib/api/atendimentoQuoteDraftApi';

/** Name (written or from the WhatsApp profile), e-mail and phone are known. */
export function contactComplete(contact: AtendimentoContact): boolean {
  return Boolean((contact.name || contact.profileName) && contact.email && contact.phone);
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-16 shrink-0 text-fg-muted">{label}</dt>
      <dd className="min-w-0 break-words text-fg">{value}</dd>
    </div>
  );
}

export default function QuoteContactNotice({ contact, pending, onContinue, onDismiss }: {
  contact: AtendimentoContact;
  pending: boolean;
  onContinue: () => void;
  onDismiss: () => void;
}) {
  const unread = contact.modelUnavailable ? 'Leitura indisponível' : 'Não encontrado na conversa';
  return (
    <InlineAlert tone="warning" className="m-2" title="Dados do cliente incompletos">
      <div className="space-y-2">
        <dl className="space-y-1">
          <Row label="Nome" value={contact.name?.value || contact.profileName || unread} />
          {contact.company && <Row label="Empresa" value={contact.company.value} />}
          <Row label="E-mail" value={contact.email?.value || 'Não encontrado na conversa'} />
          <Row label="Telefone" value={contact.phone ? fmtPhone(contact.phone) : 'Não identificado'} />
          <Row label="Pedido" value={contact.order?.text || unread} />
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
