-- migration-risk: destructive
ALTER TABLE "quotation_follow_ups"
  ALTER COLUMN "eligibility_version" DROP NOT NULL,
  ALTER COLUMN "message_snapshot" DROP NOT NULL,
  ALTER COLUMN "first_provider_receipt_at" DROP NOT NULL,
  ALTER COLUMN "due_at" DROP NOT NULL,
  ALTER COLUMN "state" TYPE varchar(20);
--> statement-breakpoint
ALTER TABLE "quotation_follow_ups"
  DROP CONSTRAINT "quotation_follow_ups_eligibility_version_check",
  DROP CONSTRAINT "quotation_follow_ups_message_not_blank_check",
  DROP CONSTRAINT "quotation_follow_ups_state_check",
  DROP CONSTRAINT "quotation_follow_ups_closed_consistency_check",
  DROP CONSTRAINT "quotation_follow_ups_phone_not_blank_check";
--> statement-breakpoint
ALTER TABLE "quotation_follow_ups"
  ADD CONSTRAINT "quotation_follow_ups_eligibility_version_check"
    CHECK ("eligibility_version" IS NULL OR "eligibility_version" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "quotation_follow_ups_message_not_blank_check"
    CHECK ("message_snapshot" IS NULL OR char_length(btrim("message_snapshot")) > 0),
  ADD CONSTRAINT "quotation_follow_ups_state_check"
    CHECK ("state" IN ('awaiting_receipt', 'waiting', 'ready', 'held', 'approved', 'processing', 'sent', 'cancelled', 'dismissed', 'needs_review', 'failed')),
  ADD CONSTRAINT "quotation_follow_ups_closed_consistency_check"
    CHECK (
      ("state" IN ('awaiting_receipt', 'waiting', 'ready', 'held')
        AND "closed_reason" IS NULL
        AND "closed_at" IS NULL)
      OR ("state" IN ('approved', 'processing')
        AND "closed_reason" IS NULL
        AND "closed_at" IS NULL)
      OR ("state" IN ('sent', 'cancelled', 'dismissed', 'needs_review', 'failed')
        AND "closed_at" IS NOT NULL
        AND ("state" = 'sent' OR "closed_reason" IS NOT NULL))
    ),
  ADD CONSTRAINT "quotation_follow_ups_phone_not_blank_check"
    CHECK (
      "canonical_phone" ~ '^[0-9]{10,15}$'
      OR (
        char_length(btrim("canonical_phone")) = 0
        AND lower(right(btrim("provider_conversation_id"), 4)) = '@lid'
      )
    );
