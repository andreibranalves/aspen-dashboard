-- migration-risk: additive
CREATE TABLE "commercial_inbound_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"instance" varchar(120) NOT NULL,
	"provider_message_id" varchar(255) NOT NULL,
	"provider_conversation_id" varchar(255),
	"canonical_phone" varchar(15),
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opportunity_next_actions" ADD COLUMN "association_client_id" uuid;
--> statement-breakpoint
ALTER TABLE "opportunity_next_actions" ADD COLUMN "association_phone" varchar(15);
--> statement-breakpoint
ALTER TABLE "opportunity_next_actions" ADD COLUMN "association_provider_message_id" varchar(255);
--> statement-breakpoint
ALTER TABLE "opportunity_next_actions" ADD CONSTRAINT "opportunity_next_actions_association_client_id_clients_id_fk" FOREIGN KEY ("association_client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "opportunity_next_actions" ADD CONSTRAINT "opportunity_next_actions_association_phone_check" CHECK ("opportunity_next_actions"."association_phone" IS NULL OR "opportunity_next_actions"."association_phone" ~ '^[0-9]{10,15}$');
--> statement-breakpoint
ALTER TABLE "opportunity_next_actions" ADD CONSTRAINT "opportunity_next_actions_association_context_check" CHECK (("opportunity_next_actions"."association_client_id" IS NULL AND "opportunity_next_actions"."association_phone" IS NULL AND "opportunity_next_actions"."association_provider_message_id" IS NULL) OR ("opportunity_next_actions"."association_phone" IS NOT NULL AND char_length(btrim("opportunity_next_actions"."association_phone")) > 0 AND "opportunity_next_actions"."association_provider_message_id" IS NOT NULL AND char_length(btrim("opportunity_next_actions"."association_provider_message_id")) > 0));
--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_inbound_events_provider_message_unique" ON "commercial_inbound_events" USING btree ("instance","provider_message_id");
--> statement-breakpoint
ALTER TABLE "commercial_inbound_events" ADD CONSTRAINT "commercial_inbound_events_instance_not_blank_check" CHECK (char_length(btrim("commercial_inbound_events"."instance")) > 0);
--> statement-breakpoint
ALTER TABLE "commercial_inbound_events" ADD CONSTRAINT "commercial_inbound_events_message_not_blank_check" CHECK (char_length(btrim("commercial_inbound_events"."provider_message_id")) > 0);
--> statement-breakpoint
ALTER TABLE "commercial_inbound_events" ADD CONSTRAINT "commercial_inbound_events_conversation_not_blank_check" CHECK ("commercial_inbound_events"."provider_conversation_id" IS NULL OR char_length(btrim("commercial_inbound_events"."provider_conversation_id")) > 0);
--> statement-breakpoint
ALTER TABLE "commercial_inbound_events" ADD CONSTRAINT "commercial_inbound_events_phone_check" CHECK ("commercial_inbound_events"."canonical_phone" IS NULL OR "commercial_inbound_events"."canonical_phone" ~ '^[0-9]{10,15}$');
