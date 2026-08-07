ALTER TABLE "frappe_migration_batches" ADD CONSTRAINT "frappe_migration_batches_checkpoint_non_negative_check" CHECK ("frappe_migration_batches"."checkpoint" >= 0);--> statement-breakpoint
ALTER TABLE "frappe_migration_batches" ADD CONSTRAINT "frappe_migration_batches_attempt_count_non_negative_check" CHECK ("frappe_migration_batches"."attempt_count" >= 0);
