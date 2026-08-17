CREATE TABLE "quotation_delivery_steps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"delivery_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"type" text NOT NULL,
	"payload_snapshot" jsonb NOT NULL,
	"state" text NOT NULL,
	"provider_message_id" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"reconciliation_deadline" timestamp with time zone,
	"public_error" text,
	"accepted_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "quotation_delivery_steps_provider_message_id_unique" UNIQUE("provider_message_id"),
	CONSTRAINT "quotation_delivery_steps_state_check" CHECK ("quotation_delivery_steps"."state" IN ('queued', 'sending', 'server_ack', 'reconciling', 'retry_scheduled', 'needs_review', 'delivered', 'read', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "quotation_deliveries" DROP CONSTRAINT "quotation_deliveries_revision_id_unique";
--> statement-breakpoint
ALTER TABLE "quotation_deliveries" DROP CONSTRAINT "quotation_deliveries_state_check";
--> statement-breakpoint
ALTER TABLE "quotation_deliveries" ADD COLUMN "flow_name" text;
--> statement-breakpoint
ALTER TABLE "quotation_deliveries" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "quotation_deliveries" ADD COLUMN "next_attempt_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "quotation_deliveries" ADD COLUMN "lease_token" uuid;
--> statement-breakpoint
ALTER TABLE "quotation_deliveries" ADD COLUMN "lease_until" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "quotation_deliveries" ADD COLUMN "reconciliation_deadline" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "quotation_deliveries" ADD COLUMN "completion_source" text;
--> statement-breakpoint
ALTER TABLE "quotation_deliveries" ADD COLUMN "resolved_by" text;
--> statement-breakpoint
ALTER TABLE "quotation_deliveries" ADD COLUMN "resolved_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "quotation_deliveries" ADD COLUMN "resolution_note" text;
--> statement-breakpoint
ALTER TABLE "quotation_deliveries" ADD COLUMN "delivered_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "quotation_deliveries"
SET
  "state" = CASE
    WHEN "state" = 'completed' THEN 'provider_accepted'
    ELSE 'needs_review'
  END,
  "completion_source" = CASE
    WHEN "state" = 'completed' THEN 'legacy_provider_ack'
    ELSE NULL
  END,
  "flow_name" = "flow_id",
  "next_attempt_at" = NULL,
  "lease_token" = NULL,
  "lease_until" = NULL,
  "updated_at" = CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE "quotation_deliveries" ALTER COLUMN "flow_name" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "quotation_delivery_steps" ADD CONSTRAINT "quotation_delivery_steps_delivery_id_quotation_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."quotation_deliveries"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "quotation_delivery_steps_delivery_position_unique" ON "quotation_delivery_steps" USING btree ("delivery_id","position");
--> statement-breakpoint
CREATE INDEX "quotation_delivery_steps_due_idx" ON "quotation_delivery_steps" USING btree ("state","next_attempt_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "quotation_deliveries_revision_flow_unique" ON "quotation_deliveries" USING btree ("revision_id","flow_id");
--> statement-breakpoint
CREATE INDEX "quotation_deliveries_due_idx" ON "quotation_deliveries" USING btree ("state","next_attempt_at");
--> statement-breakpoint
ALTER TABLE "quotation_deliveries" ADD CONSTRAINT "quotation_deliveries_completion_source_check" CHECK ("quotation_deliveries"."completion_source" IS NULL OR "quotation_deliveries"."completion_source" IN ('provider_receipt', 'operator', 'legacy_provider_ack'));
--> statement-breakpoint
ALTER TABLE "quotation_deliveries" ADD CONSTRAINT "quotation_deliveries_state_check" CHECK ("quotation_deliveries"."state" IN ('queued', 'processing', 'provider_accepted', 'reconciling', 'retry_scheduled', 'needs_review', 'delivered', 'failed'));
