-- migration-risk: additive
ALTER TABLE "sales_orders" ADD COLUMN "production_stage" varchar(32) DEFAULT 'aguardando_entrada' NOT NULL;
--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "production_stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "deposit_received_on" date;
--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "deposit_amount" numeric(20, 2);
--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "art_approved_on" date;
--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "production_days" integer DEFAULT 20 NOT NULL;
--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "deadline_manual" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "ready_on" date;
--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "delivered_on" date;
--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "balance_received_on" date;
--> statement-breakpoint
UPDATE "sales_orders"
SET "production_stage" = CASE WHEN "status" = 'Completed' THEN 'entregue' ELSE 'aguardando_entrada' END,
    "production_stage_changed_at" = CASE WHEN "status" = 'Completed' THEN "updated_at" ELSE "created_at" END,
    "delivered_on" = CASE WHEN "status" = 'Completed' THEN ("updated_at" AT TIME ZONE 'America/Sao_Paulo')::date ELSE NULL END;
--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_production_stage_check" CHECK ("sales_orders"."production_stage" IN ('aguardando_entrada', 'aguardando_arte', 'em_producao', 'pronto', 'entregue'));
--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_deposit_amount_check" CHECK ("sales_orders"."deposit_amount" IS NULL OR "sales_orders"."deposit_amount" >= 0);
--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_production_days_check" CHECK ("sales_orders"."production_days" BETWEEN 1 AND 365);
--> statement-breakpoint
CREATE INDEX "sales_orders_production_stage_idx" ON "sales_orders" USING btree ("production_stage","production_stage_changed_at");
--> statement-breakpoint
CREATE TABLE "sales_order_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sales_order_id" uuid NOT NULL,
	"kind" varchar(16) NOT NULL,
	"body" text NOT NULL,
	"undo_state" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales_order_notes" ADD CONSTRAINT "sales_order_notes_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_order_notes" ADD CONSTRAINT "sales_order_notes_kind_check" CHECK ("sales_order_notes"."kind" IN ('note', 'stage'));
--> statement-breakpoint
ALTER TABLE "sales_order_notes" ADD CONSTRAINT "sales_order_notes_body_length_check" CHECK (char_length("sales_order_notes"."body") BETWEEN 1 AND 4000);
--> statement-breakpoint
CREATE INDEX "sales_order_notes_order_created_idx" ON "sales_order_notes" USING btree ("sales_order_id","created_at");
