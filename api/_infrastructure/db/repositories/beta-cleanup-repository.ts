import { and, eq, inArray, like, notInArray, or } from 'drizzle-orm';
import { getDatabase, type AppDatabase } from '../client.js';
import {
  clients,
  crmDeals,
  productActivityEvents,
  quoteLeads,
  quoteRevisionItems,
  quoteRevisions,
  quotationDeliveries,
  quotationDeliverySteps,
  quotationEmailDeliveries,
  quotationIssueRequests,
  quotations,
  salesOrders,
} from '../schema.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CANDIDATES = 100;
const MAX_GRAPH_ROWS = 5000;

export type BetaCleanupCandidateType = 'client' | 'lead' | 'deal' | 'quotation';

export interface BetaCleanupCandidate {
  type: BetaCleanupCandidateType;
  id: string;
}

export interface BetaCleanupCounts {
  clients: number;
  leads: number;
  deals: number;
  quotations: number;
  revisions: number;
  items: number;
  deliveries: number;
  deliverySteps: number;
  emailDeliveries: number;
  issueRequests: number;
  activities: number;
  salesOrders: number;
}

export interface BetaCleanupPlan {
  candidates: BetaCleanupCandidate[];
  counts: BetaCleanupCounts;
  ids: {
    clients: string[];
    leads: string[];
    salesOrders: string[];
    deals: string[];
    quotations: string[];
    revisions: string[];
    items: string[];
    deliveries: string[];
    deliverySteps: string[];
    emailDeliveries: string[];
    issueRequests: string[];
    activities: string[];
  };
  retainedSharedClients: string[];
  blockers: Array<{ type: 'sales_order' | 'shared_client'; id: string }>;
}

export class BetaCleanupInputError extends Error {
  readonly statusCode = 400;
  readonly expose = true;
  constructor(message: string) { super(message); this.name = 'BetaCleanupInputError'; }
}

export class BetaCleanupBlockedError extends Error {
  readonly statusCode = 409;
  readonly expose = true;
  constructor(message: string) { super(message); this.name = 'BetaCleanupBlockedError'; }
}

export class BetaCleanupRepositoryError extends Error {
  readonly statusCode = 503;
  readonly expose = false;
  constructor(message = 'Não foi possível preparar a limpeza beta.') { super(message); this.name = 'BetaCleanupRepositoryError'; }
}

type DatabaseProvider = () => AppDatabase;
type CleanupDatabase = AppDatabase | Parameters<Parameters<AppDatabase['transaction']>[0]>[0];
const emptyCounts = (): BetaCleanupCounts => ({
  clients: 0, leads: 0, deals: 0, quotations: 0, revisions: 0, items: 0,
  deliveries: 0, deliverySteps: 0, emailDeliveries: 0, issueRequests: 0, activities: 0, salesOrders: 0,
});

function clean(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }

function candidate(type: unknown, id: unknown): BetaCleanupCandidate {
  const normalizedType = clean(type) as BetaCleanupCandidateType;
  const normalizedId = clean(id);
  if (!['client', 'lead', 'deal', 'quotation'].includes(normalizedType)) {
    throw new BetaCleanupInputError('Tipo de candidato inválido.');
  }
  if (!UUID.test(normalizedId)) throw new BetaCleanupInputError('Candidato deve usar um UUID estável.');
  return { type: normalizedType, id: normalizedId };
}

export function parseBetaCleanupCandidates(value: unknown): BetaCleanupCandidate[] {
  const root = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const source = Array.isArray(root.candidates) ? root.candidates : root.ids;
  const result: BetaCleanupCandidate[] = [];
  if (Array.isArray(source)) {
    for (const item of source) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new BetaCleanupInputError('Cada candidato deve informar type e id.');
      }
      const row = item as Record<string, unknown>;
      result.push(candidate(row.type, row.id));
    }
  } else {
    for (const type of ['client', 'lead', 'deal', 'quotation'] as const) {
      const ids = root[`${type}s`];
      if (ids === undefined) continue;
      if (!Array.isArray(ids)) throw new BetaCleanupInputError(`Campo ${type}s deve ser uma lista.`);
      for (const id of ids) result.push(candidate(type, id));
    }
  }
  const unique = new Map(result.map((item) => [`${item.type}:${item.id}`, item]));
  const normalized = [...unique.values()];
  if (normalized.length === 0) throw new BetaCleanupInputError('Informe ao menos um candidato revisado.');
  if (normalized.length > MAX_CANDIDATES) throw new BetaCleanupInputError(`Informe no máximo ${MAX_CANDIDATES} candidatos.`);
  return normalized;
}

