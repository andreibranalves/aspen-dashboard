import { normalizeWhatsappPhone } from './whatsapp-conversations-store.js';
import type {
  PreparedQuotationDelivery,
  QuotationDeliveryState,
} from '../infrastructure/db/repositories/quotation-delivery-repository.js';

const MAX_FLOW_DURATION_MS = 45_000;
const MAX_PUBLIC_LINK_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface DeliverQuotationStep {
  type?: unknown;
  kind?: unknown;
  source?: unknown;
  generatedMedia?: unknown;
}

export interface DeliverQuotationInput {
  revisionId: string;
  phone: string;
  flowId: string;
  steps: DeliverQuotationStep[];
  maxDelayMs: number;
}

export interface DeliveryResult {
  status: 'completed' | 'retryable' | 'reconciling' | 'accepted_partial';
  message: string;
  publicLink?: string;
}

export interface DeliverQuotationDependencies {
  now?: () => Date;
  evolutionConfigured: () => boolean;
  prepareDelivery(input: { revisionId: string; phone: string; flowId: string }): Promise<PreparedQuotationDelivery>;
  issuePublicLink(input: { revisionId: string; expiresInSeconds: number }): Promise<{ url: string; expiresInSeconds?: number }>;
  reserveTransport(input: { revisionId: string; flowId: string; stepsCount: number }): Promise<{ kind: 'reserved' | 'existing' }>;
  recordState(input: {
    revisionId: string;
    state: QuotationDeliveryState;
    providerAcceptanceId?: string;
    publicError?: string;
  }): Promise<unknown>;
  transport(input: {
    revisionId: string;
    phone: string;
    flowId: string;
    steps: DeliverQuotationStep[];
    pdf: Buffer;
    publicLink: string;
  }): Promise<{ accepted: boolean; acceptanceId?: string }>;
}

function quotationPdfStep(step: DeliverQuotationStep): boolean {
  return (step.type === 'document' || step.kind === 'document')
    && (step.source === 'quotation_pdf' || step.generatedMedia === 'quotation_pdf');
}

function inputText(value: unknown, label: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} obrigatório.`);
  return normalized;
}

async function bestEffortState(
  dependencies: DeliverQuotationDependencies,
  revisionId: string,
  state: QuotationDeliveryState,
  publicError?: string,
): Promise<void> {
  try {
    await dependencies.recordState({ revisionId, state, publicError });
  } catch {
    // The caller still receives the original safe error. State uncertainty after
    // provider acceptance is handled explicitly as reconciling below.
  }
}

export function createDeliverQuotation(dependencies: DeliverQuotationDependencies) {
  const now = dependencies.now || (() => new Date());
  return async function deliverQuotation(input: DeliverQuotationInput): Promise<DeliveryResult> {
    const revisionId = inputText(input?.revisionId, 'Revisão');
    const phone = normalizeWhatsappPhone(input?.phone);
    if (!phone) throw new Error('Telefone do destinatário inválido.');
    const flowId = inputText(input?.flowId, 'Fluxo');
    const steps = Array.isArray(input?.steps) ? input.steps : [];
    if (steps.filter(quotationPdfStep).length !== 1) {
      throw new Error('O fluxo deve conter exatamente um PDF do orçamento.');
    }
    if (!Number.isFinite(input.maxDelayMs) || input.maxDelayMs < 0 || input.maxDelayMs > MAX_FLOW_DURATION_MS) {
      throw new Error('O fluxo deve caber no limite de 45 segundos.');
    }
    if (!dependencies.evolutionConfigured()) throw new Error('Integração do WhatsApp não configurada.');

    let prepared: PreparedQuotationDelivery;
    try {
      prepared = await dependencies.prepareDelivery({ revisionId, phone, flowId });
    } catch (error) {
      if (error instanceof Error && /PDF/i.test(error.message)) {
        await bestEffortState(dependencies, revisionId, 'retryable', 'PDF indisponível. Tentar novamente.');
      }
      throw error;
    }
    if (!Buffer.isBuffer(prepared.pdf) || prepared.pdf.length === 0) {
      await bestEffortState(dependencies, revisionId, 'retryable', 'PDF indisponível. Tentar novamente.');
      throw new Error('PDF indisponível. Tentar novamente.');
    }
    const ttlSeconds = Math.min(
      MAX_PUBLIC_LINK_TTL_SECONDS,
      Math.floor((prepared.validUntil.getTime() - now().getTime()) / 1000),
    );
    if (ttlSeconds <= 0) throw new Error('A revisão do orçamento está vencida. Emita uma nova revisão.');

    const link = await dependencies.issuePublicLink({ revisionId, expiresInSeconds: ttlSeconds });
    const reservation = await dependencies.reserveTransport({ revisionId, flowId, stepsCount: steps.length });
    if (reservation.kind !== 'reserved') throw new Error('O envio permanece em reconciliação. Não reenvie automaticamente.');
    await dependencies.recordState({ revisionId, state: 'pending' });
    await dependencies.recordState({ revisionId, state: 'transporting' });

    let outcome: { accepted: boolean; acceptanceId?: string };
    try {
      outcome = await dependencies.transport({ revisionId, phone: prepared.delivery.phone, flowId, steps, pdf: prepared.pdf, publicLink: link.url });
    } catch (error) {
      await bestEffortState(dependencies, revisionId, 'retryable', error instanceof Error ? error.message : 'Falha antes da aceitação do transporte.');
      throw error;
    }
    if (!outcome.accepted) {
      await bestEffortState(dependencies, revisionId, 'retryable', 'O provedor não aceitou o transporte.');
      throw new Error('O provedor não aceitou o transporte. Tente novamente.');
    }
    try {
      await dependencies.recordState({
        revisionId,
        state: 'accepted_partial',
        providerAcceptanceId: outcome.acceptanceId,
      });
      await dependencies.recordState({
        revisionId,
        state: 'completed',
        providerAcceptanceId: outcome.acceptanceId,
      });
    } catch {
      await bestEffortState(dependencies, revisionId, 'reconciling', 'O transporte pode ter sido aceito. Reconciliação necessária.');
      throw new Error('O transporte pode ter sido aceito. Reconciliação necessária. Não reenvie automaticamente.');
    }
    return { status: 'completed', message: 'Envio aceito.', publicLink: link.url };
  };
}

export function deliverQuotation(
  input: DeliverQuotationInput,
  dependencies: DeliverQuotationDependencies,
): Promise<DeliveryResult> {
  return createDeliverQuotation(dependencies)(input);
}
