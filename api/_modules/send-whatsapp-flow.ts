// POST /api/send-whatsapp-flow
//
// Compatibility adapter for the durable quotation delivery outbox.
// Dry-run requests retain the existing planner response without transport.

import type { FunctionEvent, FunctionResult, JsonResponseFn } from '../_http/types.js';
import type { HttpError } from '../_shared/http-error.js';
import { createHttpError } from '../_shared/http-error.js';
import { createQuotationTemplateRepository } from '../_infrastructure/db/repositories/quotation-template-repository.js';
import { loadPostgresSendContext } from './send-whatsapp.js';
import { isRevisionBoundPublicQuotationUrl } from './public-quotation.js';
import {
  canonicalFlowQuotationId,
  createDeliveryPlan,
  detectCategories,
  flowProductSummary,
  type DeliveryPlan,
  type DeliveryPlanInput,
} from './quotation-delivery-plan.js';
import type { EvolutionTransportDependencies } from './evolution-transport.js';
import {
  createQuotationDeliveryModule,
  type QuotationDeliveryModule,
} from './quotation-delivery-outbox.js';
import { deliveryErrorResponse, toPublicDeliveryView } from './quotation-deliveries.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

const jsonResponse: JsonResponseFn = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

function firstNonEmpty(...values: unknown[]): string {
  const found = values.find((v) => typeof v === 'string' && v.trim());
  return typeof found === 'string' ? found.trim() : '';
}

function minimalLocalIdentifier(value: string, label: string): string {
  if (!value || value.length > 255 || value.includes('://')) {
    throw createHttpError(400, `${label} inválido.`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) throw createHttpError(400, `${label} inválido.`);
  }
  return value;
}

export { canonicalFlowQuotationId, createDeliveryPlan, flowProductSummary };

export function resolveServerIssuedPublicLink(
  postgresPath: boolean,
  serverIssuedLink: unknown,
  applicationOrigin: string,
): string {
  return postgresPath && isRevisionBoundPublicQuotationUrl(serverIssuedLink, applicationOrigin)
    ? serverIssuedLink
    : '';
}

function publicFrozenStep(step: DeliveryPlan['steps'][number]): Record<string, unknown> {
  if (step.type === 'text') return { type: 'text', text: step.payload.text };
  if (step.type === 'media') {
    const type = step.payload.mediaType === 'image' && /\.mp4$/i.test(step.payload.fileName)
      ? 'video'
      : step.payload.mediaType;
    return {
      type,
      media: step.payload.url,
      fileName: step.payload.fileName,
      caption: step.payload.caption,
    };
  }
  return {
    type: 'document',
    media: 'quotation_pdf',
    media_ref: 'quotation_pdf',
    generatedMedia: 'quotation_pdf',
    fileName: step.payload.fileName,
    caption: step.payload.caption,
  };
}

// ── Handler ─────────────────────────────────────────────────────────────────

export type SendWhatsappFlowDependencies = {
  repository?: ReturnType<typeof createQuotationTemplateRepository>;
  store?: Parameters<typeof loadPostgresSendContext>[0]['store'];
  token?: () => string;
  headBlob?: DeliveryPlanInput['headBlob'];
  blobToken?: string;
  blobStoreId?: string;
  renderPdf?: Parameters<typeof loadPostgresSendContext>[0]['renderPdf'];
  mediaRecords?: Array<Record<string, unknown>>;
  readMediaRecords?: () => Promise<Array<Record<string, unknown>>>;
  resolveDeal?: Parameters<typeof loadPostgresSendContext>[0]['resolveDeal'];
  resolveMedia?: DeliveryPlanInput['resolveMedia'];
  resolveFlow?: DeliveryPlanInput['resolveFlow'];
  transport?: EvolutionTransportDependencies;
  deliveryModule?: QuotationDeliveryModule;
};

