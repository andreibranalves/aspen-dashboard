-- migration-risk: additive
CREATE TABLE "sales_order_offline_exports" (
  "id" uuid PRIMARY KEY NOT NULL,
  "sales_order_id" uuid NOT NULL,
  "quote_lead_id" uuid NOT NULL,
  "origin_source" varchar(80) NOT NULL,
  "event_type" varchar(32) DEFAULT 'pedido_iniciado' NOT NULL,
  "destination_account_id" varchar(64) NOT NULL,
  "destination_action_id" varchar(64) NOT NULL,
  "transaction_id" varchar(255) NOT NULL,
  "event_timestamp" timestamp with time zone NOT NULL,
  "conversion_value" numeric(20, 2) NOT NULL,
  "currency" varchar(3) DEFAULT 'BRL' NOT NULL,
  "event_source" varchar(16) DEFAULT 'OTHER' NOT NULL,
  "ad_identifier_type" varchar(8) NOT NULL,
  "ad_identifier" varchar(500) NOT NULL,
  "consent_evidence" jsonb NOT NULL,
  "payload_fingerprint" varchar(64) NOT NULL,
  "state" varchar(32) DEFAULT 'prepared' NOT NULL,
  "review_reason" varchar(64),
  "next_attempt_at" timestamp with time zone,
  "lease_token" uuid,
  "lease_until" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sales_order_offline_exports_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "sales_order_offline_exports_quote_lead_id_quote_leads_id_fk" FOREIGN KEY ("quote_lead_id") REFERENCES "public"."quote_leads"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "sales_order_offline_exports_event_type_check" CHECK ("event_type" = 'pedido_iniciado'),
  CONSTRAINT "sales_order_offline_exports_destination_check" CHECK (char_length(btrim("destination_account_id")) > 0 AND char_length(btrim("destination_action_id")) > 0),
  CONSTRAINT "sales_order_offline_exports_transaction_id_check" CHECK ("transaction_id" = 'aspen-pedido-iniciado:' || "sales_order_id"::text),
  CONSTRAINT "sales_order_offline_exports_conversion_value_check" CHECK ("conversion_value" > 0),
  CONSTRAINT "sales_order_offline_exports_currency_check" CHECK ("currency" = 'BRL'),
  CONSTRAINT "sales_order_offline_exports_event_source_check" CHECK ("event_source" = 'OTHER'),
  CONSTRAINT "sales_order_offline_exports_identifier_type_check" CHECK ("ad_identifier_type" IN ('gclid', 'wbraid', 'gbraid')),
  CONSTRAINT "sales_order_offline_exports_identifier_check" CHECK (char_length(btrim("ad_identifier")) > 0),
  CONSTRAINT "sales_order_offline_exports_consent_check" CHECK (jsonb_typeof("consent_evidence") = 'object'),
  CONSTRAINT "sales_order_offline_exports_fingerprint_check" CHECK ("payload_fingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "sales_order_offline_exports_state_check" CHECK ("state" IN ('prepared', 'sending', 'accepted_pending_diagnostic', 'processed', 'failed', 'needs_review')),
  CONSTRAINT "sales_order_offline_exports_review_reason_check" CHECK (
    (
      "state" = 'needs_review'
      AND "review_reason" IS NOT NULL
      AND "review_reason" IN (
        'consent_review_required', 'result_unknown', 'diagnostic_partial_success',
        'lease_expired_after_transport', 'cancellation_after_attempt',
        'correction_after_attempt', 'substitution_after_attempt'
      )
    )
    OR ("state" <> 'needs_review' AND "review_reason" IS NULL)
  ),
  CONSTRAINT "sales_order_offline_exports_lease_check" CHECK (
    ("lease_token" IS NULL AND "lease_until" IS NULL)
    OR ("lease_token" IS NOT NULL AND "lease_until" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sales_order_offline_exports_identity_unique" ON "sales_order_offline_exports" USING btree ("sales_order_id", "event_type", "destination_account_id", "destination_action_id");
--> statement-breakpoint
CREATE INDEX "sales_order_offline_exports_state_due_idx" ON "sales_order_offline_exports" USING btree ("state", "next_attempt_at");
--> statement-breakpoint
CREATE TABLE "sales_order_offline_export_attempts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "export_id" uuid NOT NULL,
  "attempt_no" integer NOT NULL,
  "correlation_id" varchar(128) NOT NULL,
  "attempt_state" varchar(24) DEFAULT 'started' NOT NULL,
  "started_at" timestamp with time zone NOT NULL,
  "finished_at" timestamp with time zone,
  "request_id" varchar(255),
  "http_status" integer,
  "error_code" varchar(128),
  "error_detail" varchar(1000),
  "field_warnings" jsonb,
  "diagnostic_status" varchar(24),
  "diagnostic_checked_at" timestamp with time zone,
  CONSTRAINT "sales_order_offline_export_attempts_export_id_sales_order_offline_exports_id_fk" FOREIGN KEY ("export_id") REFERENCES "public"."sales_order_offline_exports"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "sales_order_offline_export_attempts_no_check" CHECK ("attempt_no" > 0),
  CONSTRAINT "sales_order_offline_export_attempts_state_check" CHECK ("attempt_state" IN ('started', 'accepted', 'failed', 'unknown')),
  CONSTRAINT "sales_order_offline_export_attempts_finished_check" CHECK (("attempt_state" = 'started' AND "finished_at" IS NULL) OR ("attempt_state" <> 'started' AND "finished_at" IS NOT NULL)),
  CONSTRAINT "sales_order_offline_export_attempts_http_status_check" CHECK ("http_status" IS NULL OR "http_status" BETWEEN 100 AND 599),
  CONSTRAINT "sales_order_offline_export_attempts_warnings_check" CHECK ("field_warnings" IS NULL OR jsonb_typeof("field_warnings") = 'array'),
  CONSTRAINT "sales_order_offline_export_attempts_diagnostic_check" CHECK ("diagnostic_status" IS NULL OR "diagnostic_status" IN ('processing', 'success', 'partial_success', 'failure')),
  CONSTRAINT "sales_order_offline_export_attempts_diagnostic_pair_check" CHECK (("diagnostic_status" IS NULL AND "diagnostic_checked_at" IS NULL) OR ("diagnostic_status" IS NOT NULL AND "diagnostic_checked_at" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sales_order_offline_export_attempts_identity_unique" ON "sales_order_offline_export_attempts" USING btree ("export_id", "attempt_no");
--> statement-breakpoint
CREATE INDEX "sales_order_offline_export_attempts_request_idx" ON "sales_order_offline_export_attempts" USING btree ("request_id") WHERE "request_id" IS NOT NULL;
