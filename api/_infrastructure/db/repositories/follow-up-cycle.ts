import { sql, type SQL } from 'drizzle-orm';

/**
 * The attempt identity belongs to the opportunity, while the durable queue
 * row is still unique per quotation. Keep this expression shared by every
 * queue producer so alternatives see the same current row/history watermark.
 */
export function followUpCycleNumber(opportunity: SQL): SQL {
  return sql`GREATEST(
    1,
    COALESCE((
      SELECT MAX(current_follow_up.cycle_number)
      FROM quotation_follow_ups current_follow_up
      JOIN quotations current_quotation
        ON current_quotation.id = current_follow_up.quotation_id
      LEFT JOIN LATERAL (
        SELECT legacy.id
        FROM crm_deals legacy
        WHERE current_quotation.opportunity_id IS NULL
          AND legacy.quotation_id = current_quotation.id
        ORDER BY legacy.updated_at DESC, legacy.id DESC
        LIMIT 1
      ) current_legacy ON true
      WHERE COALESCE(current_quotation.opportunity_id, current_legacy.id) = ${opportunity}
    ), 0),
    COALESCE((
      SELECT MAX(history.cycle_number)
      FROM quotation_follow_up_attempt_history history
      WHERE history.opportunity_id = ${opportunity}
    ), 0)
  )`;
}

/** Map the current commercial stage to the only valid attempt identities. */
export function followUpAttemptNumber(followUpStage: SQL): SQL {
  return sql`LEAST(2, GREATEST(1, COALESCE(${followUpStage}, 0) + 1))`;
}

/** Start the successor cycle, without fabricating a prior technical attempt. */
export function nextFollowUpCycleNumber(opportunity: SQL): SQL {
  return sql`CASE WHEN EXISTS (
    SELECT 1
    FROM quotation_follow_ups current_follow_up
    JOIN quotations current_quotation
      ON current_quotation.id = current_follow_up.quotation_id
    LEFT JOIN LATERAL (
      SELECT legacy.id
      FROM crm_deals legacy
      WHERE current_quotation.opportunity_id IS NULL
        AND legacy.quotation_id = current_quotation.id
      ORDER BY legacy.updated_at DESC, legacy.id DESC
      LIMIT 1
    ) current_legacy ON true
    WHERE COALESCE(current_quotation.opportunity_id, current_legacy.id) = ${opportunity}
  ) OR EXISTS (
    SELECT 1
    FROM quotation_follow_up_attempt_history history
    WHERE history.opportunity_id = ${opportunity}
  )
  THEN ${followUpCycleNumber(opportunity)} + 1
  ELSE 1 END`;
}
