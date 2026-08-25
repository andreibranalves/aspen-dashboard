-- migration-risk: additive
ALTER TABLE "quotation_template_versions" ADD COLUMN "contract_version" integer;
--> statement-breakpoint
-- Existing versions predate explicit contracts and remain historical v1.
UPDATE "quotation_template_versions"
SET "contract_version" = 1
WHERE "contract_version" IS NULL;
--> statement-breakpoint
ALTER TABLE "quotation_template_versions" ALTER COLUMN "contract_version" SET DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "quotation_template_versions" ALTER COLUMN "contract_version" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "quotation_template_versions" ADD CONSTRAINT "quotation_template_versions_contract_version_check" CHECK ("quotation_template_versions"."contract_version" IN (1, 2));
--> statement-breakpoint
DO $$
DECLARE
  invalid_count integer;
BEGIN
  SELECT count(*)::integer
  INTO invalid_count
  FROM "quotation_template_versions"
  WHERE "contract_version" NOT IN (1, 2);
  IF invalid_count <> 0 THEN
    RAISE EXCEPTION 'Backfill de contrato de templates incompleto: % versão(ões) inválida(s).', invalid_count;
  END IF;
END $$;
