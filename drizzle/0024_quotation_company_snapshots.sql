-- migration-risk: additive
-- Company configuration is a singleton default; revision snapshots are immutable
-- application-owned captures. Existing rows receive the official defaults so the
-- v2 renderer never resolves live settings for a historical revision.
ALTER TABLE "app_settings" ADD COLUMN "company_configuration" jsonb DEFAULT '{"schema_version":1,"identity":{"legal_name":"ASPEN COMÉRCIO DE ARTIGOS PERSONALIZADOS LTDA","document":"55.458.072/0001-79"},"banking":{"bank_name":"Stone Pagamentos S.A.","bank_code":"197","branch":"0001","account":"35207618-6","pix_key":"55.458.072/0001-79"},"contacts":{"website":"https://www.aspenestamparia.com","phone":"(21) 96924-1265","email":"contato@aspenestamparia.com","instagram":"https://www.instagram.com/aspenestamparia"}}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "quote_revisions" ADD COLUMN "company_snapshot" jsonb;
--> statement-breakpoint
UPDATE "quote_revisions"
SET "company_snapshot" = '{"schema_version":1,"identity":{"legal_name":"ASPEN COMÉRCIO DE ARTIGOS PERSONALIZADOS LTDA","document":"55.458.072/0001-79"},"banking":{"bank_name":"Stone Pagamentos S.A.","bank_code":"197","branch":"0001","account":"35207618-6","pix_key":"55.458.072/0001-79"},"contacts":{"website":"https://www.aspenestamparia.com","phone":"(21) 96924-1265","email":"contato@aspenestamparia.com","instagram":"https://www.instagram.com/aspenestamparia"}}'::jsonb
WHERE "company_snapshot" IS NULL;
--> statement-breakpoint
DO $$
DECLARE
  missing_count integer;
BEGIN
  SELECT count(*)::integer
  INTO missing_count
  FROM "quote_revisions"
  WHERE "company_snapshot" IS NULL;
  IF missing_count <> 0 THEN
    RAISE EXCEPTION 'Backfill de configuração empresarial incompleto: % revisão(ões) sem snapshot.', missing_count;
  END IF;
END $$;
