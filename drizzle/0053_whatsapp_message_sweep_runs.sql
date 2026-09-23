-- migration-risk: additive
CREATE TABLE "whatsapp_message_sweep_runs" (
	"worker" text PRIMARY KEY NOT NULL,
	"last_run_at" timestamp with time zone NOT NULL,
	"result" varchar(16) NOT NULL,
	"requeued" integer DEFAULT 0 NOT NULL,
	"to_review" integer DEFAULT 0 NOT NULL,
	"dispatched" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_message_sweep_runs" ADD CONSTRAINT "whatsapp_message_sweep_runs_result_check" CHECK ("whatsapp_message_sweep_runs"."result" IN ('success', 'failure'));
