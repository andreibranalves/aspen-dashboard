-- migration-risk: additive
ALTER TABLE "products" ADD COLUMN "custo_unitario" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_custo_unitario_nonnegative_check" CHECK ("products"."custo_unitario" IS NULL OR "products"."custo_unitario" >= 0);--> statement-breakpoint
ALTER TABLE "sales_order_items" ADD COLUMN "custo_unitario" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_custo_unitario_nonnegative_check" CHECK ("sales_order_items"."custo_unitario" IS NULL OR "sales_order_items"."custo_unitario" >= 0);--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "aliquota" numeric(5, 2) DEFAULT '4.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_aliquota_check" CHECK ("app_settings"."aliquota" >= 0 AND "app_settings"."aliquota" <= 100);--> statement-breakpoint
CREATE TABLE "ad_spend_months" (
	"year_month" varchar(7) PRIMARY KEY NOT NULL,
	"meta_spend" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_spend_months_year_month_check" CHECK ("ad_spend_months"."year_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "ad_spend_months_meta_spend_check" CHECK ("ad_spend_months"."meta_spend" >= 0)
);
