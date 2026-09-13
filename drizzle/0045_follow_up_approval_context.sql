-- migration-risk: additive
ALTER TABLE "quotation_follow_ups" ADD COLUMN "approved_opportunity_id" uuid;--> statement-breakpoint
ALTER TABLE "quotation_follow_ups" ADD CONSTRAINT "quotation_follow_ups_approved_opportunity_id_crm_deals_id_fk" FOREIGN KEY ("approved_opportunity_id") REFERENCES "public"."crm_deals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quotation_follow_ups_approved_opportunity_unique" ON "quotation_follow_ups" USING btree ("approved_opportunity_id") WHERE "quotation_follow_ups"."approved_opportunity_id" IS NOT NULL AND "quotation_follow_ups"."state" IN ('approved', 'processing');
--> statement-breakpoint
ALTER TABLE "quotation_follow_ups" DROP CONSTRAINT "quotation_follow_ups_closed_reason_check";--> statement-breakpoint
ALTER TABLE "quotation_follow_ups" ADD CONSTRAINT "quotation_follow_ups_closed_reason_check" CHECK ("quotation_follow_ups"."closed_reason" IS NULL OR "quotation_follow_ups"."closed_reason" IN (
  'already_handled',
  'do_not_contact',
  'no_continuity',
  'wrong_contact',
  'other',
  'before_tracking_start',
  'newer_delivery_in_flight',
  'delivery_incomplete',
  'missing_provider_receipt',
  'quotation_not_issued',
  'crm_not_eligible',
  'client_archived',
  'identity_unresolved',
  'contact_blocked',
  'inbound_after_anchor',
  'outbound_after_anchor',
  'already_attempted',
  'provider_rejected',
  'rate_limited',
  'transport_ambiguous',
  'lease_expired_after_transport',
  'instance_changed'
));
