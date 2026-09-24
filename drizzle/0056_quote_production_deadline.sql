-- migration-risk: additive
ALTER TABLE "quote_revisions" ADD COLUMN "production_days" integer DEFAULT 20 NOT NULL;
--> statement-breakpoint
ALTER TABLE "quote_revisions" ADD COLUMN "surcharge_percent" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "quote_revisions" ADD CONSTRAINT "quote_revisions_production_days_check" CHECK ("quote_revisions"."production_days" BETWEEN 1 AND 365);
--> statement-breakpoint
ALTER TABLE "quote_revisions" ADD CONSTRAINT "quote_revisions_surcharge_percent_check" CHECK ("quote_revisions"."surcharge_percent" BETWEEN 0 AND 200);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "production_days" integer DEFAULT 20 NOT NULL;
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "production_deadline_complement" varchar(300) DEFAULT 'após confirmação do pagamento e aprovação da arte.' NOT NULL;
--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_production_days_check" CHECK ("app_settings"."production_days" BETWEEN 1 AND 365);
