import { and, asc, desc, eq, gte, isNull, lt, ne } from 'drizzle-orm';

import type { AppDatabase } from '../client.js';
import { crmDeals, quotations, quoteLeads, quoteRevisions, salesOrders } from '../schema.js';

export type QuotationOriginStatus = 'linked' | 'missing' | 'conflict';

export interface QuotationOriginProjection {
  status: QuotationOriginStatus;
  source: string | null;
  sourceLabel: string;
  quotationNumber: string | null;
  salesOrderNumber: string | null;
  reason: string | null;
}

export interface ReadQuotationOriginInput {
  quotationId: string;
  salesOrderId?: string | null;
  quotationRevisionId?: string | null;
}

export interface QuotationOriginCandidate {
  quotationId: string;
  quotationNumber: string;
  quoteLeadId: string;
  reasons: Array<'email_normalized' | 'phone_normalized'>;
  distanceSeconds: number;
}

type QuotationOriginDatabase = AppDatabase | Parameters<Parameters<AppDatabase['transaction']>[0]>[0];

function sourceLabel(source: string): string {
  if (source === 'site_form') return 'Formulário do site';
  if (source === 'whatsapp') return 'WhatsApp';
  if (source === 'typebot') return 'Typebot';
  return source || 'Origem registrada';
}

function missing(
  quotationNumber: string | null,
  salesOrderNumber: string | null,
  reason: string,
): QuotationOriginProjection {
  return {
    status: 'missing',
    source: null,
    sourceLabel: 'Origem ausente',
    quotationNumber,
    salesOrderNumber,
    reason,
  };
}

function conflict(
  quotationNumber: string | null,
  salesOrderNumber: string | null,
  reason: string,
): QuotationOriginProjection {
  return {
    status: 'conflict',
    source: null,
    sourceLabel: 'Origem conflitante',
    quotationNumber,
    salesOrderNumber,
    reason,
  };
}

/**
 * Resolves the durable quotation origin without using mutable contact fields.
 * A singular lead/deal pointer may move to a newer quotation and therefore is
 * deliberately not used as the authority for historical origin.
 */
export async function readQuotationOrigin(
  database: QuotationOriginDatabase,
  input: ReadQuotationOriginInput,
): Promise<QuotationOriginProjection> {
  const [quotation] = await database
    .select({
      id: quotations.id,
      businessNumber: quotations.businessNumber,
      quoteLeadId: quotations.quoteLeadId,
    })
    .from(quotations)
    .where(eq(quotations.id, input.quotationId))
    .limit(1);
  if (!quotation) return missing(null, null, 'quotation_missing');

  const orders = await database
    .select({
      id: salesOrders.id,
      orderNumber: salesOrders.orderNumber,
      quotationId: salesOrders.quotationId,
      quotationRevisionId: salesOrders.quotationRevisionId,
    })
    .from(salesOrders)
    .where(
      and(
        eq(salesOrders.quotationId, quotation.id),
        ne(salesOrders.status, 'Cancelled'),
      ),
    )
    .orderBy(desc(salesOrders.createdAt))
    .limit(2);
  const [requestedOrder] = input.salesOrderId
    ? await database
        .select({
          id: salesOrders.id,
          orderNumber: salesOrders.orderNumber,
          quotationId: salesOrders.quotationId,
          quotationRevisionId: salesOrders.quotationRevisionId,
        })
        .from(salesOrders)
        .where(eq(salesOrders.id, input.salesOrderId))
        .limit(1)
    : [];
  const selectedOrder = requestedOrder || orders[0] || null;

  if (orders.length > 1) {
    return conflict(quotation.businessNumber, selectedOrder?.orderNumber || null, 'multiple_active_orders');
  }
  if (input.salesOrderId && !requestedOrder) {
    return conflict(quotation.businessNumber, null, 'sales_order_missing');
  }
  if (selectedOrder && selectedOrder.quotationId !== quotation.id) {
    return conflict(quotation.businessNumber, selectedOrder.orderNumber, 'order_quotation_conflict');
  }

  if (selectedOrder && !selectedOrder.quotationRevisionId) {
    return conflict(quotation.businessNumber, selectedOrder.orderNumber, 'order_revision_missing');
  }
  if (
    selectedOrder &&
    input.quotationRevisionId &&
    input.quotationRevisionId !== selectedOrder.quotationRevisionId
  ) {
    return conflict(quotation.businessNumber, selectedOrder.orderNumber, 'order_revision_conflict');
  }
  const revisionId = input.quotationRevisionId || selectedOrder?.quotationRevisionId || null;
  if (revisionId) {
    const [revision] = await database
      .select({ quotationId: quoteRevisions.quotationId, status: quoteRevisions.status })
      .from(quoteRevisions)
      .where(eq(quoteRevisions.id, revisionId))
      .limit(1);
    if (!revision || revision.quotationId !== quotation.id || (selectedOrder && revision.status !== 'aprovado')) {
      return conflict(
        quotation.businessNumber,
        selectedOrder?.orderNumber || null,
        'order_revision_conflict',
      );
    }
  }

  if (!quotation.quoteLeadId) {
    return missing(
      quotation.businessNumber,
      selectedOrder?.orderNumber || null,
      'quotation_origin_missing',
    );
  }
  const [lead] = await database
    .select({ source: quoteLeads.source, crmDealId: quoteLeads.crmDealId })
    .from(quoteLeads)
    .where(eq(quoteLeads.id, quotation.quoteLeadId))
    .limit(1);
  if (!lead) {
    return missing(
      quotation.businessNumber,
      selectedOrder?.orderNumber || null,
      'quote_lead_missing',
    );
  }
  if (lead.crmDealId) {
    const [deal] = await database
      .select({ quoteLeadId: crmDeals.quoteLeadId })
      .from(crmDeals)
      .where(eq(crmDeals.id, lead.crmDealId))
      .limit(1);
    if (!deal || deal.quoteLeadId !== quotation.quoteLeadId) {
      return conflict(
        quotation.businessNumber,
        selectedOrder?.orderNumber || null,
        'deal_origin_conflict',
      );
    }
  }
  return {
    status: 'linked',
    source: lead.source,
    sourceLabel: sourceLabel(lead.source),
    quotationNumber: quotation.businessNumber,
    salesOrderNumber: selectedOrder?.orderNumber || null,
    reason: null,
  };
}

