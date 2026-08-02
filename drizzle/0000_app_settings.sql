CREATE TABLE "app_settings" (
	"singleton_id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"validade_dias" integer DEFAULT 15 NOT NULL,
	"pagamento" varchar(500) DEFAULT '' NOT NULL,
	"entrega" varchar(500) DEFAULT '' NOT NULL,
	"frete_padrao" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"observacoes" varchar(4000) DEFAULT '' NOT NULL,
	"template_padrao" varchar(120) DEFAULT 'padrao' NOT NULL,
	CONSTRAINT "app_settings_singleton_id_check" CHECK ("app_settings"."singleton_id" = 1),
	CONSTRAINT "app_settings_validade_dias_check" CHECK ("app_settings"."validade_dias" BETWEEN 1 AND 365),
	CONSTRAINT "app_settings_frete_padrao_check" CHECK ("app_settings"."frete_padrao" >= 0),
	CONSTRAINT "app_settings_template_padrao_not_blank_check" CHECK (char_length(btrim("app_settings"."template_padrao")) > 0)
);
