import { Clipboard, PlusCircle, Send } from 'lucide-react';
import type { DragEvent, MouseEvent } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import DealProposals from '@/features/crm/components/DealProposals';
import { fmtPhone } from '@/lib/formatting/formatters';

export function daysAgo(dateStr?: string | null): string {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '—';
  const diff = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return 'hoje';
  if (diff === 1) return '1 dia';
  return `${diff} dias`;
}

export interface KanbanDealCardData {
  id: string;
  email?: string;
  telefone?: string;
  quotation?: string;
  quotation_id?: string | null;
  quote_lead_id?: string | null;
  follow_up_stage?: number;
}

export interface KanbanDealCardProps {
  deal: KanbanDealCardData;
  leadName: string;
  /** Rota de drill-down do lead; null desativa o link. */
  href: string | null;
  stageName: string;
  /** Data resolvida da última atualização (modificado_em || criado_em). */
  lastUpdate?: string | null;
  moving: boolean;
  dragging: boolean;
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
  onStartQuotation?: (deal: KanbanDealCardData, leadName: string) => void;
  onDragStart?: (event: DragEvent<HTMLElement>) => void;
  onDragEnd?: () => void;
}

/**
 * KanbanDealCard — card de oportunidade do pipeline.
 * Arrastável, com estados hover/dragging/moving e drill-down de lead e orçamento.
 */
export default function KanbanDealCard({
  deal,
  leadName,
  href,
  stageName,
  lastUpdate,
  moving,
  dragging,
  onNavigate,
  onStartQuotation,
  onDragStart,
  onDragEnd,
}: KanbanDealCardProps) {
  const leadClickable = Boolean(href && leadName && leadName !== 'Sem nome');
  const quotationHref = deal.quotation_id ? `#/quotations/${deal.quotation_id}` : null;

  return (
    <article
      draggable={!moving}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      aria-label={`Negócio ${leadName}. Etapa: ${stageName}.`}
      className={cn(
        'rounded-lg border border-line bg-surface p-3 transition-all',
        'hover:border-border-strong hover:shadow-level-2',
        dragging && 'cursor-grabbing opacity-50'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        {leadClickable ? (
          <a
            href={href || '#'}
            onClick={(event) => href && onNavigate?.(event, href)}
            className="min-w-0 text-left text-sm font-medium text-fg hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
            aria-label={`Abrir lead ${leadName}`}
          >
            <span className="block truncate">{leadName}</span>
          </a>
        ) : (
          <h3 className="min-w-0 truncate text-sm font-medium">{leadName}</h3>
        )}
        {moving && <span className="shrink-0 text-xs text-fg-muted">Movendo…</span>}
      </div>
      {deal.email && <p className="mt-0.5 truncate text-xs text-fg-muted">{deal.email}</p>}
      {deal.telefone && (
        <p className="mt-0.5 truncate text-xs text-fg-muted">{fmtPhone(deal.telefone) || deal.telefone}</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {deal.quotation &&
          (quotationHref ? (
            <a
              href={quotationHref}
              onClick={(event) => onNavigate?.(event, quotationHref)}
              className="inline-flex items-center rounded px-1.5 py-0.5 text-xs text-primary transition-colors hover:bg-primary/10"
              aria-label={`Abrir orçamento ${deal.quotation}`}
            >
              <Clipboard size={12} className="mr-1" aria-hidden="true" />
              {deal.quotation}
            </a>
          ) : (
            <span
              className="inline-flex items-center rounded px-1.5 py-0.5 text-xs text-primary"
              aria-label={`Orçamento ${deal.quotation}`}
            >
              <Clipboard size={12} className="mr-1" aria-hidden="true" />
              {deal.quotation}
            </span>
          ))}
        {Number(deal.follow_up_stage) > 0 && (
          <span className="inline-flex items-center rounded bg-surface-muted px-1.5 py-0.5 text-xs text-fg">
            <Send size={12} className="mr-1" aria-hidden="true" />
            Follow-up {deal.follow_up_stage}
          </span>
        )}
        {lastUpdate && (
          <time
            dateTime={lastUpdate}
            className="text-xs text-fg-muted"
            title="Última atualização"
          >
            Atualizado {daysAgo(lastUpdate)}
          </time>
        )}
      </div>
      <DealProposals opportunityId={deal.id} />
      {deal.quote_lead_id && onStartQuotation && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 w-full"
          onClick={() => onStartQuotation(deal, leadName)}
        >
          <PlusCircle />
          Novo orçamento
        </Button>
      )}
    </article>
  );
}
