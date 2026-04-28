-- Hardens Slack collection persistence for production DBs that missed prior
-- catch-up migrations and allows natural-language urgency answers.

ALTER TABLE "slack_use_case_drafts"
  ADD COLUMN IF NOT EXISTS "contribution_kind" varchar(50);--> statement-breakpoint

ALTER TABLE "slack_use_case_drafts"
  ADD COLUMN IF NOT EXISTS "slack_channel_id" varchar(50);--> statement-breakpoint

ALTER TABLE "slack_use_case_drafts"
  ADD COLUMN IF NOT EXISTS "sustainability_impact" text;--> statement-breakpoint

ALTER TABLE "slack_use_case_drafts"
  ADD COLUMN IF NOT EXISTS "reminder_24h_sent_at" timestamp;--> statement-breakpoint

ALTER TABLE "slack_use_case_drafts"
  ADD COLUMN IF NOT EXISTS "abandoned_at" timestamp;--> statement-breakpoint

ALTER TABLE "slack_use_case_drafts"
  ALTER COLUMN "urgency" TYPE varchar(255);
