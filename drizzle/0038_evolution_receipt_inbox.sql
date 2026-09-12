-- migration-risk: additive
CREATE TABLE "evolution_receipt_inbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider_message_id" text NOT NULL,
	"status" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"applied_at" timestamp with time zone,
	CONSTRAINT "evolution_receipt_inbox_status_check" CHECK ("evolution_receipt_inbox"."status" IN ('ERROR', 'PENDING', 'SERVER_ACK', 'DELIVERY_ACK', 'READ', 'PLAYED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "evolution_receipt_inbox_event_unique" ON "evolution_receipt_inbox" USING btree ("provider_message_id","status");--> statement-breakpoint
CREATE INDEX "evolution_receipt_inbox_pending_idx" ON "evolution_receipt_inbox" USING btree ("provider_message_id") WHERE "evolution_receipt_inbox"."applied_at" IS NULL;--> statement-breakpoint
CREATE INDEX "evolution_receipt_inbox_received_idx" ON "evolution_receipt_inbox" USING btree ("received_at");
--> statement-breakpoint
ALTER TABLE "quotation_deliveries" ADD COLUMN "follow_up_projection_attempted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "quotation_deliveries_follow_up_projection_idx" ON "quotation_deliveries" USING btree ("state","follow_up_projection_attempted_at");
