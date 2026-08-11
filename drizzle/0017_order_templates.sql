CREATE TABLE "order_template_items" (
	"template_id" uuid NOT NULL,
	"sku" varchar(120) NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "order_template_items_pkey" PRIMARY KEY("template_id","sku"),
	CONSTRAINT "order_template_items_position_non_negative_check" CHECK ("order_template_items"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "order_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_templates_name_not_blank_check" CHECK (char_length(btrim("order_templates"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "order_template_items" ADD CONSTRAINT "order_template_items_template_id_order_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."order_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_template_items" ADD CONSTRAINT "order_template_items_sku_products_sku_fk" FOREIGN KEY ("sku") REFERENCES "public"."products"("sku") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_template_items_position_unique" ON "order_template_items" USING btree ("template_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "order_templates_active_name_unique" ON "order_templates" USING btree (lower(btrim("name"))) WHERE "order_templates"."archived" = false;