function normalizedEmail(value: string | null): string {
  return (value || '').trim().toLowerCase();
}

function normalizedPhone(value: string | null): string {
  return (value || '').replace(/\D/g, '');
}

/** Read-only investigation aid. Every plausible row is returned; none is selected or written. */
export async function listQuotationOriginCandidates(
  database: QuotationOriginDatabase,
  input: { from: Date; to: Date; windowDays: number },
): Promise<QuotationOriginCandidate[]> {
  const windowMs = input.windowDays * 24 * 60 * 60 * 1000;
  const quotationRows = await database
    .select({
      id: quotations.id,
      businessNumber: quotations.businessNumber,
      createdAt: quotations.createdAt,
      revisionEmail: quoteRevisions.clienteEmail,
      revisionPhone: quoteRevisions.clienteTelefone,
      revisionVersion: quoteRevisions.version,
    })
    .from(quotations)
    .innerJoin(quoteRevisions, eq(quoteRevisions.quotationId, quotations.id))
    .where(
      and(
        isNull(quotations.quoteLeadId),
        gte(quotations.createdAt, input.from),
        lt(quotations.createdAt, input.to),
      ),
    )
    .orderBy(asc(quotations.id), desc(quoteRevisions.version))
    .limit(10_000);
  const latest = new Map<string, (typeof quotationRows)[number]>();
  for (const row of quotationRows) if (!latest.has(row.id)) latest.set(row.id, row);
  const leadRows = await database
    .select({
      id: quoteLeads.id,
      email: quoteLeads.email,
      telefone: quoteLeads.telefone,
      createdAt: quoteLeads.createdAt,
    })
    .from(quoteLeads)
    .where(
      and(
        gte(quoteLeads.createdAt, new Date(input.from.getTime() - windowMs)),
        lt(quoteLeads.createdAt, new Date(input.to.getTime() + windowMs)),
      ),
    )
    .orderBy(asc(quoteLeads.createdAt), asc(quoteLeads.id))
    .limit(10_000);
  const candidates: QuotationOriginCandidate[] = [];
  for (const quotation of latest.values()) {
    for (const lead of leadRows) {
      const distanceMs = Math.abs(quotation.createdAt.getTime() - lead.createdAt.getTime());
      if (distanceMs > windowMs) continue;
      const reasons: QuotationOriginCandidate['reasons'] = [];
      const email = normalizedEmail(quotation.revisionEmail);
      const phone = normalizedPhone(quotation.revisionPhone);
      if (email && email === normalizedEmail(lead.email)) reasons.push('email_normalized');
      if (phone && phone === normalizedPhone(lead.telefone)) reasons.push('phone_normalized');
      if (reasons.length) {
        candidates.push({
          quotationId: quotation.id,
          quotationNumber: quotation.businessNumber,
          quoteLeadId: lead.id,
          reasons,
          distanceSeconds: Math.floor(distanceMs / 1000),
        });
      }
    }
  }
  return candidates;
}
