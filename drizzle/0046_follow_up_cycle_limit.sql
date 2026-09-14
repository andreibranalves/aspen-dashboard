-- migration-risk: additive
ALTER TABLE "opportunity_next_actions" ADD COLUMN "continuity_command_id" varchar(255);--> statement-breakpoint
ALTER TABLE "opportunity_next_actions" ADD COLUMN "continuity_command_fingerprint" varchar(64);--> statement-breakpoint
ALTER TABLE "opportunity_next_actions" ADD COLUMN "continuity_type" varchar(16);--> statement-breakpoint
ALTER TABLE "quotation_follow_ups" ADD COLUMN "cycle_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "quotation_follow_ups" ADD COLUMN "attempt_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "quotation_follow_ups" ADD COLUMN "source_action_id" uuid;--> statement-breakpoint
ALTER TABLE "quotation_follow_ups" ADD CONSTRAINT "quotation_follow_ups_source_action_id_opportunity_next_actions_id_fk" FOREIGN KEY ("source_action_id") REFERENCES "public"."opportunity_next_actions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_next_actions_continuity_command_unique" ON "opportunity_next_actions" USING btree ("continuity_command_id") WHERE "opportunity_next_actions"."continuity_command_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "quotation_follow_ups_source_action_idx" ON "quotation_follow_ups" USING btree ("source_action_id");--> statement-breakpoint
ALTER TABLE "opportunity_next_actions" ADD CONSTRAINT "opportunity_next_actions_continuity_fingerprint_check" CHECK (("opportunity_next_actions"."continuity_command_id" IS NULL AND "opportunity_next_actions"."continuity_command_fingerprint" IS NULL AND "opportunity_next_actions"."continuity_type" IS NULL) OR ("opportunity_next_actions"."continuity_command_id" IS NOT NULL AND char_length(btrim("opportunity_next_actions"."continuity_command_id")) > 0 AND "opportunity_next_actions"."continuity_command_fingerprint" ~ '^[0-9a-f]{64}$' AND "opportunity_next_actions"."continuity_type" IN ('new_cycle', 'manual_date')));--> statement-breakpoint
ALTER TABLE "opportunity_next_actions" ADD CONSTRAINT "opportunity_next_actions_continuity_type_check" CHECK ("opportunity_next_actions"."continuity_type" IS NULL OR "opportunity_next_actions"."continuity_type" IN ('new_cycle', 'manual_date'));--> statement-breakpoint
ALTER TABLE "quotation_follow_ups" ADD CONSTRAINT "quotation_follow_ups_cycle_number_check" CHECK ("quotation_follow_ups"."cycle_number" > 0);--> statement-breakpoint
ALTER TABLE "quotation_follow_ups" ADD CONSTRAINT "quotation_follow_ups_attempt_number_check" CHECK ("quotation_follow_ups"."attempt_number" IN (1, 2));--> statement-breakpoint
CREATE TABLE "quotation_follow_up_attempt_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"quotation_id" uuid NOT NULL,
	"follow_up_id" uuid NOT NULL,
	"cycle_number" integer NOT NULL,
	"attempt_number" integer NOT NULL,
	"revision_id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"source_action_id" uuid,
	"instance" varchar(120) NOT NULL,
	"provider_conversation_id" varchar(255) NOT NULL,
	"canonical_phone" varchar(15) NOT NULL,
	"eligibility_version" varchar(64),
	"message_snapshot" varchar(4000),
	"state" varchar(20) NOT NULL,
	"closed_reason" varchar(64),
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"transport_started_at" timestamp with time zone,
	"provider_message_id" varchar(255),
	"first_provider_receipt_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"confirmation_source" varchar(16) NOT NULL,
	"confirmation_command_id" varchar(255),
	"confirmed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "quotation_follow_up_attempt_history" ADD CONSTRAINT "quotation_follow_up_attempt_history_opportunity_id_crm_deals_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."crm_deals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_follow_up_attempt_history" ADD CONSTRAINT "quotation_follow_up_attempt_history_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_follow_up_attempt_history" ADD CONSTRAINT "quotation_follow_up_attempt_history_revision_id_quote_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."quote_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_follow_up_attempt_history" ADD CONSTRAINT "quotation_follow_up_attempt_history_delivery_id_quotation_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."quotation_deliveries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_follow_up_attempt_history" ADD CONSTRAINT "quotation_follow_up_attempt_history_source_action_id_opportunity_next_actions_id_fk" FOREIGN KEY ("source_action_id") REFERENCES "public"."opportunity_next_actions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quotation_follow_up_attempt_history_opportunity_cycle_attempt_unique" ON "quotation_follow_up_attempt_history" USING btree ("opportunity_id","cycle_number","attempt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "quotation_follow_up_attempt_history_provider_message_unique" ON "quotation_follow_up_attempt_history" USING btree ("provider_message_id") WHERE "quotation_follow_up_attempt_history"."provider_message_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "quotation_follow_up_attempt_history_quotation_idx" ON "quotation_follow_up_attempt_history" USING btree ("quotation_id","confirmed_at");--> statement-breakpoint
ALTER TABLE "quotation_follow_up_attempt_history" ADD CONSTRAINT "quotation_follow_up_attempt_history_cycle_number_check" CHECK ("cycle_number" > 0);--> statement-breakpoint
ALTER TABLE "quotation_follow_up_attempt_history" ADD CONSTRAINT "quotation_follow_up_attempt_history_attempt_number_check" CHECK ("attempt_number" IN (1, 2));--> statement-breakpoint
ALTER TABLE "quotation_follow_up_attempt_history" ADD CONSTRAINT "quotation_follow_up_attempt_history_confirmation_source_check" CHECK ("confirmation_source" IN ('worker', 'manual'));--> statement-breakpoint
ALTER TABLE "quotation_follow_up_attempt_history" ADD CONSTRAINT "quotation_follow_up_attempt_history_state_check" CHECK ("state" IN ('sent', 'manual'));--> statement-breakpoint
ALTER TABLE "quotation_follow_up_attempt_history" ADD CONSTRAINT "quotation_follow_up_attempt_history_provider_message_check" CHECK (("confirmation_source" = 'worker' AND char_length(btrim("provider_message_id")) > 0) OR ("confirmation_source" = 'manual' AND "provider_message_id" IS NULL));
