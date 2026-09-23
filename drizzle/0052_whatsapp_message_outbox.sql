-- migration-risk: additive
ALTER TABLE "whatsapp_messages" ADD COLUMN "delivery_status" varchar(16);
--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD COLUMN "superseded_by" uuid;
--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_delivery_status_check" CHECK ("whatsapp_messages"."delivery_status" IS NULL OR "whatsapp_messages"."delivery_status" IN ('server_ack', 'delivered', 'read', 'error'));
--> statement-breakpoint
CREATE INDEX "whatsapp_messages_provider_lookup_idx" ON "whatsapp_messages" USING btree ("provider_message_id") WHERE "whatsapp_messages"."provider_message_id" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE "whatsapp_message_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"message_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"client_request_id" uuid NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"destination_phone" varchar(15) NOT NULL,
	"identity_version" integer NOT NULL,
	"body" text NOT NULL,
	"state" varchar(24) DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"transport_started_at" timestamp with time zone,
	"provider_message_id" varchar(255),
	"failure_code" varchar(64),
	"resolution" varchar(16),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_message_outbox" ADD CONSTRAINT "whatsapp_message_outbox_message_id_whatsapp_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."whatsapp_messages"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "whatsapp_message_outbox" ADD CONSTRAINT "whatsapp_message_outbox_conversation_id_whatsapp_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."whatsapp_conversations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_message_outbox_request_unique" ON "whatsapp_message_outbox" USING btree ("client_request_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_message_outbox_message_unique" ON "whatsapp_message_outbox" USING btree ("message_id");
--> statement-breakpoint
CREATE INDEX "whatsapp_message_outbox_due_idx" ON "whatsapp_message_outbox" USING btree ("state","next_attempt_at");
--> statement-breakpoint
ALTER TABLE "whatsapp_message_outbox" ADD CONSTRAINT "whatsapp_message_outbox_state_check" CHECK ("whatsapp_message_outbox"."state" IN ('queued', 'dispatching', 'provider_accepted', 'retry_scheduled', 'failed', 'needs_review', 'cancelled'));
--> statement-breakpoint
ALTER TABLE "whatsapp_message_outbox" ADD CONSTRAINT "whatsapp_message_outbox_phone_check" CHECK ("whatsapp_message_outbox"."destination_phone" ~ '^[0-9]{10,15}$');
--> statement-breakpoint
ALTER TABLE "whatsapp_message_outbox" ADD CONSTRAINT "whatsapp_message_outbox_body_check" CHECK (char_length(btrim("whatsapp_message_outbox"."body")) > 0 AND char_length("whatsapp_message_outbox"."body") <= 4000);
--> statement-breakpoint
ALTER TABLE "whatsapp_message_outbox" ADD CONSTRAINT "whatsapp_message_outbox_attempts_check" CHECK ("whatsapp_message_outbox"."attempts" >= 0);
--> statement-breakpoint
ALTER TABLE "whatsapp_message_outbox" ADD CONSTRAINT "whatsapp_message_outbox_lease_check" CHECK (("whatsapp_message_outbox"."state" = 'dispatching') = ("whatsapp_message_outbox"."lease_token" IS NOT NULL AND "whatsapp_message_outbox"."lease_expires_at" IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "whatsapp_message_outbox" ADD CONSTRAINT "whatsapp_message_outbox_resolution_check" CHECK ("whatsapp_message_outbox"."resolution" IS NULL OR "whatsapp_message_outbox"."resolution" IN ('confirmed_sent', 'confirmed_not_sent'));
