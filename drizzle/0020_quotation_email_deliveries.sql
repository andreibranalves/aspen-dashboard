CREATE TABLE "quotation_email_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"revision_id" uuid NOT NULL,
	"recipient" varchar(254) NOT NULL,
	"public_token" text,
	"state" text NOT NULL,
	"provider_email_id" text,
	"public_error" text,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "quotation_email_deliveries_provider_email_id_unique" UNIQUE("provider_email_id"),
	CONSTRAINT "quotation_email_deliveries_state_check" CHECK ("quotation_email_deliveries"."state" IN ('pending', 'accepted', 'failed')),
	CONSTRAINT "quotation_email_deliveries_public_token_check" CHECK (("quotation_email_deliveries"."state" = 'pending' AND btrim("quotation_email_deliveries"."public_token") <> '') OR ("quotation_email_deliveries"."state" IN ('accepted', 'failed') AND "quotation_email_deliveries"."public_token" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "quotation_email_deliveries" ADD CONSTRAINT "quotation_email_deliveries_revision_id_quote_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."quote_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quotation_email_deliveries_revision_state_accepted_idx" ON "quotation_email_deliveries" USING btree ("revision_id","state","accepted_at");