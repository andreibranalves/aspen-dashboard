-- migration-risk: additive
CREATE TABLE "whatsapp_conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"instance" varchar(120) NOT NULL,
	"provider_conversation_id" varchar(255) NOT NULL,
	"canonical_phone" varchar(15),
	"identity_status" varchar(16) NOT NULL,
	"identity_source" varchar(40),
	"identity_confidence" varchar(8),
	"identity_version" integer DEFAULT 1 NOT NULL,
	"display_name" varchar(255),
	"status" varchar(24) DEFAULT 'open' NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"read_revision" bigint DEFAULT 0 NOT NULL,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"last_message_at" timestamp with time zone,
	"last_message_preview" varchar(280),
	"last_message_direction" varchar(8),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"provider_message_id" varchar(255),
	"direction" varchar(8) NOT NULL,
	"message_type" varchar(16) NOT NULL,
	"body" text,
	"origin" varchar(16) NOT NULL,
	"provider_timestamp" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_revision" bigint NOT NULL,
	"revision" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_conversation_id_whatsapp_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."whatsapp_conversations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_conversations_provider_unique" ON "whatsapp_conversations" USING btree ("instance","provider_conversation_id");
--> statement-breakpoint
CREATE INDEX "whatsapp_conversations_activity_idx" ON "whatsapp_conversations" USING btree ("last_message_at" DESC NULLS LAST,"id" DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_messages_provider_unique" ON "whatsapp_messages" USING btree ("conversation_id","provider_message_id");
--> statement-breakpoint
CREATE INDEX "whatsapp_messages_timeline_idx" ON "whatsapp_messages" USING btree ("conversation_id","provider_timestamp" DESC,"id" DESC);
--> statement-breakpoint
CREATE INDEX "whatsapp_messages_revision_idx" ON "whatsapp_messages" USING btree ("conversation_id","revision");
--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_instance_not_blank_check" CHECK (char_length(btrim("whatsapp_conversations"."instance")) > 0);
--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_provider_not_blank_check" CHECK (char_length(btrim("whatsapp_conversations"."provider_conversation_id")) > 0);
--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_phone_check" CHECK ("whatsapp_conversations"."canonical_phone" IS NULL OR "whatsapp_conversations"."canonical_phone" ~ '^[0-9]{10,15}$');
--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_identity_status_check" CHECK ("whatsapp_conversations"."identity_status" IN ('verified', 'derived', 'unresolved', 'conflict'));
--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_identity_confidence_check" CHECK ("whatsapp_conversations"."identity_confidence" IS NULL OR "whatsapp_conversations"."identity_confidence" IN ('high', 'medium', 'low'));
--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_identity_version_check" CHECK ("whatsapp_conversations"."identity_version" > 0);
--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_status_check" CHECK ("whatsapp_conversations"."status" IN ('open', 'waiting_customer', 'closed', 'ignored'));
--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_revision_check" CHECK ("whatsapp_conversations"."revision" >= 0 AND "whatsapp_conversations"."read_revision" >= 0 AND "whatsapp_conversations"."read_revision" <= "whatsapp_conversations"."revision");
--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_unread_check" CHECK ("whatsapp_conversations"."unread_count" >= 0);
--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_direction_check" CHECK ("whatsapp_conversations"."last_message_direction" IS NULL OR "whatsapp_conversations"."last_message_direction" IN ('inbound', 'outbound'));
--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_provider_not_blank_check" CHECK ("whatsapp_messages"."provider_message_id" IS NULL OR char_length(btrim("whatsapp_messages"."provider_message_id")) > 0);
--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_direction_check" CHECK ("whatsapp_messages"."direction" IN ('inbound', 'outbound'));
--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_type_check" CHECK ("whatsapp_messages"."message_type" IN ('text', 'image', 'video', 'audio', 'document', 'sticker', 'location', 'contact', 'unsupported'));
--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_origin_check" CHECK ("whatsapp_messages"."origin" IN ('live', 'backfill', 'operator', 'quotation'));
--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_body_length_check" CHECK ("whatsapp_messages"."body" IS NULL OR char_length("whatsapp_messages"."body") <= 65536);
--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_revision_check" CHECK ("whatsapp_messages"."created_revision" > 0 AND "whatsapp_messages"."revision" >= "whatsapp_messages"."created_revision");
--> statement-breakpoint
CREATE TABLE "whatsapp_webhook_effects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"instance" varchar(120) NOT NULL,
	"provider_conversation_id" varchar(255) NOT NULL,
	"provider_message_id" varchar(255) NOT NULL,
	"from_me" boolean NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"identity_status" varchar(16) NOT NULL,
	"canonical_phone" varchar(15),
	"activity_done_at" timestamp with time zone,
	"follow_up_done_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_failure" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_webhook_effects_message_unique" ON "whatsapp_webhook_effects" USING btree ("instance","provider_conversation_id","provider_message_id");
--> statement-breakpoint
CREATE INDEX "whatsapp_webhook_effects_pending_idx" ON "whatsapp_webhook_effects" USING btree ("next_attempt_at","occurred_at") WHERE "whatsapp_webhook_effects"."activity_done_at" IS NULL OR "whatsapp_webhook_effects"."follow_up_done_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "whatsapp_webhook_effects" ADD CONSTRAINT "whatsapp_webhook_effects_identity_status_check" CHECK ("whatsapp_webhook_effects"."identity_status" IN ('verified', 'derived', 'unresolved', 'conflict'));
--> statement-breakpoint
ALTER TABLE "whatsapp_webhook_effects" ADD CONSTRAINT "whatsapp_webhook_effects_phone_check" CHECK ("whatsapp_webhook_effects"."canonical_phone" IS NULL OR "whatsapp_webhook_effects"."canonical_phone" ~ '^[0-9]{10,15}$');
--> statement-breakpoint
ALTER TABLE "whatsapp_webhook_effects" ADD CONSTRAINT "whatsapp_webhook_effects_attempts_check" CHECK ("whatsapp_webhook_effects"."attempts" >= 0);
--> statement-breakpoint
ALTER TABLE "whatsapp_webhook_effects" ADD CONSTRAINT "whatsapp_webhook_effects_failure_check" CHECK ("whatsapp_webhook_effects"."last_failure" IS NULL OR "whatsapp_webhook_effects"."last_failure" IN ('activity_failed', 'follow_up_failed'));
