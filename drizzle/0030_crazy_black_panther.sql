-- migration-risk: additive
CREATE TABLE "quotation_follow_ups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"quotation_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"instance" varchar(120) NOT NULL,
	"provider_conversation_id" varchar(255) NOT NULL,
	"canonical_phone" varchar(15) NOT NULL,
	"eligibility_version" varchar(64) NOT NULL,
	"message_snapshot" varchar(4000) NOT NULL,
	"state" varchar(16) NOT NULL,
	"closed_reason" varchar(64),
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"transport_started_at" timestamp with time zone,
	"provider_message_id" varchar(255),
	"first_provider_receipt_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"approved_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "quotation_follow_ups_instance_not_blank_check" CHECK (char_length(btrim("quotation_follow_ups"."instance")) > 0),
	CONSTRAINT "quotation_follow_ups_conversation_not_blank_check" CHECK (char_length(btrim("quotation_follow_ups"."provider_conversation_id")) > 0),
	CONSTRAINT "quotation_follow_ups_phone_not_blank_check" CHECK (char_length(btrim("quotation_follow_ups"."canonical_phone")) > 0),
	CONSTRAINT "quotation_follow_ups_eligibility_version_check" CHECK ("quotation_follow_ups"."eligibility_version" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "quotation_follow_ups_message_not_blank_check" CHECK (char_length(btrim("quotation_follow_ups"."message_snapshot")) > 0),
	CONSTRAINT "quotation_follow_ups_state_check" CHECK ("quotation_follow_ups"."state" IN ('approved', 'processing', 'sent', 'cancelled', 'dismissed', 'needs_review', 'failed')),
	CONSTRAINT "quotation_follow_ups_closed_reason_check" CHECK ("quotation_follow_ups"."closed_reason" IS NULL OR "quotation_follow_ups"."closed_reason" IN (
        'already_handled',
        'do_not_contact',
        'no_continuity',
        'wrong_contact',
        'other',
        'before_tracking_start',
        'newer_delivery_in_flight',
        'delivery_incomplete',
        'missing_provider_receipt',
        'quotation_not_issued',
        'crm_not_eligible',
        'client_archived',
        'identity_unresolved',
        'contact_blocked',
        'inbound_after_anchor',
        'outbound_after_anchor',
        'already_attempted',
        'provider_rejected',
        'rate_limited',
        'transport_ambiguous',
        'lease_expired_after_transport'
      )),
	CONSTRAINT "quotation_follow_ups_closed_consistency_check" CHECK ((
        "quotation_follow_ups"."state" IN ('approved', 'processing')
        AND "quotation_follow_ups"."closed_reason" IS NULL
        AND "quotation_follow_ups"."closed_at" IS NULL
      ) OR (
        "quotation_follow_ups"."state" IN ('sent', 'cancelled', 'dismissed', 'needs_review', 'failed')
        AND "quotation_follow_ups"."closed_at" IS NOT NULL
        AND (
          "quotation_follow_ups"."state" = 'sent'
          OR "quotation_follow_ups"."closed_reason" IS NOT NULL
        )
      ))
);
--> statement-breakpoint
CREATE TABLE "whatsapp_contact_activity" (
	"id" uuid PRIMARY KEY NOT NULL,
	"instance" varchar(120) NOT NULL,
	"provider_conversation_id" varchar(255) NOT NULL,
	"last_inbound_at" timestamp with time zone,
	"last_inbound_provider_message_id" varchar(255),
	"last_outbound_at" timestamp with time zone,
	"last_outbound_provider_message_id" varchar(255),
	"canonical_phone" varchar(15),
	"identity_status" varchar(16),
	"blocked_at" timestamp with time zone,
	"block_reason" varchar(32),
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "whatsapp_contact_activity_instance_not_blank_check" CHECK (char_length(btrim("whatsapp_contact_activity"."instance")) > 0),
	CONSTRAINT "whatsapp_contact_activity_conversation_not_blank_check" CHECK (char_length(btrim("whatsapp_contact_activity"."provider_conversation_id")) > 0),
	CONSTRAINT "whatsapp_contact_activity_identity_status_check" CHECK ("whatsapp_contact_activity"."identity_status" IS NULL OR "whatsapp_contact_activity"."identity_status" IN ('verified', 'derived', 'unresolved', 'conflict')),
	CONSTRAINT "whatsapp_contact_activity_block_reason_check" CHECK (("whatsapp_contact_activity"."blocked_at" IS NULL AND "whatsapp_contact_activity"."block_reason" IS NULL) OR ("whatsapp_contact_activity"."blocked_at" IS NOT NULL AND "whatsapp_contact_activity"."block_reason" IN ('do_not_contact')))
);
--> statement-breakpoint
CREATE TABLE "whatsapp_follow_up_ingestion_health" (
	"instance" varchar(120) PRIMARY KEY NOT NULL,
	"last_upsert_at" timestamp with time zone,
	"last_upsert_event_key" varchar(255),
	"blocked_at" timestamp with time zone,
	"block_reason" varchar(32),
	"blocked_event_key" varchar(255),
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "whatsapp_follow_up_ingestion_health_instance_not_blank_check" CHECK (char_length(btrim("whatsapp_follow_up_ingestion_health"."instance")) > 0),
	CONSTRAINT "whatsapp_follow_up_ingestion_health_block_check" CHECK ((
        "whatsapp_follow_up_ingestion_health"."blocked_at" IS NULL
        AND "whatsapp_follow_up_ingestion_health"."block_reason" IS NULL
        AND "whatsapp_follow_up_ingestion_health"."blocked_event_key" IS NULL
      ) OR (
        "whatsapp_follow_up_ingestion_health"."blocked_at" IS NOT NULL
        AND "whatsapp_follow_up_ingestion_health"."block_reason" IN ('unparsed_upsert')
        AND char_length(btrim("whatsapp_follow_up_ingestion_health"."blocked_event_key")) > 0
      ))
);
--> statement-breakpoint
ALTER TABLE "quotation_follow_ups" ADD CONSTRAINT "quotation_follow_ups_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_follow_ups" ADD CONSTRAINT "quotation_follow_ups_revision_id_quote_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."quote_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_follow_ups" ADD CONSTRAINT "quotation_follow_ups_delivery_id_quotation_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."quotation_deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quotation_follow_ups_quotation_id_unique" ON "quotation_follow_ups" USING btree ("quotation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quotation_follow_ups_provider_message_id_unique" ON "quotation_follow_ups" USING btree ("provider_message_id") WHERE "quotation_follow_ups"."provider_message_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "quotation_follow_ups_state_due_idx" ON "quotation_follow_ups" USING btree ("state","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_contact_activity_instance_conversation_unique" ON "whatsapp_contact_activity" USING btree ("instance","provider_conversation_id");--> statement-breakpoint
CREATE INDEX "whatsapp_contact_activity_instance_phone_idx" ON "whatsapp_contact_activity" USING btree ("instance","canonical_phone");
