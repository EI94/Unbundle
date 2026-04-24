-- Adds WhatsApp webhook on workspaces and custom KPI scores on use cases.
-- Ranking model's KPI definitions live inside the existing
-- workspace_scoring_models.config jsonb, so no new table is required.

ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "whatsapp_webhook_url" varchar(1000);--> statement-breakpoint

ALTER TABLE "use_cases" ADD COLUMN IF NOT EXISTS "custom_scores" jsonb;--> statement-breakpoint
