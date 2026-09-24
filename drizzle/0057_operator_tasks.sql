-- migration-risk: additive
CREATE TABLE "operator_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" varchar(300) NOT NULL,
	"due_on" date,
	"sales_order_id" uuid,
	"client_id" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operator_tasks_title_length_check" CHECK (char_length(btrim("operator_tasks"."title")) BETWEEN 1 AND 300),
	CONSTRAINT "operator_tasks_single_link_check" CHECK ("operator_tasks"."sales_order_id" IS NULL OR "operator_tasks"."client_id" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "operator_tasks" ADD CONSTRAINT "operator_tasks_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "operator_tasks" ADD CONSTRAINT "operator_tasks_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "operator_tasks_open_due_idx" ON "operator_tasks" USING btree ("due_on","created_at") WHERE "operator_tasks"."completed_at" IS NULL;