export async function handler(
  event: FunctionEvent,
  dependencies: SendWhatsappFlowDependencies = {},
): Promise<FunctionResult> {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Método não permitido.' });

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(event.body || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object');
    payload = parsed;
  } catch {
    return jsonResponse(400, { error: 'JSON inválido.' });
  }

  const flowResolver = dependencies.resolveFlow;
  try {
    const dryRun = payload.dry_run === true || payload.dryRun === true;
    const rawFlowId = firstNonEmpty(payload.flow_id, payload.flowId);
    const rawQuotationId = firstNonEmpty(
      payload.quotation_uuid,
      payload.quotationUuid,
      payload.quotation_id,
      payload.quotationId,
      payload.business_number,
      payload.businessNumber,
      payload.quote_id,
    );
    const rawRevisionId = firstNonEmpty(payload.revision_id, payload.revisionId, payload.quote_revision_id);
    if (!rawFlowId) throw createHttpError(400, 'ID do fluxo é obrigatório.');
    if (!rawQuotationId) throw createHttpError(400, 'Cotação PostgreSQL é obrigatória.');
    if (!rawRevisionId) throw createHttpError(400, 'Revisão PostgreSQL do orçamento é obrigatória.');
    const flowId = minimalLocalIdentifier(rawFlowId, 'ID do fluxo');
    const quotationId = minimalLocalIdentifier(rawQuotationId, 'Identificador do orçamento');
    const revisionId = minimalLocalIdentifier(rawRevisionId, 'Identificador da revisão');
    const host = (event.headers?.host as string | undefined) || 'project-xr5jg.vercel.app';
    const proto = ((event.headers?.['x-forwarded-proto'] as string | undefined) || 'https').split(',')[0].trim();
    const baseUrl = `${proto}://${host}`;

    const planInputFor = (identity: { revisionId: string; flowId: string }): DeliveryPlanInput => ({
      quotationId,
      businessNumber: firstNonEmpty(payload.business_number, payload.businessNumber),
      revisionId: identity.revisionId,
      flowId: identity.flowId,
      baseUrl,
      needPdf: false,
      resolveFlow: flowResolver,
      repository: dependencies.repository || createQuotationTemplateRepository(),
      store: dependencies.store,
      token: dependencies.token,
      renderPdf: dependencies.renderPdf,
      mediaRecords: dependencies.mediaRecords,
      readMediaRecords: dependencies.readMediaRecords,
      resolveDeal: dependencies.resolveDeal,
      resolveMedia: dependencies.resolveMedia
        ? (categories, maxItems, origin) => dependencies.resolveMedia!(categories, maxItems, origin)
        : undefined,
      headBlob: dependencies.headBlob,
      blobToken: dependencies.blobToken,
      blobStoreId: dependencies.blobStoreId,
    });

    if (!dryRun) {
      try {
        const deliveryModule = dependencies.deliveryModule || createQuotationDeliveryModule({
          planner: (identity) => createDeliveryPlan(planInputFor(identity)),
          transportDependencies: dependencies.transport,
        });
        const delivery = await deliveryModule.enqueue({ revisionId, flowId });
        if (!delivery) return deliveryErrorResponse(new Error('Entrega ausente.'));
        return jsonResponse(delivery.state === 'delivered' ? 200 : 202, {
          success: true,
          delivery_id: delivery.id,
          send_status: delivery.state,
          revision_id: delivery.revisionId,
          flow_id: delivery.flowId,
          delivery: toPublicDeliveryView(delivery),
        });
      } catch (error) {
        return deliveryErrorResponse(error);
      }
    }

    let context!: Awaited<ReturnType<typeof loadPostgresSendContext>>;
    const plan = await createDeliveryPlan({
      ...planInputFor({ revisionId, flowId }),
      onContext: (resolved) => { context = resolved; },
    });
    const publicSteps = plan.steps.map(publicFrozenStep);
    const items = Array.isArray(context?.view?.items)
      ? context.view.items as Record<string, unknown>[]
      : [];
    const categories = detectCategories(items);
    return jsonResponse(200, {
      success: true,
      dry_run: true,
      send_status: 'dry_run',
      duplicate_warning: false,
      duplicate_message: '',
      flow_id: flowId,
      flow_name: plan.flowName,
      quotation_id: plan.businessNumber || null,
      deal_id: context?.dealId || null,
      phone: context?.phone || plan.phone,
      product_summary: flowProductSummary(true, undefined, items),
      categories,
      steps_count: plan.steps.length,
      steps: publicSteps,
      send_event_id: null,
    });
  } catch (error: unknown) {
    const httpErr = error as HttpError;
    const code = Number.isInteger(httpErr?.statusCode) ? httpErr.statusCode : 500;
    console.error('[send-whatsapp-flow]', httpErr?.logMessage || httpErr?.name || 'Error');
    return jsonResponse(code, {
      error: code >= 400 && code < 500 && typeof httpErr?.message === 'string'
        ? httpErr.message
        : 'Não foi possível processar o envio. Tente novamente.',
    });
  }
}
