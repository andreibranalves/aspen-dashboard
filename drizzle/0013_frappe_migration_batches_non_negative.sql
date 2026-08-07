ALTER TABLE "frappe_import_lineage" ADD COLUMN "provider" varchar(80) DEFAULT 'frappe' NOT NULL;--> statement-breakpoint
ALTER TABLE "frappe_import_lineage" ADD COLUMN "local_id" varchar(255);--> statement-breakpoint
ALTER TABLE "frappe_import_lineage" ADD COLUMN "source_hash" varchar(64);--> statement-breakpoint
UPDATE "frappe_import_lineage" SET "local_id" = "local_key" WHERE "local_id" IS NULL;--> statement-breakpoint
UPDATE "frappe_import_lineage" SET "source_hash" = "canonical_hash" WHERE "source_hash" IS NULL;--> statement-breakpoint
ALTER TABLE "frappe_import_lineage" ALTER COLUMN "local_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "frappe_import_lineage" ALTER COLUMN "source_hash" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "frappe_import_lineage_local_id_idx" ON "frappe_import_lineage" USING btree ("local_id");--> statement-breakpoint
ALTER TABLE "frappe_import_lineage" ADD CONSTRAINT "frappe_import_lineage_provider_check" CHECK (char_length(btrim("frappe_import_lineage"."provider")) > 0);--> statement-breakpoint
ALTER TABLE "frappe_import_lineage" ADD CONSTRAINT "frappe_import_lineage_local_id_check" CHECK (char_length(btrim("frappe_import_lineage"."local_id")) > 0);--> statement-breakpoint
ALTER TABLE "frappe_import_lineage" ADD CONSTRAINT "frappe_import_lineage_source_hash_check" CHECK ("frappe_import_lineage"."source_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "frappe_migration_batches" ADD CONSTRAINT "frappe_migration_batches_checkpoint_non_negative_check" CHECK ("frappe_migration_batches"."checkpoint" >= 0);--> statement-breakpoint
ALTER TABLE "frappe_migration_batches" ADD CONSTRAINT "frappe_migration_batches_attempt_count_non_negative_check" CHECK ("frappe_migration_batches"."attempt_count" >= 0);
