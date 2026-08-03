ALTER TABLE "frappe_import_lineage" DROP CONSTRAINT "frappe_import_lineage_entity_type_check";--> statement-breakpoint
ALTER TABLE "issued_documents" DROP CONSTRAINT "issued_documents_kind_check";--> statement-breakpoint
ALTER TABLE "issued_documents" DROP CONSTRAINT "issued_documents_size_positive_check";--> statement-breakpoint
ALTER TABLE "frappe_import_lineage" ADD CONSTRAINT "frappe_import_lineage_entity_type_check" CHECK ("frappe_import_lineage"."entity_type" IN ('produto', 'faixa', 'cliente', 'orcamento'));--> statement-breakpoint
ALTER TABLE "issued_documents" ADD CONSTRAINT "issued_documents_kind_check" CHECK ("issued_documents"."kind" IN ('quotation_pdf', 'historical_pdf_import'));--> statement-breakpoint
ALTER TABLE "issued_documents" ADD CONSTRAINT "issued_documents_size_positive_check" CHECK ("issued_documents"."size_bytes" >= 0);