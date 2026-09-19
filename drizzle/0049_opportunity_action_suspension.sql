-- migration-risk: additive
ALTER TABLE "opportunity_next_actions" DROP CONSTRAINT "opportunity_next_actions_state_check";
--> statement-breakpoint
ALTER TABLE "opportunity_next_actions" ADD CONSTRAINT "opportunity_next_actions_state_check" CHECK ("opportunity_next_actions"."state" IN ('active', 'suspended', 'completed', 'cancelled', 'superseded'));
