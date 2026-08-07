ALTER TABLE "quote_revisions" ADD COLUMN "status_original" varchar(64);--> statement-breakpoint
ALTER TABLE "quote_revisions" ADD COLUMN "order_linkage" varchar(32);--> statement-breakpoint
ALTER TABLE "quote_revisions" ADD COLUMN "order_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_revisions" ADD CONSTRAINT "quote_revisions_order_linkage_check" CHECK ("quote_revisions"."order_linkage" IS NULL OR "quote_revisions"."order_linkage" IN ('ordered', 'completed', 'closed'));