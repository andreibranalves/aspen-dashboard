ALTER TABLE "quote_revisions" ADD COLUMN "template_hash" varchar(64);--> statement-breakpoint
UPDATE "quote_revisions"
SET "template_padrao" = 'padrao',
	"template_hash" = 'ee159f5ad83ae26cabd2eb8c00fc6a0227319290ee24809055cc23da0a26108e'
WHERE "template_padrao" IS NULL OR "template_padrao" NOT IN ('padrao', 'minimalista');--> statement-breakpoint
UPDATE "quote_revisions"
SET "template_hash" = CASE
	WHEN "template_padrao" = 'minimalista' THEN 'c7060a7faa1f54d08d6f2c237f96cef261c57de5259fb7b755a1dd844bce8c8a'
	ELSE 'ee159f5ad83ae26cabd2eb8c00fc6a0227319290ee24809055cc23da0a26108e'
END
WHERE "template_hash" IS NULL;--> statement-breakpoint
ALTER TABLE "quote_revisions" ALTER COLUMN "template_hash" SET DEFAULT 'ee159f5ad83ae26cabd2eb8c00fc6a0227319290ee24809055cc23da0a26108e';--> statement-breakpoint
ALTER TABLE "quote_revisions" ALTER COLUMN "template_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_revisions" ADD CONSTRAINT "quote_revisions_template_hash_check" CHECK ("quote_revisions"."template_hash" ~ '^[0-9a-f]{64}$');
