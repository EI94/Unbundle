ALTER TABLE "workspaces" ADD COLUMN "ai_transformation_team_name" varchar(255);--> statement-breakpoint

CREATE TYPE "public"."portfolio_review_status" AS ENUM('needs_inputs','in_review','scored','archived');--> statement-breakpoint

ALTER TABLE "use_cases" ADD COLUMN "impact_flag" boolean;--> statement-breakpoint
ALTER TABLE "use_cases" ADD COLUMN "portfolio_review_status" "public"."portfolio_review_status" DEFAULT 'needs_inputs' NOT NULL;--> statement-breakpoint
ALTER TABLE "use_cases" ADD COLUMN "submitted_at" timestamp;--> statement-breakpoint
ALTER TABLE "use_cases" ADD COLUMN "reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "use_cases" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "use_cases" ADD COLUMN "review_notes" text;--> statement-breakpoint
ALTER TABLE "use_cases" ADD CONSTRAINT "use_cases_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "workspace_scoring_models" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "impact_flag_enabled" boolean DEFAULT false NOT NULL,
  "config" jsonb,
  "updated_by_user_id" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_scoring_models_workspace_id_unique" UNIQUE("workspace_id")
);--> statement-breakpoint

ALTER TABLE "workspace_scoring_models" ADD CONSTRAINT "workspace_scoring_models_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_scoring_models" ADD CONSTRAINT "workspace_scoring_models_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

