import { createHttpError } from '../../_lib/http-error.js';
import {
  CRM_PRUNE_LOST_REASON,
  CRM_PRUNE_LOST_STATUS,
  CRM_PRUNE_NEXT_STEP,
  CRM_PRUNE_PROTECT_RECENT_DAYS,
  CRM_PRUNE_TARGET_STATUS,
  CRM_PRUNE_THRESHOLD_DAYS,
  type CrmDealRecord,
  type CrmDealRepository,
  type CrmPruneCandidate,
  type CrmPruneResult,
} from '../../_db/crm-deals-repository.js';

export const PRUNE_TARGET_STATUS = CRM_PRUNE_TARGET_STATUS;
export const PRUNE_LOST_STATUS = CRM_PRUNE_LOST_STATUS;
export const PRUNE_THRESHOLD_DAYS = CRM_PRUNE_THRESHOLD_DAYS;
export const PRUNE_PROTECT_RECENT_DAYS = CRM_PRUNE_PROTECT_RECENT_DAYS;
export const PRUNE_NEXT_STEP = CRM_PRUNE_NEXT_STEP;
export const PRUNE_LOST_REASON = CRM_PRUNE_LOST_REASON;

export type { CrmPruneCandidate, CrmPruneResult };

type PruneRepository = Pick<CrmDealRepository, 'prune'>;
type CandidateRepository = Pick<CrmDealRepository, 'list'> &
  Partial<Pick<CrmDealRepository, 'listPruneCandidates'>>;

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asDate(value: unknown): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

export function parseDealIds(payload: unknown): string[] {
  const dealIds = (payload as { deal_ids?: unknown })?.deal_ids;
  if (!Array.isArray(dealIds)) {
    throw createHttpError(400, 'deal_ids deve ser uma lista de oportunidades.');
  }

  const unique = Array.from(new Set(dealIds.map(cleanString).filter(Boolean)));
  if (unique.length === 0) {
    throw createHttpError(400, 'Selecione ao menos uma oportunidade para limpar.');
  }
  if (unique.length > 1000) {
    throw createHttpError(400, 'Selecione no máximo 1000 oportunidades por limpeza.');
  }
  return unique;
}

export async function getPruneCandidates(
  repository: CandidateRepository,
  now = new Date()
): Promise<CrmPruneCandidate[]> {
  if (repository.listPruneCandidates) return repository.listPruneCandidates(now);

  const rows = await repository.list({ limit: 1000 });
  const cutoff = now.getTime() - PRUNE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
  const protectedAfter = now.getTime() - PRUNE_PROTECT_RECENT_DAYS * 24 * 60 * 60 * 1000;
  return rows
    .filter((row) => {
      const source = row as CrmDealRecord & Record<string, unknown>;
      const quotationDateValue = source.quotationDate ?? source.quotation_date;
      const modifiedValue = source.updatedAt ?? source.deal_modified;
      const quotationDate = quotationDateValue ? asDate(quotationDateValue).getTime() : Number.NaN;
      const modified = asDate(modifiedValue).getTime();
      return (
        source.status === PRUNE_TARGET_STATUS &&
        Boolean(source.quotation) &&
        Number.isFinite(quotationDate) &&
        quotationDate <= cutoff &&
        (!Number.isFinite(modified) || modified <= protectedAfter)
      );
    })
    .map((row) => {
      const source = row as CrmDealRecord & Record<string, unknown>;
      const quotationDate = asDate(source.quotationDate ?? source.quotation_date);
      return {
        deal_id: source.id,
        lead_name: (source.nome ?? source.lead_name ?? 'Sem nome') as string,
        quotation: source.quotation as string,
        quotation_date: quotationDate.toISOString().slice(0, 10),
        age_days: Math.floor(
          (now.getTime() -
            Date.UTC(
              quotationDate.getUTCFullYear(),
              quotationDate.getUTCMonth(),
              quotationDate.getUTCDate()
            )) /
            (24 * 60 * 60 * 1000)
        ),
        deal_modified: asDate(source.updatedAt ?? source.deal_modified).toISOString(),
        grand_total: Number(source.grandTotal ?? source.grand_total ?? 0),
      };
    })
    .sort((a, b) => b.age_days - a.age_days || a.deal_id.localeCompare(b.deal_id));
}

export async function pruneDeals(
  dealIds: string[],
  nowOrRepository: Date | PruneRepository,
  maybeRepository?: PruneRepository | Date
): Promise<CrmPruneResult> {
  const now =
    nowOrRepository instanceof Date
      ? nowOrRepository
      : maybeRepository instanceof Date
        ? maybeRepository
        : new Date();
  const repository =
    nowOrRepository instanceof Date ? (maybeRepository as PruneRepository) : nowOrRepository;
  if (!repository || typeof repository.prune !== 'function') {
    throw createHttpError(503, 'Limpeza de pipeline não está disponível.');
  }
  return repository.prune(dealIds, now);
}
