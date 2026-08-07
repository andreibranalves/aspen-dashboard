CREATE TABLE "frappe_migration_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" varchar(80) DEFAULT 'frappe' NOT NULL,
	"mode" varchar(20) NOT NULL,
	"source_snapshot_at" timestamp with time zone NOT NULL,
	"manifest_hash" varchar(64) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "frappe_migration_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"entity_type" varchar(32) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"checkpoint" integer DEFAULT 0 NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "frappe_import_lineage" ADD COLUMN "migration_run_id" uuid;--> statement-breakpoint
ALTER TABLE "frappe_import_lineage" ADD COLUMN "source_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "frappe_import_lineage" ADD COLUMN "imported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "frappe_migration_runs" ADD CONSTRAINT "frappe_migration_runs_mode_check" CHECK ("frappe_migration_runs"."mode" IN ('dry-run', 'apply'));--> statement-breakpoint
ALTER TABLE "frappe_migration_runs" ADD CONSTRAINT "frappe_migration_runs_status_check" CHECK ("frappe_migration_runs"."status" IN ('pending', 'running', 'completed', 'failed'));--> statement-breakpoint
ALTER TABLE "frappe_migration_runs" ADD CONSTRAINT "frappe_migration_runs_manifest_hash_check" CHECK ("frappe_migration_runs"."manifest_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "frappe_migration_batches" ADD CONSTRAINT "frappe_migration_batches_entity_type_check" CHECK ("frappe_migration_batches"."entity_type" IN ('produtos', 'faixas', 'clientes', 'orcamentos', 'documentos'));--> statement-breakpoint
ALTER TABLE "frappe_migration_batches" ADD CONSTRAINT "frappe_migration_batches_status_check" CHECK ("frappe_migration_batches"."status" IN ('pending', 'running', 'completed', 'failed'));--> statement-breakpoint
ALTER TABLE "frappe_migration_batches" ADD CONSTRAINT "frappe_migration_batches_run_id_frappe_migration_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."frappe_migration_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frappe_import_lineage" ADD CONSTRAINT "frappe_import_lineage_migration_run_id_frappe_migration_runs_id_fk" FOREIGN KEY ("migration_run_id") REFERENCES "public"."frappe_migration_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "frappe_migration_batches_run_entity_unique" ON "frappe_migration_batches" USING btree ("run_id","entity_type");--> statement-breakpoint
CREATE INDEX "frappe_import_lineage_run_idx" ON "frappe_import_lineage" USING btree ("migration_run_id");
