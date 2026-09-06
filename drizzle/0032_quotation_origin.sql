-- migration-risk: additive
ALTER TABLE "quotations" ADD COLUMN "quote_lead_id" uuid;
--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_quote_lead_id_quote_leads_id_fk" FOREIGN KEY ("quote_lead_id") REFERENCES "public"."quote_leads"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "quotations_quote_lead_id_idx" ON "quotations" USING btree ("quote_lead_id") WHERE "quotations"."quote_lead_id" IS NOT NULL;
