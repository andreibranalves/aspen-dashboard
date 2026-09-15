/**
 * Preview and authorized apply of the commercial record transition (#253).
 * Preview never mutates. Apply never sends messages, never enables a worker,
 * and never replays historical transport backlog.
 */

import { and, eq, inArray, isNotNull, ne } from 'drizzle-orm';

import { calendarDateInSaoPaulo } from '../../../_shared/calendar-sao-paulo.js';
import type { AppDatabase } from '../client.js';
import {
  crmDeals,
  opportunityNextActions,
  quotationFollowUps,
  whatsappContactActivity,
} from '../schema.js';
import {
  assertNoFalseSilenceLabel,
  classifyOpportunityTransition,
  CLOSED_OPPORTUNITY_STATUSES,
  INSUFFICIENT_EVIDENCE_REVIEW_REASON,
  summarizeTransitionDecisions,
  type OpportunityTransitionDecision,
  type OpportunityTransitionFacts,
  type TransitionPreviewSummary,
} from '../../../_modules/commercial-record-transition.js';
import {
  ensureFirstContactAction,
  VERIFY_CONVERSATION_REASON,
  VERIFY_CONVERSATION_REASON_CODE,
} from './opportunity-actions-repository.js';

export type TransitionDatabase = Pick<AppDatabase, 'select' | 'insert' | 'update' | 'transaction'>;

export type CommercialTransitionAuthorization = {
  /** Explicit operational authorization for real apply. */
  applyAuthorized: boolean;
  /** Disposable-test escape hatch; never for production apply. */
  allowInTests?: boolean;
};

export type CommercialTransitionApplyResult = {
  preview: TransitionPreviewSummary;
  appliedOpportunityIds: string[];
  skippedOpportunityIds: string[];
  messagesSent: 0;
  workerEnabled: false;
  historicalBacklogReprocessed: false;
};

const DISMISSED_FOLLOW_UP_STATES = ['dismissed', 'cancelled'] as const;
const ACCEPTED_FOLLOW_UP_STATES = ['sent', 'approved', 'processing'] as const;

function isClosedStatus(status: string): boolean {
  return (CLOSED_OPPORTUNITY_STATUSES as readonly string[]).includes(status);
}

async function loadOpportunityFacts(
  database: TransitionDatabase,
): Promise<OpportunityTransitionFacts[]> {
  const deals = await database
    .select({
      id: crmDeals.id,
      status: crmDeals.status,
      clientId: crmDeals.clientId,
      telefone: crmDeals.telefone,
    })
    .from(crmDeals);

  if (deals.length === 0) return [];

  const opportunityIds = deals.map((deal) => deal.id);
  const phones = [
    ...new Set(
      deals.map((deal) => deal.telefone).filter((value): value is string => Boolean(value)),
    ),
  ];

  const activeActions = await database
    .select({ opportunityId: opportunityNextActions.opportunityId })
    .from(opportunityNextActions)
    .where(
      and(
        inArray(opportunityNextActions.opportunityId, opportunityIds),
        eq(opportunityNextActions.state, 'active'),
      ),
    );
  const activeSet = new Set(activeActions.map((row) => row.opportunityId));

  const historicalActions = await database
    .select({ opportunityId: opportunityNextActions.opportunityId })
    .from(opportunityNextActions)
    .where(
      and(
        inArray(opportunityNextActions.opportunityId, opportunityIds),
        ne(opportunityNextActions.state, 'active'),
      ),
    );
  const historyActionSet = new Set(historicalActions.map((row) => row.opportunityId));

  const followUps = await database
    .select({
      opportunityId: quotationFollowUps.approvedOpportunityId,
      state: quotationFollowUps.state,
    })
    .from(quotationFollowUps)
    .where(isNotNull(quotationFollowUps.approvedOpportunityId));

  const dismissedSet = new Set<string>();
  const acceptedFollowUpSet = new Set<string>();
  for (const row of followUps) {
    if (!row.opportunityId) continue;
    if ((DISMISSED_FOLLOW_UP_STATES as readonly string[]).includes(row.state)) {
      dismissedSet.add(row.opportunityId);
    }
    if ((ACCEPTED_FOLLOW_UP_STATES as readonly string[]).includes(row.state)) {
      acceptedFollowUpSet.add(row.opportunityId);
    }
  }

  const restrictedPhones = new Set<string>();
  if (phones.length > 0) {
    const blocked = await database
      .select({ canonicalPhone: whatsappContactActivity.canonicalPhone })
      .from(whatsappContactActivity)
      .where(
        and(
          inArray(whatsappContactActivity.canonicalPhone, phones),
          isNotNull(whatsappContactActivity.blockedAt),
          eq(whatsappContactActivity.blockReason, 'do_not_contact'),
        ),
      );
    for (const row of blocked) {
      if (row.canonicalPhone) restrictedPhones.add(row.canonicalPhone);
    }
  }

  const openByClient = new Map<string, string[]>();
  for (const deal of deals) {
    if (isClosedStatus(deal.status) || !deal.clientId) continue;
    const list = openByClient.get(deal.clientId) || [];
    list.push(deal.id);
    openByClient.set(deal.clientId, list);
  }

  return deals.map((deal) => {
    const siblings = deal.clientId ? openByClient.get(deal.clientId) || [] : [];
    const hasActiveNextAction = activeSet.has(deal.id);
    const hasAcceptedHistory =
      historyActionSet.has(deal.id) || acceptedFollowUpSet.has(deal.id);
    const contactRestricted = Boolean(deal.telefone && restrictedPhones.has(deal.telefone));
    const insufficientEvidenceForSilence = !hasActiveNextAction && !hasAcceptedHistory;

    return {
      opportunityId: deal.id,
      status: deal.status,
      clientId: deal.clientId,
      siblingOpenOpportunityIds: siblings,
      hasActiveNextAction,
      hasAcceptedHistory,
      hasDismissedAttempts: dismissedSet.has(deal.id),
      contactRestricted,
      insufficientEvidenceForSilence,
    };
  });
}