function idsFor(candidates: BetaCleanupCandidate[], type: BetaCleanupCandidateType): string[] {
  return candidates.filter((item) => item.type === type).map((item) => item.id);
}

function add(set: Set<string>, value: string | null | undefined): boolean {
  if (!value || set.has(value)) return false;
  set.add(value);
  return true;
}

async function selectIn<T>(query: Promise<T[]>, limit = MAX_GRAPH_ROWS): Promise<T[]> {
  const rows = await query;
  if (rows.length > limit) throw new BetaCleanupRepositoryError('Grafo beta excede o limite seguro.');
  return rows;
}

async function buildPlan(db: CleanupDatabase, candidates: BetaCleanupCandidate[]): Promise<BetaCleanupPlan> {
  const explicitClientIds = new Set(idsFor(candidates, 'client'));
  const clientIds = new Set(explicitClientIds);
  const leadIds = new Set(idsFor(candidates, 'lead'));
  const dealIds = new Set(idsFor(candidates, 'deal'));
  const quotationIds = new Set(idsFor(candidates, 'quotation'));

  for (let pass = 0; pass < 6; pass += 1) {
    let changed = false;
    const selectedLeads = leadIds.size ? await selectIn(db.select().from(quoteLeads).where(inArray(quoteLeads.id, [...leadIds]))) : [];
    const selectedDeals = dealIds.size ? await selectIn(db.select().from(crmDeals).where(inArray(crmDeals.id, [...dealIds]))) : [];
    const selectedQuotations = quotationIds.size ? await selectIn(db.select().from(quotations).where(inArray(quotations.id, [...quotationIds]))) : [];

    for (const row of selectedLeads) {
      changed = add(quotationIds, row.quotationId) || changed;
      changed = add(dealIds, row.crmDealId) || changed;
    }
    for (const row of selectedDeals) {
      changed = add(clientIds, row.clientId) || changed;
      changed = add(leadIds, row.quoteLeadId) || changed;
      changed = add(quotationIds, row.quotationId) || changed;
    }
    for (const row of selectedQuotations) changed = add(clientIds, row.clientId) || changed;

    if (quotationIds.size) {
      // The loop below uses one query per quotation only to keep the FK graph
      // explicit and bounded; beta cleanup is intentionally an infrequent tool.
      for (const quotationId of quotationIds) {
        const [leads, deals] = await Promise.all([
          selectIn(db.select().from(quoteLeads).where(eq(quoteLeads.quotationId, quotationId))),
          selectIn(db.select().from(crmDeals).where(eq(crmDeals.quotationId, quotationId))),
        ]);
        for (const row of leads) changed = add(leadIds, row.id) || changed;
        for (const row of deals) {
          changed = add(dealIds, row.id) || changed;
          changed = add(clientIds, row.clientId) || changed;
          changed = add(leadIds, row.quoteLeadId) || changed;
        }
      }
    }

    if (leadIds.size) {
      const leads = [...leadIds];
      const [deals, quotationsForLeads] = await Promise.all([
        selectIn(db.select().from(crmDeals).where(inArray(crmDeals.quoteLeadId, leads))),
        selectIn(db.select().from(quotations).where(inArray(quotations.id, [...quotationIds]))),
      ]);
      for (const row of deals) {
        changed = add(dealIds, row.id) || changed;
        changed = add(clientIds, row.clientId) || changed;
        changed = add(quotationIds, row.quotationId) || changed;
      }
      for (const row of quotationsForLeads) changed = add(clientIds, row.clientId) || changed;
    }

    if (explicitClientIds.size) {
      const clientsList = [...explicitClientIds];
      const [clientQuotations, clientDeals] = await Promise.all([
        selectIn(db.select().from(quotations).where(inArray(quotations.clientId, clientsList))),
        selectIn(db.select().from(crmDeals).where(inArray(crmDeals.clientId, clientsList))),
      ]);
      for (const row of clientQuotations) changed = add(quotationIds, row.id) || changed;
      for (const row of clientDeals) {
        changed = add(dealIds, row.id) || changed;
        changed = add(leadIds, row.quoteLeadId) || changed;
        changed = add(quotationIds, row.quotationId) || changed;
      }
    }
    if (!changed) break;
  }

  const [existingClients, existingLeads, existingDeals, existingQuotations] = await Promise.all([
    clientIds.size ? selectIn(db.select({ id: clients.id }).from(clients).where(inArray(clients.id, [...clientIds]))) : Promise.resolve([]),
    leadIds.size ? selectIn(db.select({ id: quoteLeads.id }).from(quoteLeads).where(inArray(quoteLeads.id, [...leadIds]))) : Promise.resolve([]),
    dealIds.size ? selectIn(db.select({ id: crmDeals.id }).from(crmDeals).where(inArray(crmDeals.id, [...dealIds]))) : Promise.resolve([]),
    quotationIds.size ? selectIn(db.select({ id: quotations.id }).from(quotations).where(inArray(quotations.id, [...quotationIds]))) : Promise.resolve([]),
  ]);
  clientIds.clear();
  leadIds.clear();
  dealIds.clear();
  quotationIds.clear();
  for (const row of existingClients) clientIds.add(row.id);
  for (const row of existingLeads) leadIds.add(row.id);
  for (const row of existingDeals) dealIds.add(row.id);
  for (const row of existingQuotations) quotationIds.add(row.id);

  const quotationList = [...quotationIds];
  const revisionRows = quotationList.length
    ? await selectIn(db.select().from(quoteRevisions).where(inArray(quoteRevisions.quotationId, quotationList)))
    : [];
  const revisionIds = new Set(revisionRows.map((row) => row.id));
  const deliveryRows = revisionIds.size
    ? await selectIn(db.select().from(quotationDeliveries).where(inArray(quotationDeliveries.revisionId, [...revisionIds])))
    : [];
  const deliveryIds = new Set(deliveryRows.map((row) => row.id));
  const [itemRows, emailRows, issueRows, orderRows] = await Promise.all([
    revisionIds.size ? selectIn(db.select().from(quoteRevisionItems).where(inArray(quoteRevisionItems.revisionId, [...revisionIds]))) : Promise.resolve([]),
    revisionIds.size ? selectIn(db.select().from(quotationEmailDeliveries).where(inArray(quotationEmailDeliveries.revisionId, [...revisionIds]))) : Promise.resolve([]),
    quotationList.length || revisionIds.size ? selectIn(db.select().from(quotationIssueRequests).where(or(
      ...(quotationList.length ? [inArray(quotationIssueRequests.quotationId, quotationList)] : []),
      ...(revisionIds.size ? [inArray(quotationIssueRequests.revisionId, [...revisionIds])] : []),
    ))) : Promise.resolve([]),
    quotationList.length || revisionIds.size ? selectIn(db.select().from(salesOrders).where(or(
      ...(quotationList.length ? [inArray(salesOrders.quotationId, quotationList)] : []),
      ...(revisionIds.size ? [inArray(salesOrders.quotationRevisionId, [...revisionIds])] : []),
    ))) : Promise.resolve([]),
  ]);
  const deliveryStepRows = deliveryIds.size
    ? await selectIn(db.select().from(quotationDeliverySteps).where(inArray(quotationDeliverySteps.deliveryId, [...deliveryIds])))
    : [];

  const retainedSharedClients = new Set<string>();
  const blockers: BetaCleanupPlan['blockers'] = orderRows.map((row) => ({ type: 'sales_order', id: row.id }));
  if (clientIds.size) {
    const clientList = [...clientIds];
    const externalQuotes = quotationList.length
      ? await db.select({ id: quotations.id, clientId: quotations.clientId }).from(quotations).where(and(inArray(quotations.clientId, clientList), notInArray(quotations.id, quotationList)))
      : await db.select({ id: quotations.id, clientId: quotations.clientId }).from(quotations).where(inArray(quotations.clientId, clientList));
    const externalDeals = dealIds.size
      ? await db.select({ id: crmDeals.id, clientId: crmDeals.clientId }).from(crmDeals).where(and(inArray(crmDeals.clientId, clientList), notInArray(crmDeals.id, [...dealIds])))
      : await db.select({ id: crmDeals.id, clientId: crmDeals.clientId }).from(crmDeals).where(inArray(crmDeals.clientId, clientList));
    const orderClients = await db.select({ id: salesOrders.id, clientId: salesOrders.clientId }).from(salesOrders).where(inArray(salesOrders.clientId, clientList));
    for (const row of [...externalQuotes, ...externalDeals, ...orderClients]) {
      if (row.clientId) retainedSharedClients.add(row.clientId);
    }
  }

  const activityRows = quotationList.length
    ? await selectIn(db.select({ id: productActivityEvents.id, referenceId: productActivityEvents.referenceId }).from(productActivityEvents).where(or(...quotationList.map((id) => like(productActivityEvents.referenceId, `orcamento:${id}:%`)))))
    : [];
  const counts = emptyCounts();
  counts.clients = clientIds.size - retainedSharedClients.size;
  counts.leads = leadIds.size;
  counts.deals = dealIds.size;
  counts.quotations = quotationIds.size;
  counts.revisions = revisionIds.size;
  counts.items = itemRows.length;
  counts.deliveries = deliveryRows.length;
  counts.deliverySteps = deliveryStepRows.length;
  counts.emailDeliveries = emailRows.length;
  counts.issueRequests = issueRows.length;
  counts.activities = activityRows.length;
  counts.salesOrders = orderRows.length;
  return {
    candidates,
    counts,
    ids: {
      clients: [...clientIds].filter((id) => !retainedSharedClients.has(id)),
      leads: [...leadIds],
      salesOrders: orderRows.map((row) => row.id),
      deals: [...dealIds],
      quotations: [...quotationIds],
      revisions: [...revisionIds],
      items: itemRows.map((row) => row.id),
      deliveries: deliveryRows.map((row) => row.id),
      deliverySteps: deliveryStepRows.map((row) => row.id),
      emailDeliveries: emailRows.map((row) => row.id),
      issueRequests: issueRows.map((row) => row.id),
      activities: activityRows.map((row) => row.id),
    },
    retainedSharedClients: [...retainedSharedClients],
    blockers,
  };
}

