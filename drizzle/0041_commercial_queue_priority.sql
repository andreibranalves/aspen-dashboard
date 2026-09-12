-- migration-risk: additive
ALTER TABLE "crm_deals" ADD COLUMN "is_urgent" boolean DEFAULT false NOT NULL;
