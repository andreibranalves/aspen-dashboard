-- migration-risk: additive
CREATE TABLE "whatsapp_message_attachments" (
  "id" uuid PRIMARY KEY NOT NULL,
  "conversation_id" uuid NOT NULL REFERENCES "whatsapp_conversations"("id") ON DELETE RESTRICT,
  "message_id" uuid REFERENCES "whatsapp_messages"("id") ON DELETE RESTRICT,
  "media_type" varchar(16) NOT NULL,
  "mime_type" varchar(64) NOT NULL,
  "file_name" varchar(128) NOT NULL,
  "size_bytes" integer NOT NULL,
  "checksum" varchar(64) NOT NULL,
  "content_base64" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "whatsapp_message_attachments_type_check" CHECK ("media_type" IN ('image', 'document')),
  CONSTRAINT "whatsapp_message_attachments_size_check" CHECK ("size_bytes" > 0 AND "size_bytes" <= 3145728)
);
--> statement-breakpoint
CREATE INDEX "whatsapp_message_attachments_conversation_idx" ON "whatsapp_message_attachments" ("conversation_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_message_attachments_message_unique" ON "whatsapp_message_attachments" ("message_id");
--> statement-breakpoint
ALTER TABLE "whatsapp_message_outbox" ADD COLUMN "attachment_id" uuid REFERENCES "whatsapp_message_attachments"("id") ON DELETE RESTRICT;
