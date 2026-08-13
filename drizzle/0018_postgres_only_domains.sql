CREATE TABLE "crm_deals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"quote_lead_id" uuid,
	"client_id" uuid,
	"quotation_id" uuid,
	"nome" varchar(200) NOT NULL,
	"email" varchar(254),
	"telefone" varchar(15),
	"status" varchar(32) DEFAULT 'Novo Lead' NOT NULL,
	"follow_up_stage" integer DEFAULT 0 NOT NULL,
	"next_step" varchar(500),
	"lost_reason" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_deals_nome_not_blank_check" CHECK (char_length(btrim("crm_deals"."nome")) > 0),
	CONSTRAINT "crm_deals_email_lowercase_check" CHECK ("crm_deals"."email" IS NULL OR "crm_deals"."email" = lower("crm_deals"."email")),
	CONSTRAINT "crm_deals_telefone_digits_check" CHECK ("crm_deals"."telefone" IS NULL OR "crm_deals"."telefone" ~ '^[0-9]{10,15}$'),
	CONSTRAINT "crm_deals_follow_up_stage_check" CHECK ("crm_deals"."follow_up_stage" >= 0),
	CONSTRAINT "crm_deals_status_check" CHECK ("crm_deals"."status" IN ('Novo Lead', 'Contato Feito', 'Orcamento Enviado', 'Em Negociacao', 'Arte Aprovada', 'Pedido Fechado', 'Perdido'))
);
--> statement-breakpoint
CREATE TABLE "product_activity_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_sku" varchar(120) NOT NULL,
	"tipo" varchar(16) NOT NULL,
	"texto" varchar(1000) NOT NULL,
	"reference_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_activity_events_tipo_check" CHECK ("product_activity_events"."tipo" IN ('produto', 'preco', 'orcamento', 'pedido')),
	CONSTRAINT "product_activity_events_texto_not_blank_check" CHECK (char_length(btrim("product_activity_events"."texto")) > 0)
);
--> statement-breakpoint
CREATE TABLE "quote_leads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"identity_key" varchar(512) NOT NULL,
	"nome" varchar(200),
	"email" varchar(254),
	"telefone" varchar(15),
	"pedido_texto" varchar(4000),
	"source" varchar(80) DEFAULT 'typebot' NOT NULL,
	"source_detail" varchar(255),
	"external_id" varchar(255),
	"empresa" varchar(255),
	"produto" varchar(255),
	"quantidade" varchar(255),
	"finalidade" varchar(255),
	"prazo" varchar(255),
	"arte" varchar(255),
	"attribution" jsonb,
	"raw" jsonb,
	"status" varchar(16) DEFAULT 'new' NOT NULL,
	"quotation_id" uuid,
	"crm_deal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_leads_identity_key_not_blank_check" CHECK (char_length(btrim("quote_leads"."identity_key")) > 0),
	CONSTRAINT "quote_leads_email_lowercase_check" CHECK ("quote_leads"."email" IS NULL OR "quote_leads"."email" = lower("quote_leads"."email")),
	CONSTRAINT "quote_leads_telefone_digits_check" CHECK ("quote_leads"."telefone" IS NULL OR "quote_leads"."telefone" ~ '^[0-9]{10,15}$'),
	CONSTRAINT "quote_leads_status_check" CHECK ("quote_leads"."status" IN ('new', 'incomplete', 'ready', 'reviewing', 'converted', 'discarded'))
);
--> statement-breakpoint
CREATE TABLE "sales_order_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sales_order_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"product_sku" varchar(120) NOT NULL,
	"product_name" varchar(255) NOT NULL,
	"unit" varchar(32) NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_price" numeric(20, 2) NOT NULL,
	"line_total" numeric(20, 2) NOT NULL,
	CONSTRAINT "sales_order_items_position_check" CHECK ("sales_order_items"."position" >= 0),
	CONSTRAINT "sales_order_items_quantity_check" CHECK ("sales_order_items"."quantity" > 0),
	CONSTRAINT "sales_order_items_unit_price_check" CHECK ("sales_order_items"."unit_price" >= 0),
	CONSTRAINT "sales_order_items_line_total_check" CHECK ("sales_order_items"."line_total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sales_order_sequences" (
	"year" integer PRIMARY KEY NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "sales_order_sequences_year_check" CHECK ("sales_order_sequences"."year" BETWEEN 2000 AND 9999),
	CONSTRAINT "sales_order_sequences_last_number_check" CHECK ("sales_order_sequences"."last_number" >= 0 AND "sales_order_sequences"."last_number" <= 9999)
);
--> statement-breakpoint
CREATE TABLE "sales_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_number" varchar(32) NOT NULL,
	"quotation_id" uuid,
	"quotation_revision_id" uuid,
	"client_id" uuid NOT NULL,
	"status" varchar(32) DEFAULT 'Draft' NOT NULL,
	"transaction_date" date NOT NULL,
	"delivery_date" date,
	"per_delivered" numeric(5, 2) DEFAULT '0.00' NOT NULL,
	"per_billed" numeric(5, 2) DEFAULT '0.00' NOT NULL,
	"subtotal" numeric(20, 2) NOT NULL,
	"grand_total" numeric(20, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_orders_order_number_format_check" CHECK ("sales_orders"."order_number" ~ '^PED-[0-9]{4}-[0-9]{4}$'),
	CONSTRAINT "sales_orders_status_check" CHECK ("sales_orders"."status" IN ('Draft', 'To Deliver and Bill', 'To Deliver', 'To Bill', 'Completed', 'Cancelled', 'Closed')),
	CONSTRAINT "sales_orders_per_delivered_check" CHECK ("sales_orders"."per_delivered" BETWEEN 0 AND 100),
	CONSTRAINT "sales_orders_per_billed_check" CHECK ("sales_orders"."per_billed" BETWEEN 0 AND 100),
	CONSTRAINT "sales_orders_subtotal_check" CHECK ("sales_orders"."subtotal" >= 0),
	CONSTRAINT "sales_orders_grand_total_check" CHECK ("sales_orders"."grand_total" >= 0)
);
--> statement-breakpoint
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_quote_lead_id_quote_leads_id_fk" FOREIGN KEY ("quote_lead_id") REFERENCES "public"."quote_leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_activity_events" ADD CONSTRAINT "product_activity_events_product_sku_products_sku_fk" FOREIGN KEY ("product_sku") REFERENCES "public"."products"("sku") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_leads" ADD CONSTRAINT "quote_leads_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_leads" ADD CONSTRAINT "quote_leads_crm_deal_id_crm_deals_id_fk" FOREIGN KEY ("crm_deal_id") REFERENCES "public"."crm_deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_product_sku_products_sku_fk" FOREIGN KEY ("product_sku") REFERENCES "public"."products"("sku") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_quotation_revision_id_quote_revisions_id_fk" FOREIGN KEY ("quotation_revision_id") REFERENCES "public"."quote_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crm_deals_status_updated_idx" ON "crm_deals" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_deals_active_quotation_unique" ON "crm_deals" USING btree ("quotation_id") WHERE "crm_deals"."quotation_id" IS NOT NULL AND "crm_deals"."status" <> 'Perdido';--> statement-breakpoint
CREATE INDEX "product_activity_events_sku_created_idx" ON "product_activity_events" USING btree ("product_sku","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_leads_identity_key_unique" ON "quote_leads" USING btree ("identity_key");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_order_items_order_position_unique" ON "sales_order_items" USING btree ("sales_order_id","position");--> statement-breakpoint
CREATE INDEX "sales_order_items_product_idx" ON "sales_order_items" USING btree ("product_sku");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_orders_order_number_unique" ON "sales_orders" USING btree ("order_number");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_orders_active_quotation_unique" ON "sales_orders" USING btree ("quotation_id") WHERE "sales_orders"."quotation_id" IS NOT NULL AND "sales_orders"."status" <> 'Cancelled';--> statement-breakpoint
CREATE INDEX "sales_orders_status_transaction_date_idx" ON "sales_orders" USING btree ("status","transaction_date");--> statement-breakpoint
CREATE INDEX "sales_orders_client_transaction_date_idx" ON "sales_orders" USING btree ("client_id","transaction_date");