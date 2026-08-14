CREATE TABLE "quotation_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"revision_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"flow_id" text NOT NULL,
	"state" text NOT NULL,
	"provider_acceptance_id" text,
	"public_error" text,
	"diagnostics_expires_at" timestamp with time zone,
	"resumable_until" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "quotation_deliveries_revision_id_unique" UNIQUE("revision_id"),
	CONSTRAINT "quotation_deliveries_state_check" CHECK ("quotation_deliveries"."state" IN ('pending', 'transporting', 'accepted_partial', 'completed', 'retryable', 'reconciling'))
);
--> statement-breakpoint
CREATE TABLE "quotation_issue_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"state" text NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"public_error" text,
	"quotation_id" uuid,
	"revision_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "quotation_issue_requests_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "quotation_issue_requests_state_check" CHECK ("quotation_issue_requests"."state" IN ('processing', 'retryable', 'completed'))
);
--> statement-breakpoint
ALTER TABLE "quotations" DROP CONSTRAINT "quotations_status_check";--> statement-breakpoint
ALTER TABLE "quote_revisions" DROP CONSTRAINT "quote_revisions_status_check";--> statement-breakpoint
UPDATE "quotations" SET "status" = 'emitido' WHERE "status" = 'enviado';--> statement-breakpoint
UPDATE "quote_revisions" SET "status" = 'emitido' WHERE "status" = 'enviado';--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "issued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "loss_reason" text;--> statement-breakpoint
UPDATE "quotations" SET "loss_reason" = 'Motivo legado não informado' WHERE "status" = 'perdido';--> statement-breakpoint
ALTER TABLE "quote_revisions" ADD COLUMN "issued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quotation_deliveries" ADD CONSTRAINT "quotation_deliveries_revision_id_quote_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."quote_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_issue_requests" ADD CONSTRAINT "quotation_issue_requests_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_issue_requests" ADD CONSTRAINT "quotation_issue_requests_revision_id_quote_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."quote_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_status_check" CHECK ("quotations"."status" IN ('rascunho', 'emitido', 'aprovado', 'perdido'));--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_loss_reason_check" CHECK ((("quotations"."status" = 'perdido' AND "quotations"."loss_reason" IS NOT NULL AND btrim("quotations"."loss_reason") <> '') OR ("quotations"."status" <> 'perdido' AND "quotations"."loss_reason" IS NULL)));--> statement-breakpoint
ALTER TABLE "quote_revisions" ADD CONSTRAINT "quote_revisions_status_check" CHECK ("quote_revisions"."status" IN ('rascunho', 'emitido', 'aprovado', 'perdido'));