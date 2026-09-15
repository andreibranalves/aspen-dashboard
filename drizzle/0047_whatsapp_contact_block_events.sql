-- migration-risk: additive
CREATE TABLE "whatsapp_contact_block_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"instance" varchar(120) NOT NULL,
	"canonical_phone" varchar(15) NOT NULL,
	"provider_conversation_id" varchar(255),
	"event_type" varchar(16) NOT NULL,
	"actor" varchar(120) NOT NULL,
	"reason" varchar(500) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
CREATE INDEX "whatsapp_contact_block_events_phone_occurred_idx" ON "whatsapp_contact_block_events" USING btree ("instance","canonical_phone","occurred_at" DESC);--> statement-breakpoint
ALTER TABLE "whatsapp_contact_block_events" ADD CONSTRAINT "whatsapp_contact_block_events_instance_not_blank_check" CHECK (char_length(btrim("instance")) > 0);--> statement-breakpoint
ALTER TABLE "whatsapp_contact_block_events" ADD CONSTRAINT "whatsapp_contact_block_events_phone_check" CHECK ("canonical_phone" ~ '^[0-9]{10,15}$');--> statement-breakpoint
ALTER TABLE "whatsapp_contact_block_events" ADD CONSTRAINT "whatsapp_contact_block_events_event_type_check" CHECK ("event_type" IN ('blocked', 'unblocked'));--> statement-breakpoint
ALTER TABLE "whatsapp_contact_block_events" ADD CONSTRAINT "whatsapp_contact_block_events_actor_not_blank_check" CHECK (char_length(btrim("actor")) > 0);--> statement-breakpoint
ALTER TABLE "whatsapp_contact_block_events" ADD CONSTRAINT "whatsapp_contact_block_events_reason_not_blank_check" CHECK (char_length(btrim("reason")) > 0);
