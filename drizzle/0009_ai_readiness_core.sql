CREATE TABLE IF NOT EXISTS "ai_readiness_assessment_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar(255) NOT NULL,
  "description" text,
  "version" varchar(50) NOT NULL,
  "language" varchar(20) NOT NULL DEFAULT 'it',
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "is_system_template" boolean NOT NULL DEFAULT false,
  "status" varchar(50) NOT NULL DEFAULT 'draft',
  "pillars" jsonb NOT NULL,
  "sections" jsonb NOT NULL,
  "questions" jsonb NOT NULL,
  "scoring_schema" jsonb NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_readiness_templates_name_version_idx"
  ON "ai_readiness_assessment_templates" ("name", "version", "language");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ai_readiness_assessments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "template_id" uuid NOT NULL REFERENCES "ai_readiness_assessment_templates"("id") ON DELETE RESTRICT,
  "name" varchar(255) NOT NULL,
  "description" text,
  "status" varchar(50) NOT NULL DEFAULT 'draft',
  "language" varchar(20) NOT NULL DEFAULT 'it',
  "brand_config" jsonb,
  "terminology_config" jsonb,
  "privacy_config" jsonb,
  "scoring_config" jsonb,
  "modules_enabled" jsonb,
  "anonymous_mode" boolean NOT NULL DEFAULT true,
  "aggregation_threshold" integer NOT NULL DEFAULT 5,
  "opens_at" timestamp,
  "closes_at" timestamp,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_readiness_assessments_workspace_idx"
  ON "ai_readiness_assessments" ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_readiness_assessments_org_idx"
  ON "ai_readiness_assessments" ("organization_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ai_readiness_respondents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "assessment_id" uuid NOT NULL REFERENCES "ai_readiness_assessments"("id") ON DELETE CASCADE,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "email" varchar(255),
  "name" varchar(255),
  "surname" varchar(255),
  "role" varchar(255),
  "seniority" varchar(255),
  "organization_unit" varchar(255),
  "country" varchar(100),
  "locale" varchar(20),
  "invite_token_hash" varchar(128) NOT NULL UNIQUE,
  "invite_status" varchar(50) NOT NULL DEFAULT 'invited',
  "pseudonymous_id" varchar(64) NOT NULL,
  "has_accepted_privacy_notice" boolean NOT NULL DEFAULT false,
  "has_marketing_consent" boolean NOT NULL DEFAULT false,
  "has_benchmark_consent" boolean NOT NULL DEFAULT false,
  "started_at" timestamp,
  "completed_at" timestamp,
  "last_seen_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_readiness_respondents_assessment_idx"
  ON "ai_readiness_respondents" ("assessment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_readiness_respondents_workspace_idx"
  ON "ai_readiness_respondents" ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_readiness_respondents_pseudo_idx"
  ON "ai_readiness_respondents" ("pseudonymous_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ai_readiness_responses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "assessment_id" uuid NOT NULL REFERENCES "ai_readiness_assessments"("id") ON DELETE CASCADE,
  "respondent_id" uuid NOT NULL REFERENCES "ai_readiness_respondents"("id") ON DELETE CASCADE,
  "pseudonymous_id" varchar(64) NOT NULL,
  "status" varchar(50) NOT NULL DEFAULT 'draft',
  "answers" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "derived_scores" jsonb,
  "free_text_answers" jsonb,
  "metadata" jsonb,
  "submitted_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_readiness_responses_respondent_assessment_idx"
  ON "ai_readiness_responses" ("assessment_id", "respondent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_readiness_responses_assessment_idx"
  ON "ai_readiness_responses" ("assessment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_readiness_responses_pseudo_idx"
  ON "ai_readiness_responses" ("pseudonymous_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ai_readiness_use_case_submissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "assessment_id" uuid NOT NULL REFERENCES "ai_readiness_assessments"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "respondent_id" uuid REFERENCES "ai_readiness_respondents"("id") ON DELETE SET NULL,
  "pseudonymous_id" varchar(64),
  "title" varchar(500) NOT NULL,
  "current_process" text,
  "pain_point" text,
  "desired_outcome" text,
  "frequency" varchar(255),
  "affected_users" integer,
  "estimated_beneficiaries" integer,
  "data_needed" text,
  "tools_used" text,
  "human_in_loop" text,
  "risk_level" varchar(50),
  "risk_reasoning" text,
  "impact_estimate" text,
  "efficiency_score" real,
  "effort_score" real,
  "feasibility_score" real,
  "strategic_value_score" real,
  "ai_solution_hypothesis" text,
  "prompt_or_snippet" text,
  "status" varchar(50) NOT NULL DEFAULT 'submitted',
  "source" varchar(50) NOT NULL DEFAULT 'assessment',
  "ai_suggested" boolean NOT NULL DEFAULT false,
  "human_validated" boolean NOT NULL DEFAULT false,
  "reviewer_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "reviewed_at" timestamp,
  "linked_use_case_id" uuid REFERENCES "use_cases"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_readiness_use_cases_assessment_idx"
  ON "ai_readiness_use_case_submissions" ("assessment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_readiness_use_cases_workspace_idx"
  ON "ai_readiness_use_case_submissions" ("workspace_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ai_readiness_scores" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "assessment_id" uuid NOT NULL REFERENCES "ai_readiness_assessments"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "scope_type" varchar(50) NOT NULL,
  "scope_key" varchar(255) NOT NULL,
  "pillar_scores" jsonb,
  "section_scores" jsonb,
  "overall_score" real,
  "bottleneck_pillar" varchar(100),
  "confidence" real,
  "respondent_count" integer NOT NULL DEFAULT 0,
  "aggregation_threshold_met" boolean NOT NULL DEFAULT false,
  "generated_at" timestamp NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_readiness_scores_assessment_idx"
  ON "ai_readiness_scores" ("assessment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_readiness_scores_workspace_idx"
  ON "ai_readiness_scores" ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_readiness_scores_scope_idx"
  ON "ai_readiness_scores" ("assessment_id", "scope_type", "scope_key");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ai_readiness_exports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "assessment_id" uuid NOT NULL REFERENCES "ai_readiness_assessments"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "export_type" varchar(100) NOT NULL,
  "requested_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "file_url" text,
  "status" varchar(50) NOT NULL DEFAULT 'pending',
  "included_personal_data" boolean NOT NULL DEFAULT false,
  "anonymized" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "completed_at" timestamp
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_readiness_exports_assessment_idx"
  ON "ai_readiness_exports" ("assessment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_readiness_exports_workspace_idx"
  ON "ai_readiness_exports" ("workspace_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ai_readiness_audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "assessment_id" uuid REFERENCES "ai_readiness_assessments"("id") ON DELETE CASCADE,
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "respondent_id" uuid REFERENCES "ai_readiness_respondents"("id") ON DELETE SET NULL,
  "event_type" varchar(100) NOT NULL,
  "event_payload" jsonb,
  "ip_hash" varchar(128),
  "user_agent" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_readiness_audit_workspace_idx"
  ON "ai_readiness_audit_events" ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_readiness_audit_assessment_idx"
  ON "ai_readiness_audit_events" ("assessment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_readiness_audit_event_type_idx"
  ON "ai_readiness_audit_events" ("event_type");
