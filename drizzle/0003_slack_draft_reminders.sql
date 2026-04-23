ALTER TABLE "slack_use_case_drafts" ADD COLUMN "slack_channel_id" varchar(50);--> statement-breakpoint
ALTER TABLE "slack_use_case_drafts" ADD COLUMN "reminder_24h_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "slack_use_case_drafts" ADD COLUMN "abandoned_at" timestamp;