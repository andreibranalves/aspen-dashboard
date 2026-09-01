-- One-shot manual operation for the quotation follow-up queue.
-- REQUIRED: run only after explicit human authorization, against the intended
-- database, with psql variables tracking_started_at and instance supplied.
-- This script is not imported by API startup and does not acknowledge delivery.

WITH commercial_lock AS (
  SELECT pg_advisory_xact_lock(hashtextextended('quotation-follow-up-commercial-facts', 0))
), latest_delivery AS (
  SELECT DISTINCT ON (q.id)
    q.id AS quotation_id,
    q.status AS quotation_status,
    cl.arquivado AS client_archived,
    EXISTS (
      SELECT 1 FROM crm_deals cd
      WHERE cd.quotation_id = q.id AND cd.status = 'Orcamento Enviado'
    ) AS crm_eligible,
    r.id AS revision_id,
    d.id AS delivery_id,
    d.phone,
    d.state AS delivery_state,
    d.completion_source,
    regexp_replace(d.phone, '[^0-9]', '', 'g') AS canonical_phone
  FROM quotations q
  CROSS JOIN commercial_lock
  JOIN quote_revisions r ON r.quotation_id = q.id
  JOIN clients cl ON cl.id = q.client_id
  JOIN quotation_deliveries d ON d.revision_id = r.id
  WHERE d.created_at >= :'tracking_started_at'::timestamptz
    AND d.phone NOT ILIKE '%@g.us'
    AND d.phone NOT ILIKE '%status%'
    AND d.phone NOT ILIKE '%broadcast%'
    AND (
      (
        regexp_replace(d.phone, '[^0-9]', '', 'g') ~ '^[0-9]{10,15}$'
        AND d.phone NOT ILIKE '%@lid'
      )
      OR d.phone ILIKE '%@lid'
    )
  ORDER BY q.id, d.created_at DESC, d.id DESC
), delivery_receipts AS (
  SELECT
    d.delivery_id,
    COUNT(s.id) AS step_count,
    COUNT(*) FILTER (WHERE s.delivered_at IS NULL AND s.read_at IS NULL) AS incomplete_steps,
    MAX(COALESCE(s.delivered_at, s.read_at)) AS first_receipt_at,
    BOOL_OR(s.accepted_at IS NOT NULL) AS has_accepted_step
  FROM latest_delivery d
  JOIN quotation_delivery_steps s ON s.delivery_id = d.delivery_id
  GROUP BY d.delivery_id
), candidates AS (
  SELECT
    l.*,
    r.step_count,
    r.incomplete_steps,
    r.first_receipt_at,
    r.has_accepted_step,
    CASE
      WHEN NOT (
        r.has_accepted_step
        OR l.delivery_state = 'provider_accepted'
        OR (
          l.completion_source = 'provider_receipt'
          AND r.step_count > 0
          AND r.incomplete_steps = 0
        )
      ) THEN NULL
      WHEN l.client_archived THEN 'cancelled'
      WHEN l.quotation_status IS DISTINCT FROM 'emitido' THEN 'cancelled'
      WHEN NOT l.crm_eligible THEN 'cancelled'
      WHEN l.phone ILIKE '%@lid' THEN 'held'
      WHEN l.completion_source = 'provider_receipt'
        AND r.step_count > 0 AND r.incomplete_steps = 0
        AND r.first_receipt_at + interval '24 hours' <= now()
        THEN 'ready'
      WHEN l.completion_source = 'provider_receipt'
        AND r.step_count > 0 AND r.incomplete_steps = 0 THEN 'waiting'
      ELSE 'awaiting_receipt'
    END AS candidate_state
  FROM latest_delivery l
  JOIN delivery_receipts r ON r.delivery_id = l.delivery_id
)
INSERT INTO quotation_follow_ups (
  id, quotation_id, revision_id, delivery_id, instance, provider_conversation_id,
  canonical_phone, eligibility_version, message_snapshot, state, closed_reason,
  first_provider_receipt_at, due_at, approved_at, sent_at, closed_at,
  provider_message_id, lease_token, lease_until, transport_started_at, created_at, updated_at
)
SELECT
  gen_random_uuid(), c.quotation_id, c.revision_id, c.delivery_id, :'instance',
  CASE WHEN c.phone ILIKE '%@lid' THEN btrim(c.phone) ELSE c.canonical_phone || '@s.whatsapp.net' END,
  CASE WHEN c.phone ILIKE '%@lid' THEN '' ELSE c.canonical_phone END,
  NULL, NULL, c.candidate_state,
  CASE
    WHEN c.client_archived THEN 'client_archived'
    WHEN c.quotation_status IS DISTINCT FROM 'emitido' THEN 'quotation_not_issued'
    WHEN NOT c.crm_eligible THEN 'crm_not_eligible'
    ELSE NULL
  END,
  CASE WHEN c.completion_source = 'provider_receipt'
    AND c.candidate_state IN ('waiting', 'ready', 'held') THEN c.first_receipt_at ELSE NULL END,
  CASE WHEN c.completion_source = 'provider_receipt'
    AND c.candidate_state IN ('waiting', 'ready', 'held') AND c.first_receipt_at IS NOT NULL
    THEN c.first_receipt_at + interval '24 hours' ELSE NULL END,
  NULL, NULL,
  CASE WHEN c.candidate_state = 'cancelled' THEN now() ELSE NULL END,
  NULL, NULL, NULL, NULL, now(), now()
FROM candidates c
WHERE c.candidate_state IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM quotation_follow_ups existing
    WHERE existing.quotation_id = c.quotation_id
  )
ON CONFLICT (quotation_id) DO NOTHING;
