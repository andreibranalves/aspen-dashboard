-- Canonicalize historical commercial labels before strict checks are
-- installed. Sent/open/expired legacy labels intentionally become `enviado`,
-- ordered becomes `aprovado`, and lost/cancelled becomes `perdido`. Unknown
-- labels use the safe non-editable `enviado` state rather than creating drafts.
UPDATE "quotations"
SET "status" = CASE lower(btrim("status"))
  WHEN 'rascunho' THEN 'rascunho'
  WHEN 'enviado' THEN 'enviado'
  WHEN 'aprovado' THEN 'aprovado'
  WHEN 'perdido' THEN 'perdido'
  WHEN 'draft' THEN 'rascunho'
  WHEN 'issued' THEN 'enviado'
  WHEN 'open' THEN 'enviado'
  WHEN 'replied' THEN 'enviado'
  WHEN 'expired' THEN 'enviado'
  WHEN 'emitido' THEN 'enviado'
  WHEN 'ordered' THEN 'aprovado'
  WHEN 'lost' THEN 'perdido'
  WHEN 'cancelled' THEN 'perdido'
  ELSE 'enviado'
END;
UPDATE "quote_revisions"
SET "status" = CASE lower(btrim("status"))
  WHEN 'rascunho' THEN 'rascunho'
  WHEN 'enviado' THEN 'enviado'
  WHEN 'aprovado' THEN 'aprovado'
  WHEN 'perdido' THEN 'perdido'
  WHEN 'draft' THEN 'rascunho'
  WHEN 'issued' THEN 'enviado'
  WHEN 'open' THEN 'enviado'
  WHEN 'replied' THEN 'enviado'
  WHEN 'expired' THEN 'enviado'
  WHEN 'emitido' THEN 'enviado'
  WHEN 'ordered' THEN 'aprovado'
  WHEN 'lost' THEN 'perdido'
  WHEN 'cancelled' THEN 'perdido'
  ELSE 'enviado'
END;
--> statement-breakpoint
-- A pre-rollout database may contain more than one draft for a quotation.
-- Keep the newest revision (version, then UUID as a deterministic tie-breaker)
-- editable and demote all older drafts before installing the partial index.
WITH ranked_drafts AS (
  SELECT "id",
         row_number() OVER (
           PARTITION BY "quotation_id"
           ORDER BY "version" DESC, "id" DESC
         ) AS "draft_rank"
  FROM "quote_revisions"
  WHERE "status" = 'rascunho'
)
UPDATE "quote_revisions" AS revisions
SET "status" = 'enviado'
FROM ranked_drafts
WHERE revisions."id" = ranked_drafts."id"
  AND ranked_drafts."draft_rank" > 1;
--> statement-breakpoint
ALTER TABLE "quotations" DROP CONSTRAINT "quotations_status_not_blank_check";--> statement-breakpoint
ALTER TABLE "quote_revisions" DROP CONSTRAINT "quote_revisions_status_not_blank_check";--> statement-breakpoint
CREATE UNIQUE INDEX "quote_revisions_one_draft_per_quotation_unique" ON "quote_revisions" USING btree ("quotation_id") WHERE "quote_revisions"."status" = 'rascunho';--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_status_check" CHECK ("quotations"."status" IN ('rascunho', 'enviado', 'aprovado', 'perdido'));--> statement-breakpoint
ALTER TABLE "quote_revisions" ADD CONSTRAINT "quote_revisions_status_check" CHECK ("quote_revisions"."status" IN ('rascunho', 'enviado', 'aprovado', 'perdido'));