export async function previewCommercialRecordTransition(
  database: TransitionDatabase,
): Promise<TransitionPreviewSummary> {
  const facts = await loadOpportunityFacts(database);
  const decisions = facts.map((row) => {
    const decision = classifyOpportunityTransition(row);
    assertNoFalseSilenceLabel(decision.reviewReason);
    if (decision.applyPlan.type === 'ensure_verify_conversation') {
      assertNoFalseSilenceLabel(decision.applyPlan.reason);
    }
    return decision;
  });
  return summarizeTransitionDecisions(decisions);
}

async function ensureVerifyConversationAction(
  database: TransitionDatabase,
  input: {
    opportunityId: string;
    reason: string;
    occurredAt: Date;
    idFactory: () => string;
  },
): Promise<'applied' | 'skipped'> {
  assertNoFalseSilenceLabel(input.reason);
  const [active] = await database
    .select({
      id: opportunityNextActions.id,
      reasonCode: opportunityNextActions.reasonCode,
    })
    .from(opportunityNextActions)
    .where(
      and(
        eq(opportunityNextActions.opportunityId, input.opportunityId),
        eq(opportunityNextActions.state, 'active'),
      ),
    )
    .limit(1);

  if (active?.reasonCode === VERIFY_CONVERSATION_REASON_CODE) return 'skipped';
  if (active) return 'skipped';

  const dueDate = calendarDateInSaoPaulo(input.occurredAt);
  await database.insert(opportunityNextActions).values({
    id: input.idFactory(),
    opportunityId: input.opportunityId,
    kind: 'review',
    reasonCode: VERIFY_CONVERSATION_REASON_CODE,
    reason: VERIFY_CONVERSATION_REASON,
    origin: 'event',
    state: 'active',
    dueAt: new Date(`${dueDate}T00:00:00-03:00`),
    dueDate,
    dueTime: null,
    scheduleType: 'date_only',
    version: 1,
    actor: 'system',
    createdAt: input.occurredAt,
    updatedAt: input.occurredAt,
    transitionActor: null,
    transitionAt: null,
    transitionOrigin: null,
    transitionReason: input.reason || INSUFFICIENT_EVIDENCE_REVIEW_REASON,
    replacedById: null,
  });
  return 'applied';
}

async function applyDecision(
  database: TransitionDatabase,
  decision: OpportunityTransitionDecision,
  occurredAt: Date,
  idFactory: () => string,
): Promise<'applied' | 'skipped'> {
  switch (decision.applyPlan.type) {
    case 'noop':
    case 'keep_active_action':
      return 'skipped';
    case 'ensure_first_contact': {
      const before = await database
        .select({ id: opportunityNextActions.id })
        .from(opportunityNextActions)
        .where(eq(opportunityNextActions.opportunityId, decision.opportunityId));
      await ensureFirstContactAction(database, {
        opportunityId: decision.opportunityId,
        dueAt: occurredAt,
        idFactory,
      });
      const after = await database
        .select({ id: opportunityNextActions.id })
        .from(opportunityNextActions)
        .where(eq(opportunityNextActions.opportunityId, decision.opportunityId));
      return after.length > before.length ? 'applied' : 'skipped';
    }
    case 'ensure_verify_conversation':
      return ensureVerifyConversationAction(database, {
        opportunityId: decision.opportunityId,
        reason: decision.applyPlan.reason,
        occurredAt,
        idFactory,
      });
    default:
      return 'skipped';
  }
}

/**
 * Applies the transition plan only when explicitly authorized. Refuses to
 * touch transport, workers, or historical send backlog.
 */
export async function applyCommercialRecordTransition(
  database: TransitionDatabase,
  input: {
    authorization: CommercialTransitionAuthorization;
    occurredAt: Date;
    idFactory: () => string;
  },
): Promise<CommercialTransitionApplyResult> {
  if (!input.authorization.applyAuthorized && !input.authorization.allowInTests) {
    throw new Error(
      'Aplicação da transição comercial exige autorização operacional separada.',
    );
  }

  const preview = await previewCommercialRecordTransition(database);
  const appliedOpportunityIds: string[] = [];
  const skippedOpportunityIds: string[] = [];

  for (const decision of preview.decisions) {
    const outcome = await applyDecision(
      database,
      decision,
      input.occurredAt,
      input.idFactory,
    );
    if (outcome === 'applied') appliedOpportunityIds.push(decision.opportunityId);
    else skippedOpportunityIds.push(decision.opportunityId);
  }

  return {
    preview,
    appliedOpportunityIds,
    skippedOpportunityIds,
    messagesSent: 0,
    workerEnabled: false,
    historicalBacklogReprocessed: false,
  };
}

/** Focused proof helper: active-action cardinality for an opportunity. */
export async function countActiveActionsForOpportunity(
  database: TransitionDatabase,
  opportunityId: string,
): Promise<number> {
  const rows = await database
    .select({ id: opportunityNextActions.id })
    .from(opportunityNextActions)
    .where(
      and(
        eq(opportunityNextActions.opportunityId, opportunityId),
        eq(opportunityNextActions.state, 'active'),
      ),
    );
  return rows.length;
}
