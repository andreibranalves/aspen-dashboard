CREATE TABLE "products" (
	"sku" varchar(120) PRIMARY KEY NOT NULL,
	"nome" varchar(255) NOT NULL,
	"descricao" varchar(4000) DEFAULT '' NOT NULL,
	"unidade" varchar(32) DEFAULT 'Und' NOT NULL,
	"categoria" varchar(255),
	"marca" varchar(255),
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"arquivado_em" timestamp with time zone,
	CONSTRAINT "products_sku_trimmed_check" CHECK (char_length(btrim("products"."sku")) > 0 AND btrim("products"."sku") = "products"."sku"),
	CONSTRAINT "products_nome_not_blank_check" CHECK (char_length(btrim("products"."nome")) > 0),
	CONSTRAINT "products_unidade_not_blank_check" CHECK (char_length(btrim("products"."unidade")) > 0)
);