export interface BetaCleanupRepository {
  plan(candidates: BetaCleanupCandidate[]): Promise<BetaCleanupPlan>;
  apply(candidates: BetaCleanupCandidate[]): Promise<BetaCleanupPlan & { applied: true }>;
}

export function createPostgresBetaCleanupRepository(
  getDb: DatabaseProvider = getDatabase,
): BetaCleanupRepository {
  return {
    async plan(candidates) {
      try { return await buildPlan(getDb(), candidates); }
      catch (error) {
        if (error instanceof BetaCleanupInputError || error instanceof BetaCleanupBlockedError || error instanceof BetaCleanupRepositoryError) throw error;
        console.error('[beta-cleanup] plan failed', error instanceof Error ? error.name : typeof error);
        throw new BetaCleanupRepositoryError();
      }
    },
    async apply(candidates) {
      try {
        const plan = await getDb().transaction(async (tx) => {
          const current = await buildPlan(tx, candidates);
          if (current.blockers.length) throw new BetaCleanupBlockedError('O grafo possui pedido real ou cliente compartilhado; nada foi removido.');
          if (current.ids.issueRequests.length) await tx.delete(quotationIssueRequests).where(inArray(quotationIssueRequests.id, current.ids.issueRequests));
          if (current.ids.deliverySteps.length) await tx.delete(quotationDeliverySteps).where(inArray(quotationDeliverySteps.id, current.ids.deliverySteps));
          if (current.ids.deliveries.length) await tx.delete(quotationDeliveries).where(inArray(quotationDeliveries.id, current.ids.deliveries));
          if (current.ids.emailDeliveries.length) await tx.delete(quotationEmailDeliveries).where(inArray(quotationEmailDeliveries.id, current.ids.emailDeliveries));
          if (current.ids.activities.length) await tx.delete(productActivityEvents).where(inArray(productActivityEvents.id, current.ids.activities));
          if (current.ids.deals.length) await tx.update(crmDeals).set({ quoteLeadId: null, clientId: null, quotationId: null }).where(inArray(crmDeals.id, current.ids.deals));
          if (current.ids.leads.length) await tx.update(quoteLeads).set({ quotationId: null, crmDealId: null }).where(inArray(quoteLeads.id, current.ids.leads));
          if (current.ids.revisions.length) await tx.delete(quoteRevisions).where(inArray(quoteRevisions.id, current.ids.revisions));
          if (current.ids.quotations.length) await tx.delete(quotations).where(inArray(quotations.id, current.ids.quotations));
          if (current.ids.deals.length) await tx.delete(crmDeals).where(inArray(crmDeals.id, current.ids.deals));
          if (current.ids.leads.length) await tx.delete(quoteLeads).where(inArray(quoteLeads.id, current.ids.leads));
          if (current.ids.clients.length) await tx.delete(clients).where(inArray(clients.id, current.ids.clients));
          return current;
        });
        return { ...plan, applied: true as const };
      } catch (error) {
        if (error instanceof BetaCleanupInputError || error instanceof BetaCleanupBlockedError || error instanceof BetaCleanupRepositoryError) throw error;
        console.error('[beta-cleanup] apply failed', error instanceof Error ? error.name : typeof error);
        throw new BetaCleanupRepositoryError();
      }
    },
  };
}
