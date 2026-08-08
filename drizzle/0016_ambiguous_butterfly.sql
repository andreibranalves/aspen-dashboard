CREATE TABLE "quotation_outbox_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_type" varchar(48) NOT NULL,
	"provider" varchar(32) NOT NULL,
	"aggregate_type" varchar(32) DEFAULT 'quotation' NOT NULL,
	"aggregate_id" varchar(255) NOT NULL,
	"payload_reference" jsonb NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_owner" varchar(128),
	"lease_expires_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error_class" varchar(128),
	"provider_message_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "quotation_outbox_events_type_check" CHECK ("quotation_outbox_events"."event_type" IN ('quotation.created', 'quotation.updated', 'quotation.issued', 'quotation.sent')),
	CONSTRAINT "quotation_outbox_events_provider_check" CHECK ("quotation_outbox_events"."provider" IN ('n8n', 'evolution', 'crm')),
	CONSTRAINT "quotation_outbox_events_status_check" CHECK ("quotation_outbox_events"."status" IN ('pending', 'processing', 'retry', 'delivered', 'dead_letter')),
	CONSTRAINT "quotation_outbox_events_attempts_check" CHECK ("quotation_outbox_events"."attempts" >= 0),
	CONSTRAINT "quotation_outbox_events_idempotency_not_blank_check" CHECK (char_length(btrim("quotation_outbox_events"."idempotency_key")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "quotation_outbox_events_idempotency_unique" ON "quotation_outbox_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "quotation_outbox_events_due_idx" ON "quotation_outbox_events" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "quotation_outbox_events_aggregate_idx" ON "quotation_outbox_events" USING btree ("aggregate_id","created_at");