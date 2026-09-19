/**
 * Preview and authorized apply of the commercial record transition (#253).
 * Preview never mutates. Apply never sends messages, never enables a worker,
 * and never replays historical transport backlog.
 */

import { and, eq, sql } from 'drizzle-orm';

import { calendarDateInSaoPaulo } from '../../../_shared/calendar-sao-paulo.js';
import type { AppDatabase } from '../client.js';
import {
  opportunityNextActions,
} from '../schema.js';
import {
  assertNoFalseSilenceLabel,
  classifyOpportunityTransition,
  INSUFFICIENT_EVIDENCE_REVIEW_REASON,
  summarizeTransitionDecisions,
  type OpportunityTransitionDecision,
  type OpportunityTransitionFacts,
  type TransitionPreviewSummary,
} from '../../../_modules/commercial-record-transition.js';
import {
  VERIFY_CONVERSATION_REASON,
  VERIFY_CONVERSATION_REASON_CODE,
} from './opportunity-actions-repository.js';

type TransitionQueryDatabase = Pick<
  AppDatabase,
  'select' | 'insert' | 'update' | 'execute'
>;
export type TransitionDatabase = TransitionQueryDatabase & Pick<AppDatabase, 'transaction'>;

export type CommercialTransitionAuthorization = {
  applyAuthorized: boolean;
};

export type CommercialTransitionApplyResult = {
  preview: TransitionPreviewSummary;
  appliedOpportunityIds: string[];
  skippedOpportunityIds: string[];
  messagesSent: 0;
  workerEnabled: false;
  historicalBacklogReprocessed: false;
};

