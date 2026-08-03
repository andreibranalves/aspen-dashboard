CREATE TABLE "product_pricing_tiers" (
	"product_sku" varchar(120) NOT NULL,
	"minimum_quantity" numeric(14, 3) NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_pricing_tiers_pkey" PRIMARY KEY("product_sku","minimum_quantity"),
	CONSTRAINT "product_pricing_tiers_minimum_quantity_positive_check" CHECK ("product_pricing_tiers"."minimum_quantity" > 0),
	CONSTRAINT "product_pricing_tiers_unit_price_positive_check" CHECK ("product_pricing_tiers"."unit_price" > 0)
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "preco_base" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "product_pricing_tiers" ADD CONSTRAINT "product_pricing_tiers_product_sku_products_sku_fk" FOREIGN KEY ("product_sku") REFERENCES "public"."products"("sku") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_preco_base_positive_check" CHECK ("products"."preco_base" IS NULL OR "products"."preco_base" > 0);