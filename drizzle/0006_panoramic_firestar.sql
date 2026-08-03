CREATE TABLE "issued_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"quotation_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"kind" varchar(32) DEFAULT 'quotation_pdf' NOT NULL,
	"blob_pathname" varchar(1024) NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"mime_type" varchar(100) DEFAULT 'application/pdf' NOT NULL,
	"size_bytes" integer NOT NULL,
	"checksum_sha256" varchar(64) NOT NULL,
	"template_key" varchar(120) NOT NULL,
	"template_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issued_documents_kind_check" CHECK ("issued_documents"."kind" = 'quotation_pdf'),
	CONSTRAINT "issued_documents_mime_type_check" CHECK ("issued_documents"."mime_type" = 'application/pdf'),
	CONSTRAINT "issued_documents_size_positive_check" CHECK ("issued_documents"."size_bytes" > 0),
	CONSTRAINT "issued_documents_checksum_check" CHECK ("issued_documents"."checksum_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "issued_documents_template_hash_check" CHECK ("issued_documents"."template_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "issued_documents" ADD CONSTRAINT "issued_documents_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issued_documents" ADD CONSTRAINT "issued_documents_revision_id_quote_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."quote_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "issued_documents_revision_unique" ON "issued_documents" USING btree ("revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issued_documents_blob_pathname_unique" ON "issued_documents" USING btree ("blob_pathname");--> statement-breakpoint
CREATE INDEX "issued_documents_quotation_created_idx" ON "issued_documents" USING btree ("quotation_id","created_at");