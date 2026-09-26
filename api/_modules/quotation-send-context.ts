// Contexto comercial de um envio por WhatsApp, resolvido a partir da revisão
// PostgreSQL: cliente, telefone, link público e negócio do CRM.

import { createHttpError } from '../_shared/http-error.js';
import {
  createQuotationTemplateRepository,
  type QuotationTemplateSnapshot,
} from '../_infrastructure/db/repositories/quotation-template-repository.js';
import { renderQuotationDocument, type QuotationDocumentRenderer } from './quotation-document.js';
import { issuePublicQuotationToken, type PublicQuotationDependencies } from './public-quotation.js';
import { createPostgresCrmDealRepository, type CrmDealRecord } from '../_infrastructure/db/repositories/crm-deals-repository.js';

type QuotationSnapshotRepository = ReturnType<typeof createQuotationTemplateRepository>;
type PublicQuotationStore = NonNullable<PublicQuotationDependencies['store']>;
type LocalDealResolver = (quotationId: string, businessNumber: string) => Promise<CrmDealRecord | null>;

export type QuotationSendContext = {
  snapshot: QuotationTemplateSnapshot;
  view: ReturnType<typeof renderQuotationDocument>['viewModel'];
  quotation: Record<string, unknown>;
  dealId: string | null;
  quotationUuid: string;
  revisionId: string;
  businessNumber: string;
  nome: string;
  email: string;
  telefone: string;
  phone: string;
  publicLink: string;
};

function normalizePhone(phone: unknown): string {
  if (!phone) return '';
  let digits = String(phone).replace(/\D/g, '');
  digits = digits.replace(/^55(\d{10,11})$/, '$1').replace(/^0(\d{10,11})$/, '$1');
  if (!/^\d{10,11}$/.test(digits)) return '';
  return `55${digits}`;
}

async function defaultLocalDealResolver(
  quotationId: string,
  businessNumber: string,
): Promise<CrmDealRecord | null> {
  if (!process.env.DATABASE_URL) return null;
  try {
    const deals = await createPostgresCrmDealRepository().list({ search: businessNumber, limit: 500 });
    return deals.find(
      (deal) =>
        deal.quotationId === quotationId ||
        deal.quotation === businessNumber ||
        deal.quotationId === businessNumber,
    ) || null;
  } catch {
    return null;
  }
}

export async function loadQuotationSendContext(input: {
  quotationId: string;
  revisionId: string;
  businessNumber?: string;
  recipientPhone?: unknown;
  baseUrl: string;
  repository: QuotationSnapshotRepository;
  store?: PublicQuotationStore;
  token?: () => string;
  renderDocument?: QuotationDocumentRenderer;
  resolveDeal?: LocalDealResolver;
}): Promise<QuotationSendContext> {
  const quotationId = String(input.quotationId || '').trim();
  const revisionId = String(input.revisionId || '').trim();
  const businessNumber = String(input.businessNumber || '').trim();
  if (!quotationId) throw createHttpError(400, 'Cotação PostgreSQL é obrigatória.');
  if (!revisionId) throw createHttpError(400, 'Revisão PostgreSQL do orçamento é obrigatória.');

  const snapshot = await input.repository.get(revisionId);
  if (!snapshot || snapshot.revision.id !== revisionId) {
    throw createHttpError(404, 'Orçamento PostgreSQL não encontrado.');
  }
  const requestedQuotationMatches =
    quotationId === snapshot.quotation.id || quotationId === snapshot.quotation.businessNumber;
  if (!requestedQuotationMatches) {
    throw createHttpError(409, 'A cotação não corresponde à revisão PostgreSQL informada.');
  }
  if (businessNumber && businessNumber !== snapshot.quotation.businessNumber) {
    throw createHttpError(409, 'O número do orçamento não corresponde à revisão PostgreSQL informada.');
  }

  let document: ReturnType<QuotationDocumentRenderer>;
  try {
    document = (input.renderDocument || renderQuotationDocument)(snapshot);
  } catch {
    throw createHttpError(503, 'Não foi possível preparar o documento do orçamento.');
  }
  const view = document.viewModel;
  const client = view.client as unknown as Record<string, unknown>;
  const telefone = String(client.phone || client.telefone || '').trim();
  const phone = normalizePhone(telefone);
  if (!phone) throw createHttpError(400, 'A cotação não possui telefone válido para envio via WhatsApp.');
  if (input.recipientPhone != null && normalizePhone(input.recipientPhone) !== phone) {
    throw createHttpError(400, 'O telefone informado não pertence à cotação PostgreSQL.');
  }

  let token;
  try {
    token = await issuePublicQuotationToken({
      revisionId,
      repository: input.repository,
      store: input.store,
      token: input.token,
    });
  } catch (error) {
    if (error instanceof Error && /rascunho|compartilh/i.test(error.message)) {
      throw createHttpError(409, 'A cotação não está disponível para envio.');
    }
    throw createHttpError(503, 'Não foi possível preparar o link público do orçamento.');
  }

  const canonicalBusinessNumber = snapshot.quotation.businessNumber;
  const resolveDeal = input.resolveDeal || defaultLocalDealResolver;
  const deal = await resolveDeal(snapshot.quotation.id, canonicalBusinessNumber);
  return {
    snapshot,
    view,
    quotation: { items: view.items },
    dealId: deal?.id || null,
    quotationUuid: snapshot.quotation.id,
    revisionId,
    businessNumber: canonicalBusinessNumber,
    nome: String(client.name || client.nome || ''),
    email: String(client.email || ''),
    telefone,
    phone,
    publicLink: `${input.baseUrl}/api/public-quotation?token=${encodeURIComponent(token.token)}`,
  };
}
