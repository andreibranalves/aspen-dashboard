-- migration-risk: additive
ALTER TABLE "opportunity_next_actions" DROP CONSTRAINT "opportunity_next_actions_kind_check";--> statement-breakpoint
ALTER TABLE "opportunity_next_actions" ADD COLUMN "due_date" date;--> statement-breakpoint
ALTER TABLE "opportunity_next_actions" ADD COLUMN "due_time" time;--> statement-breakpoint
ALTER TABLE "opportunity_next_actions" ADD COLUMN "schedule_type" varchar(16) DEFAULT 'timed' NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunity_next_actions" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunity_next_actions" ADD COLUMN "actor" varchar(128) DEFAULT 'legacy-system' NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunity_next_actions" ADD COLUMN "reason" varchar(500) DEFAULT 'legacy action' NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunity_next_actions" ADD COLUMN "transition_actor" varchar(128);--> statement-breakpoint
ALTER TABLE "opportunity_next_actions" ADD COLUMN "transition_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "opportunity_next_actions" ADD COLUMN "transition_origin" varchar(16);--> statement-breakpoint
ALTER TABLE "opportunity_next_actions" ADD COLUMN "transition_reason" varchar(500);--> statement-breakpoint
ALTER TABLE "opportunity_next_actions" ADD COLUMN "replaced_by_id" uuid;--> statement-breakpoint
UPDATE "opportunity_next_actions"
SET "due_date" = ("due_at" AT TIME ZONE 'America/Sao_Paulo')::date,
    "due_time" = ("due_at" AT TIME ZONE 'America/Sao_Paulo')::time
WHERE "due_date" IS NULL;--> statement-breakpoint
ALTER TABLE "opportunity_next_actions" ADD CONSTRAINT "opportunity_next_actions_schedule_type_check" CHECK ("opportunity_next_actions"."schedule_type" IN ('date_only', 'timed'));--> statement-breakpoint
ALTER TABLE "opportunity_next_actions" ADD CONSTRAINT "opportunity_next_actions_version_check" CHECK ("opportunity_next_actions"."version" > 0);--> statement-breakpoint
ALTER TABLE "opportunity_next_actions" ADD CONSTRAINT "opportunity_next_actions_date_only_check" CHECK ("opportunity_next_actions"."schedule_type" <> 'date_only' OR ("opportunity_next_actions"."due_date" IS NOT NULL AND "opportunity_next_actions"."due_time" IS NULL));--> statement-breakpoint
ALTER TABLE "opportunity_next_actions" ADD CONSTRAINT "opportunity_next_actions_transition_reason_check" CHECK ("opportunity_next_actions"."transition_reason" IS NULL OR char_length(btrim("opportunity_next_actions"."transition_reason")) > 0);--> statement-breakpoint
ALTER TABLE "opportunity_next_actions" ADD CONSTRAINT "opportunity_next_actions_transition_origin_check" CHECK ("opportunity_next_actions"."transition_origin" IS NULL OR "opportunity_next_actions"."transition_origin" IN ('manual', 'automatic', 'event'));--> statement-breakpoint
ALTER TABLE "opportunity_next_actions" ADD CONSTRAINT "opportunity_next_actions_kind_check" CHECK ("opportunity_next_actions"."kind" IN ('first_contact', 'internal', 'customer_contact', 'agreed_commitment', 'review'));
