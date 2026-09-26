-- migration-risk: additive
ALTER TABLE "quotations" ADD COLUMN "lead_source" varchar(40);