async function loadOpportunityFacts(
  database: TransitionQueryDatabase,
  opportunityId?: string,
): Promise<OpportunityTransitionFacts[]> {
  const filter = opportunityId ? sql`WHERE deal.id = ${opportunityId}::uuid` : sql``;
  const rows = Array.from(await database.execute(sql`
    SELECT
      deal.id,
      deal.status,
      deal.client_id,
      COALESCE((
        SELECT array_agg(sibling.id ORDER BY sibling.id)
        FROM crm_deals sibling
        WHERE sibling.client_id = deal.client_id
          AND sibling.status NOT IN ('Pedido Fechado', 'Perdido')
      ), ARRAY[]::uuid[]) AS sibling_ids,
      EXISTS (
        SELECT 1 FROM opportunity_next_actions action
        WHERE action.opportunity_id = deal.id AND action.state = 'active'
      ) AS has_active_action,
      EXISTS (
        SELECT 1 FROM opportunity_next_actions action
        WHERE action.opportunity_id = deal.id
          AND action.state = 'suspended'
          AND action.transition_reason = 'Não contatar'
      ) AS has_suspended_restricted_action,
      (
        EXISTS (
          SELECT 1 FROM opportunity_next_actions action
          WHERE action.opportunity_id = deal.id AND action.state <> 'active'
        )
        OR EXISTS (
          SELECT 1
          FROM quotation_follow_ups follow_up
          JOIN quotations quotation ON quotation.id = follow_up.quotation_id
          WHERE COALESCE(
            follow_up.approved_opportunity_id,
            quotation.opportunity_id,
            (SELECT legacy.id FROM crm_deals legacy
             WHERE legacy.quotation_id = quotation.id
             ORDER BY legacy.updated_at DESC, legacy.id DESC LIMIT 1)
          ) = deal.id
            AND follow_up.state IN ('sent', 'approved', 'processing', 'needs_review')
        )
      ) AS has_accepted_history,
      EXISTS (
        SELECT 1
        FROM quotation_follow_ups follow_up
        JOIN quotations quotation ON quotation.id = follow_up.quotation_id
        WHERE COALESCE(
          follow_up.approved_opportunity_id,
          quotation.opportunity_id,
          (SELECT legacy.id FROM crm_deals legacy
           WHERE legacy.quotation_id = quotation.id
           ORDER BY legacy.updated_at DESC, legacy.id DESC LIMIT 1)
        ) = deal.id
          AND follow_up.state IN ('dismissed', 'cancelled')
      ) AS has_dismissed_attempts,
      EXISTS (
        SELECT 1
        FROM whatsapp_contact_activity activity
        WHERE activity.blocked_at IS NOT NULL
          AND activity.block_reason = 'do_not_contact'
          AND activity.canonical_phone IN (
            SELECT phone FROM (
              SELECT deal.telefone AS phone
              UNION ALL
              SELECT client.telefone FROM clients client WHERE client.id = deal.client_id
              UNION ALL
              SELECT follow_up.canonical_phone
              FROM quotation_follow_ups follow_up
              JOIN quotations quotation ON quotation.id = follow_up.quotation_id
              WHERE COALESCE(
                follow_up.approved_opportunity_id,
                quotation.opportunity_id,
                (SELECT legacy.id FROM crm_deals legacy
                 WHERE legacy.quotation_id = quotation.id
                 ORDER BY legacy.updated_at DESC, legacy.id DESC LIMIT 1)
              ) = deal.id
              UNION ALL
              SELECT regexp_replace(delivery.phone, '[^0-9]', '', 'g')
              FROM quotations quotation
              JOIN quote_revisions revision ON revision.quotation_id = quotation.id
              JOIN quotation_deliveries delivery ON delivery.revision_id = revision.id
              WHERE quotation.opportunity_id = deal.id OR quotation.id = deal.quotation_id
            ) linked_phones
            WHERE phone IS NOT NULL
          )
      ) AS contact_restricted
    FROM crm_deals deal
    ${filter}
    ORDER BY deal.id
  `)) as Record<string, unknown>[];
  return rows.map((row) => {
    const hasActiveNextAction = row.has_active_action === true;
    const hasAcceptedHistory = row.has_accepted_history === true;
    return {
      opportunityId: String(row.id),
      status: String(row.status),
      clientId: row.client_id == null ? null : String(row.client_id),
      siblingOpenOpportunityIds: Array.isArray(row.sibling_ids)
        ? row.sibling_ids.map((id) => String(id))
        : [],
      hasActiveNextAction,
      hasSuspendedRestrictedAction: row.has_suspended_restricted_action === true,
      hasAcceptedHistory,
      hasDismissedAttempts: row.has_dismissed_attempts === true,
      contactRestricted: row.contact_restricted === true,
      insufficientEvidenceForSilence: !hasActiveNextAction && !hasAcceptedHistory,
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
  database: TransitionQueryDatabase,
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

async function ensureSuspendedRestrictedAction(
  database: TransitionQueryDatabase,
  input: {
    opportunityId: string;
    occurredAt: Date;
    idFactory: () => string;
  },
): Promise<'applied' | 'skipped'> {
  const [active] = await database
    .select()
    .from(opportunityNextActions)
    .where(
      and(
        eq(opportunityNextActions.opportunityId, input.opportunityId),
        eq(opportunityNextActions.state, 'active'),
      ),
    )
    .limit(1);
  if (active) {
    const [updated] = await database
      .update(opportunityNextActions)
      .set({
        state: 'suspended',
        updatedAt: input.occurredAt,
        transitionActor: 'system',
        transitionAt: input.occurredAt,
        transitionOrigin: 'event',
        transitionReason: 'Não contatar',
        replacedById: null,
      })
      .where(
        and(
          eq(opportunityNextActions.id, active.id),
          eq(opportunityNextActions.state, 'active'),
        ),
      )
      .returning({ id: opportunityNextActions.id });
    return updated ? 'applied' : 'skipped';
  }
  const [existing] = await database
    .select({ id: opportunityNextActions.id })
    .from(opportunityNextActions)
    .where(
      and(
        eq(opportunityNextActions.opportunityId, input.opportunityId),
        eq(opportunityNextActions.state, 'suspended'),
        eq(opportunityNextActions.transitionReason, 'Não contatar'),
      ),
    )
    .limit(1);
  if (existing) return 'skipped';
  const [latest] = await database
    .select({ version: opportunityNextActions.version })
    .from(opportunityNextActions)
    .where(eq(opportunityNextActions.opportunityId, input.opportunityId))
    .orderBy(sql`${opportunityNextActions.version} DESC`)
    .limit(1);
  const dueDate = calendarDateInSaoPaulo(input.occurredAt);
  await database.insert(opportunityNextActions).values({
    id: input.idFactory(),
    opportunityId: input.opportunityId,
    kind: 'review',
    reasonCode: VERIFY_CONVERSATION_REASON_CODE,
    reason: VERIFY_CONVERSATION_REASON,
    origin: 'event',
    state: 'suspended',
    dueAt: new Date(`${dueDate}T00:00:00-03:00`),
    dueDate,
    dueTime: null,
    scheduleType: 'date_only',
    version: (latest?.version || 0) + 1,
    actor: 'system',
    createdAt: input.occurredAt,
    updatedAt: input.occurredAt,
    transitionActor: 'system',
    transitionAt: input.occurredAt,
    transitionOrigin: 'event',
    transitionReason: 'Não contatar',
    replacedById: null,
  });
  return 'applied';
}

async function applyDecision(
  database: TransitionQueryDatabase,
  decision: OpportunityTransitionDecision,
  occurredAt: Date,
  idFactory: () => string,
): Promise<'applied' | 'skipped'> {
  switch (decision.applyPlan.type) {
    case 'noop':
    case 'keep_active_action':
      return 'skipped';
    case 'ensure_suspended_action':
      return ensureSuspendedRestrictedAction(database, {
        opportunityId: decision.opportunityId,
        occurredAt,
        idFactory,
      });
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

async function neutralizeHistoricalAuthorizations(
  database: TransitionQueryDatabase,
  opportunityId: string,
  occurredAt: Date,
): Promise<void> {
  await database.execute(sql`
    UPDATE quotation_follow_ups follow_up
    SET state = 'needs_review',
        closed_reason = CASE
          WHEN follow_up.state = 'processing' AND follow_up.transport_started_at IS NOT NULL
            THEN 'transport_ambiguous'
          ELSE 'already_handled'
        END,
        closed_at = ${occurredAt.toISOString()}::timestamptz,
        lease_token = NULL,
        lease_until = NULL,
        updated_at = ${occurredAt.toISOString()}::timestamptz
    FROM quotations quotation
    WHERE quotation.id = follow_up.quotation_id
      AND follow_up.state IN ('approved', 'processing')
      AND COALESCE(
        follow_up.approved_opportunity_id,
        quotation.opportunity_id,
        (SELECT legacy.id FROM crm_deals legacy
         WHERE legacy.quotation_id = quotation.id
         ORDER BY legacy.updated_at DESC, legacy.id DESC LIMIT 1)
      ) = ${opportunityId}::uuid
  `);
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
  if (!input.authorization.applyAuthorized) {
    throw new Error(
      'Aplicação da transição comercial exige autorização operacional separada.',
    );
  }

  const preview = await previewCommercialRecordTransition(database);
  const appliedOpportunityIds: string[] = [];
  const skippedOpportunityIds: string[] = [];

  for (const decision of preview.decisions) {
    const outcome = await database.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(hashtextextended(${decision.opportunityId}::text, 0))
      `);
      const locked = Array.from(await tx.execute(sql`
        SELECT id FROM crm_deals
        WHERE id = ${decision.opportunityId}::uuid
        FOR UPDATE
      `));
      if (locked.length === 0) return 'skipped' as const;
      await tx.execute(sql`
        SELECT id FROM whatsapp_contact_activity
        WHERE canonical_phone IN (
          SELECT phone FROM (
            SELECT deal.telefone AS phone
            FROM crm_deals deal WHERE deal.id = ${decision.opportunityId}::uuid
            UNION ALL
            SELECT client.telefone
            FROM crm_deals deal
            JOIN clients client ON client.id = deal.client_id
            WHERE deal.id = ${decision.opportunityId}::uuid
          ) phones WHERE phone IS NOT NULL
        )
        FOR UPDATE
      `);
      await neutralizeHistoricalAuthorizations(tx, decision.opportunityId, input.occurredAt);
      const [facts] = await loadOpportunityFacts(tx, decision.opportunityId);
      if (!facts) return 'skipped' as const;
      const currentDecision = classifyOpportunityTransition(facts);
      assertNoFalseSilenceLabel(currentDecision.reviewReason);
      return applyDecision(tx, currentDecision, input.occurredAt, input.idFactory);
    });
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
