-- migration-risk: destructive
-- Replaces the fixed status check with a referenced, operator-configurable pipeline.
CREATE TABLE "crm_pipeline_stages" (
	"key" varchar(32) PRIMARY KEY NOT NULL,
	"name" varchar(80) NOT NULL,
	"position" integer NOT NULL,
	"role" varchar(16),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_pipeline_stages_key_not_blank_check" CHECK (char_length(btrim("crm_pipeline_stages"."key")) > 0),
	CONSTRAINT "crm_pipeline_stages_name_not_blank_check" CHECK (char_length(btrim("crm_pipeline_stages"."name")) > 0),
	CONSTRAINT "crm_pipeline_stages_position_check" CHECK ("crm_pipeline_stages"."position" >= 0),
	CONSTRAINT "crm_pipeline_stages_role_check" CHECK ("crm_pipeline_stages"."role" IS NULL OR "crm_pipeline_stages"."role" IN ('new', 'issued', 'won', 'lost'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "crm_pipeline_stages_name_lower_unique" ON "crm_pipeline_stages" USING btree (lower("name"));
--> statement-breakpoint
CREATE UNIQUE INDEX "crm_pipeline_stages_role_unique" ON "crm_pipeline_stages" USING btree ("role");
--> statement-breakpoint
INSERT INTO "crm_pipeline_stages" ("key", "name", "position", "role") VALUES
	('Novo Lead', 'Novo lead', 0, 'new'),
	('Contato Feito', 'Contato feito', 1, NULL),
	('Orcamento Enviado', 'Orçamento enviado', 2, 'issued'),
	('Em Negociacao', 'Em negociação', 3, NULL),
	('Arte Aprovada', 'Arte aprovada', 4, NULL),
	('Pedido Fechado', 'Pedido fechado', 5, 'won'),
	('Perdido', 'Perdido', 6, 'lost');
--> statement-breakpoint
ALTER TABLE "crm_deals" DROP CONSTRAINT "crm_deals_status_check";
--> statement-breakpoint
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_status_crm_pipeline_stages_key_fk" FOREIGN KEY ("status") REFERENCES "public"."crm_pipeline_stages"("key") ON DELETE restrict ON UPDATE no action;
