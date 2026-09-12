-- migration-risk: additive
ALTER TABLE "manual_contact_events" DROP CONSTRAINT "manual_contact_events_result_code_check";--> statement-breakpoint
ALTER TABLE "manual_contact_events" ADD CONSTRAINT "manual_contact_events_result_code_check" CHECK ("manual_contact_events"."result_code" IN ('follow_up_agreed', 'interested', 'not_interested', 'no_response', 'awaiting_information', 'wrong_contact', 'other'));
