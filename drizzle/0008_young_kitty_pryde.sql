CREATE TABLE "frappe_import_lineage" (
	"source_doctype" varchar(80) NOT NULL,
	"source_id" varchar(255) NOT NULL,
	"entity_type" varchar(32) NOT NULL,
	"local_key" varchar(255) NOT NULL,
	"canonical_hash" varchar(64) NOT NULL,
	"legacy_payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "frappe_import_lineage_pkey" PRIMARY KEY("source_doctype","source_id"),
	CONSTRAINT "frappe_import_lineage_source_doctype_check" CHECK (char_length(btrim("frappe_import_lineage"."source_doctype")) > 0),
	CONSTRAINT "frappe_import_lineage_source_id_check" CHECK (char_length(btrim("frappe_import_lineage"."source_id")) > 0),
	CONSTRAINT "frappe_import_lineage_entity_type_check" CHECK ("frappe_import_lineage"."entity_type" IN ('produto', 'faixa', 'cliente')),
	CONSTRAINT "frappe_import_lineage_local_key_check" CHECK (char_length(btrim("frappe_import_lineage"."local_key")) > 0),
	CONSTRAINT "frappe_import_lineage_hash_check" CHECK ("frappe_import_lineage"."canonical_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE INDEX "frappe_import_lineage_local_key_idx" ON "frappe_import_lineage" USING btree ("local_key");--> statement-breakpoint
CREATE INDEX "frappe_import_lineage_entity_local_idx" ON "frappe_import_lineage" USING btree ("entity_type","local_key");--> statement-breakpoint
CREATE INDEX "frappe_import_lineage_hash_idx" ON "frappe_import_lineage" USING btree ("canonical_hash");