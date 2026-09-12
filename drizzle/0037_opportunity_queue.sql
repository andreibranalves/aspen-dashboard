-- migration-risk: additive
CREATE TABLE "opportunity_next_actions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"reason_code" varchar(32) NOT NULL,
	"origin" varchar(16) NOT NULL,
	"state" varchar(16) DEFAULT 'active' NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_next_actions_kind_check" CHECK ("opportunity_next_actions"."kind" IN ('first_contact')),
	CONSTRAINT "opportunity_next_actions_origin_check" CHECK ("opportunity_next_actions"."origin" IN ('manual', 'automatic', 'event')),
	CONSTRAINT "opportunity_next_actions_state_check" CHECK ("opportunity_next_actions"."state" IN ('active', 'completed', 'cancelled', 'superseded')),
	CONSTRAINT "opportunity_next_actions_reason_not_blank_check" CHECK (char_length(btrim("opportunity_next_actions"."reason_code")) > 0)
);
--> statement-breakpoint
ALTER TABLE "crm_deals" ADD COLUMN "demand_summary" varchar(4000);--> statement-breakpoint
ALTER TABLE "quote_leads" ADD COLUMN "demand_id" varchar(255);--> statement-breakpoint
ALTER TABLE "opportunity_next_actions" ADD CONSTRAINT "opportunity_next_actions_opportunity_id_crm_deals_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."crm_deals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_next_actions_active_unique" ON "opportunity_next_actions" USING btree ("opportunity_id") WHERE "opportunity_next_actions"."state" = 'active';--> statement-breakpoint
CREATE INDEX "opportunity_next_actions_state_due_idx" ON "opportunity_next_actions" USING btree ("state","due_at");--> statement-breakpoint
CREATE INDEX "opportunity_next_actions_opportunity_idx" ON "opportunity_next_actions" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "quote_leads_demand_id_idx" ON "quote_leads" USING btree ("source","demand_id") WHERE "quote_leads"."demand_id" IS NOT NULL;