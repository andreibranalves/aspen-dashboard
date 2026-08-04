CREATE TABLE "quotation_template_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"template_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"source" text NOT NULL,
	"source_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotation_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" varchar(120) NOT NULL,
	"name" varchar(255) NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_settings" ALTER COLUMN "pagamento" SET DATA TYPE varchar(4000);--> statement-breakpoint
ALTER TABLE "app_settings" ALTER COLUMN "pagamento" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "quote_revisions" ALTER COLUMN "pagamento" SET DATA TYPE varchar(4000);--> statement-breakpoint
ALTER TABLE "quote_revisions" ALTER COLUMN "pagamento" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "quotation_sections" jsonb DEFAULT '{"schema_version":1,"prazo_producao":{"enabled":true,"title":"Prazo de produção"},"pagamento":{"enabled":true,"title":"Pagamento","body":""},"condicoes_gerais":{"enabled":true,"title":"Condições Gerais","body":""}}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_revisions" ADD COLUMN "template_version_id" uuid;--> statement-breakpoint
ALTER TABLE "quote_revisions" ADD COLUMN "sections_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "quotation_template_versions" ADD CONSTRAINT "quotation_template_versions_template_id_quotation_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."quotation_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quotation_template_versions_template_version_unique" ON "quotation_template_versions" USING btree ("template_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "quotation_template_versions_template_hash_unique" ON "quotation_template_versions" USING btree ("template_id","source_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "quotation_templates_key_unique" ON "quotation_templates" USING btree ("key");--> statement-breakpoint
ALTER TABLE "quote_revisions" ADD CONSTRAINT "quote_revisions_template_version_id_quotation_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."quotation_template_versions"("id") ON DELETE no action ON UPDATE no action;