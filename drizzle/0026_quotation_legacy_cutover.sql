-- migration-risk: destructive
-- Cutover final do snapshot comercial canônico (#79). Aprovação humana
-- explícita é pré-requisito para criar ou executar esta migration.
--
-- Etapa 1 (consolidação): reconstrói o sections_snapshot canônico das revisões
-- antigas a partir dos espelhos pagamento/entrega/observacoes/prazo_producao,
-- com a mesma semântica de `snapshotFromLegacyRevision` (seções padrão,
-- "Prazo de entrega"/"Observações" combinadas em condicoes_gerais, prazo
-- habilitado somente quando o espelho tem conteúdo). Nenhum valor visível ao
-- cliente muda: o JSON derivado é exatamente o que os leitores já projetavam.
UPDATE "quote_revisions"
SET "sections_snapshot" = jsonb_build_object(
  'schema_version', 1,
  'prazo_producao', jsonb_build_object(
    'base', jsonb_build_object('enabled', ("prazo_producao" <> ''), 'title', 'Prazo de produção', 'value', "prazo_producao"),
    'current', jsonb_build_object('enabled', ("prazo_producao" <> ''), 'title', 'Prazo de produção', 'value', "prazo_producao")
  ),
  'pagamento', jsonb_build_object(
    'base', jsonb_build_object('enabled', true, 'title', 'Pagamento', 'body', "pagamento"),
    'current', jsonb_build_object('enabled', true, 'title', 'Pagamento', 'body', "pagamento")
  ),
  'condicoes_gerais', jsonb_build_object(
    'base', jsonb_build_object('enabled', true, 'title', 'Condições Gerais', 'body',
      array_to_string(array_remove(ARRAY[
        CASE WHEN "entrega" <> '' THEN 'Prazo de entrega:' || E'\n' || "entrega" END,
        CASE WHEN "observacoes" <> '' THEN 'Observações:' || E'\n' || "observacoes" END
      ], NULL), E'\n\n')),
    'current', jsonb_build_object('enabled', true, 'title', 'Condições Gerais', 'body',
      array_to_string(array_remove(ARRAY[
        CASE WHEN "entrega" <> '' THEN 'Prazo de entrega:' || E'\n' || "entrega" END,
        CASE WHEN "observacoes" <> '' THEN 'Observações:' || E'\n' || "observacoes" END
      ], NULL), E'\n\n'))
  )
)
WHERE "sections_snapshot" IS NULL;
--> statement-breakpoint
DO $$
DECLARE missing_sections integer;
BEGIN
  SELECT count(*)::integer INTO missing_sections FROM "quote_revisions" WHERE "sections_snapshot" IS NULL;
  IF missing_sections <> 0 THEN
    RAISE EXCEPTION 'Backfill de sections_snapshot incompleto: % revisão(ões) sem snapshot.', missing_sections;
  END IF;
END $$;
--> statement-breakpoint
-- Etapa 2 (consolidação): resolve a versão de template persistida para as
-- revisões históricas que só tinham identidade key/hash.
UPDATE "quote_revisions" AS revision
SET "template_version_id" = version."id"
FROM "quotation_template_versions" AS version
JOIN "quotation_templates" AS template ON template."id" = version."template_id"
WHERE revision."template_version_id" IS NULL
  AND template."key" = revision."template_padrao"
  AND version."source_hash" = revision."template_hash";
--> statement-breakpoint
DO $$
DECLARE unresolved integer;
BEGIN
  SELECT count(*)::integer INTO unresolved FROM "quote_revisions" WHERE "template_version_id" IS NULL;
  IF unresolved <> 0 THEN
    RAISE EXCEPTION 'Backfill de template_version_id incompleto: % revisão(ões) sem versão resolvida.', unresolved;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "quote_revisions" ALTER COLUMN "template_version_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_revisions" ALTER COLUMN "sections_snapshot" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" DROP COLUMN "pagamento";--> statement-breakpoint
ALTER TABLE "app_settings" DROP COLUMN "quotation_email_template";--> statement-breakpoint
ALTER TABLE "app_settings" DROP COLUMN "observacoes";--> statement-breakpoint
ALTER TABLE "quote_revisions" DROP COLUMN "pagamento";--> statement-breakpoint
ALTER TABLE "quote_revisions" DROP COLUMN "observacoes";--> statement-breakpoint
ALTER TABLE "quote_revisions" DROP COLUMN "prazo_producao";
