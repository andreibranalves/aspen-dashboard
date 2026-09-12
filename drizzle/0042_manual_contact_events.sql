-- migration-risk: additive
CREATE TABLE "manual_contact_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"command_id" varchar(255) NOT NULL,
	"command_fingerprint" varchar(64) NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"contact_type" varchar(32) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"note" text,
	"result_code" varchar(32) NOT NULL,
	"counts_as_follow_up" boolean DEFAULT false NOT NULL,
	"source" varchar(32) DEFAULT 'operator_statement' NOT NULL,
	"actor" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"continuation_type" varchar(16) NOT NULL,
	"successor_action_id" uuid,
	"close_reason" varchar(500),
	"result_version" integer NOT NULL,
	"closed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "manual_contact_events_command_id_not_blank_check" CHECK (char_length(btrim("manual_contact_events"."command_id")) > 0),
	CONSTRAINT "manual_contact_events_command_fingerprint_check" CHECK ("manual_contact_events"."command_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "manual_contact_events_contact_type_check" CHECK ("manual_contact_events"."contact_type" IN ('phone_call', 'external_conversation')),
	CONSTRAINT "manual_contact_events_result_code_check" CHECK ("manual_contact_events"."result_code" IN ('follow_up_agreed', 'interested', 'not_interested', 'no_response', 'wrong_contact', 'other')),
	CONSTRAINT "manual_contact_events_source_check" CHECK ("manual_contact_events"."source" = 'operator_statement'),
	CONSTRAINT "manual_contact_events_continuation_check" CHECK ("manual_contact_events"."continuation_type" IN ('successor', 'wait', 'close')),
	CONSTRAINT "manual_contact_events_continuation_consistency_check" CHECK ((
        ("manual_contact_events"."continuation_type" IN ('successor', 'wait') AND "manual_contact_events"."successor_action_id" IS NOT NULL AND "manual_contact_events"."close_reason" IS NULL AND "manual_contact_events"."closed" = false)
        OR ("manual_contact_events"."continuation_type" = 'close' AND "manual_contact_events"."successor_action_id" IS NULL AND char_length(btrim("manual_contact_events"."close_reason")) > 0 AND "manual_contact_events"."closed" = true)
      )),
	CONSTRAINT "manual_contact_events_note_length_check" CHECK ("manual_contact_events"."note" IS NULL OR char_length("manual_contact_events"."note") <= 4000),
	CONSTRAINT "manual_contact_events_result_version_check" CHECK ("manual_contact_events"."result_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "manual_contact_events" ADD CONSTRAINT "manual_contact_events_opportunity_id_crm_deals_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."crm_deals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_contact_events" ADD CONSTRAINT "manual_contact_events_action_id_opportunity_next_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."opportunity_next_actions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_contact_events" ADD CONSTRAINT "manual_contact_events_successor_action_id_opportunity_next_actions_id_fk" FOREIGN KEY ("successor_action_id") REFERENCES "public"."opportunity_next_actions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "manual_contact_events_command_id_unique" ON "manual_contact_events" USING btree ("command_id");--> statement-breakpoint
CREATE INDEX "manual_contact_events_opportunity_created_idx" ON "manual_contact_events" USING btree ("opportunity_id","created_at");--> statement-breakpoint
CREATE INDEX "manual_contact_events_action_idx" ON "manual_contact_events" USING btree ("action_id");
