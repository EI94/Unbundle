CREATE TABLE IF NOT EXISTS "ai_readiness_insights" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "assessment_id" uuid NOT NULL REFERENCES "ai_readiness_assessments"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "scope_type" varchar(50) NOT NULL DEFAULT 'company',
  "scope_key" varchar(255) NOT NULL DEFAULT 'company',
  "insight_type" varchar(100) NOT NULL,
  "title" varchar(500) NOT NULL,
  "body" text NOT NULL,
  "evidence" jsonb,
  "ai_generated" boolean NOT NULL DEFAULT true,
  "human_validated" boolean NOT NULL DEFAULT false,
  "validated_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "validation_status" varchar(50) NOT NULL DEFAULT 'draft',
  "model" varchar(255),
  "prompt_version" varchar(100),
  "input_scope" jsonb,
  "generated_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ai_readiness_insights_assessment_idx"
  ON "ai_readiness_insights" ("assessment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_readiness_insights_workspace_idx"
  ON "ai_readiness_insights" ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_readiness_insights_scope_idx"
  ON "ai_readiness_insights" ("assessment_id", "scope_type", "scope_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_readiness_insights_type_idx"
  ON "ai_readiness_insights" ("assessment_id", "insight_type");
