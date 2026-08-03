CREATE TABLE "quotations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_number" varchar(16) NOT NULL,
	"client_id" uuid NOT NULL,
	"status" varchar(32) DEFAULT 'rascunho' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotations_business_number_format_check" CHECK ("quotations"."business_number" ~ '^ORC-[0-9]{8}$'),
	CONSTRAINT "quotations_status_not_blank_check" CHECK (char_length(btrim("quotations"."status")) > 0)
);
--> statement-breakpoint
CREATE TABLE "quote_revision_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"revision_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"product_sku" varchar(120) NOT NULL,
	"quantidade" numeric(14, 3) NOT NULL,
	"produto_sku" varchar(120) NOT NULL,
	"produto_nome" varchar(255) NOT NULL,
	"produto_descricao" varchar(4000) DEFAULT '' NOT NULL,
	"produto_unidade" varchar(32) DEFAULT 'Und' NOT NULL,
	"produto_categoria" varchar(255),
	"produto_marca" varchar(255),
	"preco_fonte" varchar(32) NOT NULL,
	"preco_minimo_faixa" numeric(14, 3),
	"preco_sugerido" numeric(20, 2) NOT NULL,
	"preco_aplicado" numeric(20, 2) NOT NULL,
	"diferenca_preco" numeric(20, 2) DEFAULT '0.00' NOT NULL,
	"total_linha" numeric(20, 2) NOT NULL,
	"manual_rate" boolean DEFAULT false NOT NULL,
	CONSTRAINT "quote_revision_items_position_check" CHECK ("quote_revision_items"."position" >= 0),
	CONSTRAINT "quote_revision_items_quantity_check" CHECK ("quote_revision_items"."quantidade" > 0),
	CONSTRAINT "quote_revision_items_prices_check" CHECK ("quote_revision_items"."preco_sugerido" > 0 AND "quote_revision_items"."preco_aplicado" > 0),
	CONSTRAINT "quote_revision_items_total_check" CHECK ("quote_revision_items"."total_linha" >= 0)
);
--> statement-breakpoint
CREATE TABLE "quote_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"quotation_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" varchar(32) DEFAULT 'rascunho' NOT NULL,
	"validade_dias" integer NOT NULL,
	"pagamento" varchar(500) DEFAULT '' NOT NULL,
	"entrega" varchar(500) DEFAULT '' NOT NULL,
	"frete_padrao" numeric(20, 2) DEFAULT '0.00' NOT NULL,
	"frete" numeric(20, 2) DEFAULT '0.00' NOT NULL,
	"observacoes" varchar(4000) DEFAULT '' NOT NULL,
	"prazo_producao" varchar(500) DEFAULT '' NOT NULL,
	"template_padrao" varchar(120) DEFAULT 'padrao' NOT NULL,
	"cliente_nome" varchar(200) NOT NULL,
	"cliente_documento" varchar(14),
	"cliente_email" varchar(254),
	"cliente_telefone" varchar(15),
	"cliente_endereco" varchar(255),
	"cliente_numero" varchar(30),
	"cliente_bairro" varchar(120),
	"cliente_complemento" varchar(120),
	"cliente_municipio" varchar(120),
	"cliente_uf" varchar(2),
	"cliente_cep" varchar(8),
	"cliente_notas" varchar(4000),
	"subtotal" numeric(20, 2) DEFAULT '0.00' NOT NULL,
	"total" numeric(20, 2) DEFAULT '0.00' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_revisions_version_positive_check" CHECK ("quote_revisions"."version" > 0),
	CONSTRAINT "quote_revisions_validade_dias_check" CHECK ("quote_revisions"."validade_dias" BETWEEN 1 AND 365),
	CONSTRAINT "quote_revisions_frete_padrao_check" CHECK ("quote_revisions"."frete_padrao" >= 0),
	CONSTRAINT "quote_revisions_frete_check" CHECK ("quote_revisions"."frete" >= 0),
	CONSTRAINT "quote_revisions_subtotal_check" CHECK ("quote_revisions"."subtotal" >= 0),
	CONSTRAINT "quote_revisions_total_check" CHECK ("quote_revisions"."total" >= 0),
	CONSTRAINT "quote_revisions_status_not_blank_check" CHECK (char_length(btrim("quote_revisions"."status")) > 0)
);
--> statement-breakpoint
CREATE TABLE "quote_sequences" (
	"year" integer PRIMARY KEY NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "quote_sequences_year_check" CHECK ("quote_sequences"."year" BETWEEN 2000 AND 9999),
	CONSTRAINT "quote_sequences_last_number_check" CHECK ("quote_sequences"."last_number" >= 0 AND "quote_sequences"."last_number" <= 9999)
);
--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_revision_items" ADD CONSTRAINT "quote_revision_items_revision_id_quote_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."quote_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_revision_items" ADD CONSTRAINT "quote_revision_items_product_sku_products_sku_fk" FOREIGN KEY ("product_sku") REFERENCES "public"."products"("sku") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_revisions" ADD CONSTRAINT "quote_revisions_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quotations_business_number_unique" ON "quotations" USING btree ("business_number");--> statement-breakpoint
CREATE INDEX "quotations_client_created_idx" ON "quotations" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_revision_items_revision_position_unique" ON "quote_revision_items" USING btree ("revision_id","position");--> statement-breakpoint
CREATE INDEX "quote_revision_items_product_idx" ON "quote_revision_items" USING btree ("product_sku");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_revisions_quotation_version_unique" ON "quote_revisions" USING btree ("quotation_id","version");--> statement-breakpoint
CREATE INDEX "quote_revisions_quotation_idx" ON "quote_revisions" USING btree ("quotation_id","version");