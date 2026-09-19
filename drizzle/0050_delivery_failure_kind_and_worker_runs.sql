-- migration-risk: additive
ALTER TABLE "quotation_delivery_steps" ADD COLUMN "failure_kind" text;--> statement-breakpoint
CREATE TABLE "quotation_delivery_worker_runs" (
	"worker" text PRIMARY KEY NOT NULL,
	"last_run_at" timestamp with time zone NOT NULL,
	"processed" integer NOT NULL,
	"remaining" boolean NOT NULL
);--> statement-breakpoint
ALTER TABLE "quotation_delivery_steps" ADD CONSTRAINT "quotation_delivery_steps_failure_kind_check" CHECK ("quotation_delivery_steps"."failure_kind" IS NULL OR "quotation_delivery_steps"."failure_kind" IN ('transient_pre_transport', 'permanent_pre_transport', 'ambiguous'));
