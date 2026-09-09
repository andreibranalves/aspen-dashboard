-- migration-risk: additive
CREATE TABLE "whatsapp_client_links" (
  "account_id" varchar(64) NOT NULL,
  "conversation_id" varchar(64) NOT NULL,
  "client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "version" uuid NOT NULL,
  "observed_phone" varchar(15),
  "client_phone" varchar(15),
  "source" varchar(32) DEFAULT 'operator' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY ("account_id", "conversation_id")
);
--> statement-breakpoint
CREATE INDEX "whatsapp_client_links_client_idx" ON "whatsapp_client_links" ("client_id");
