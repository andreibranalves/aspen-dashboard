ALTER TABLE "frappe_import_lineage" DROP CONSTRAINT "frappe_import_lineage_source_hash_check";--> statement-breakpoint
ALTER TABLE "frappe_import_lineage" ALTER COLUMN "source_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "frappe_import_lineage" ADD COLUMN "lineage_status" varchar(24) DEFAULT 'legacy-unverified' NOT NULL;--> statement-breakpoint
-- Rows created before 0014 have no verifiable source-payload fingerprint.
-- Keep them explicitly blocking until a fresh import reconciles the payload.
UPDATE "frappe_import_lineage"
SET "source_hash" = NULL, "lineage_status" = 'legacy-unverified';--> statement-breakpoint
ALTER TABLE "frappe_import_lineage" ADD CONSTRAINT "frappe_import_lineage_status_check" CHECK ("frappe_import_lineage"."lineage_status" IN ('verified', 'legacy-unverified'));--> statement-breakpoint
ALTER TABLE "frappe_import_lineage" ADD CONSTRAINT "frappe_import_lineage_source_hash_check" CHECK ("frappe_import_lineage"."source_hash" IS NULL OR "frappe_import_lineage"."source_hash" ~ '^[0-9a-f]{64}$');
