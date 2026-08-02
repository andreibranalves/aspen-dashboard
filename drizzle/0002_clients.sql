CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nome" varchar(200) NOT NULL,
	"documento" varchar(14),
	"email" varchar(254),
	"telefone" varchar(15),
	"notes" varchar(4000),
	"endereco" varchar(255),
	"numero" varchar(30),
	"bairro" varchar(120),
	"complemento" varchar(120),
	"municipio" varchar(120),
	"uf" varchar(2),
	"cep" varchar(8),
	"arquivado" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "clients_nome_not_blank_check" CHECK (char_length(btrim("clients"."nome")) > 0),
	CONSTRAINT "clients_documento_length_check" CHECK ("clients"."documento" IS NULL OR char_length("clients"."documento") IN (11, 14)),
	CONSTRAINT "clients_telefone_digits_check" CHECK ("clients"."telefone" IS NULL OR "clients"."telefone" ~ '^[0-9]{10,15}$'),
	CONSTRAINT "clients_email_lowercase_check" CHECK ("clients"."email" IS NULL OR "clients"."email" = lower("clients"."email")),
	CONSTRAINT "clients_uf_uppercase_check" CHECK ("clients"."uf" IS NULL OR "clients"."uf" = upper("clients"."uf")),
	CONSTRAINT "clients_cep_digits_check" CHECK ("clients"."cep" IS NULL OR "clients"."cep" ~ '^[0-9]{8}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "clients_documento_unique" ON "clients" USING btree ("documento") WHERE "clients"."documento" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "clients_active_updated_idx" ON "clients" USING btree ("arquivado","updated_at");