-- migration-risk: additive
CREATE TABLE "opportunity_delivery_anchors" (
	"opportunity_id" uuid PRIMARY KEY NOT NULL,
	"quotation_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"receipt_at" timestamp with time zone NOT NULL,
	"created_action_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opportunity_delivery_anchors" ADD CONSTRAINT "opportunity_delivery_anchors_opportunity_id_crm_deals_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."crm_deals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_delivery_anchors" ADD CONSTRAINT "opportunity_delivery_anchors_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_delivery_anchors" ADD CONSTRAINT "opportunity_delivery_anchors_revision_id_quote_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."quote_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_delivery_anchors" ADD CONSTRAINT "opportunity_delivery_anchors_delivery_id_quotation_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."quotation_deliveries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_delivery_anchors" ADD CONSTRAINT "opportunity_delivery_anchors_created_action_id_opportunity_next_actions_id_fk" FOREIGN KEY ("created_action_id") REFERENCES "public"."opportunity_next_actions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_delivery_anchors_delivery_unique" ON "opportunity_delivery_anchors" USING btree ("delivery_id");--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_delivery_anchors_action_unique" ON "opportunity_delivery_anchors" USING btree ("created_action_id") WHERE "opportunity_delivery_anchors"."created_action_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "opportunity_delivery_anchors_quotation_idx" ON "opportunity_delivery_anchors" USING btree ("quotation_id");
