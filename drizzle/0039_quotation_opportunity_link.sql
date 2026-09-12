-- migration-risk: additive
ALTER TABLE "quotations" ADD COLUMN "opportunity_id" uuid;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "creation_request_id" uuid;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "creation_fingerprint" text;--> statement-breakpoint
CREATE UNIQUE INDEX "quotations_creation_request_unique" ON "quotations" USING btree ("creation_request_id") WHERE "quotations"."creation_request_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_opportunity_id_crm_deals_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."crm_deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quotations_opportunity_id_idx" ON "quotations" USING btree ("opportunity_id") WHERE "quotations"."opportunity_id" IS NOT NULL;--> statement-breakpoint
UPDATE "quotations" AS q
SET "opportunity_id" = d."id"
FROM "crm_deals" AS d
WHERE d."quotation_id" = q."id"
  AND q."opportunity_id" IS NULL
  AND (SELECT count(*) FROM "crm_deals" AS d2 WHERE d2."quotation_id" = q."id") = 1;
