import { sql } from "drizzle-orm";
import { db } from ".";
import { UC_DDL, UC_PROBE_SQL } from "../uc/ddl.ts";
import { CONNECTOR_DDL, CONNECTOR_PROBE_SQL } from "./connector-ddl.ts";

/**
 * Self-heal dello schema.
 *
 * In alcuni ambienti (es. progetti Vercel "gemelli" o DB fork dove non è stato
 * eseguito `drizzle-kit migrate`) mancano colonne/tabelle introdotte dalle
 * ultime migration (portfolio, ranking custom, notifiche).
 *
 * In quel caso Drizzle — che fa SELECT esplicito su tutte le colonne della
 * schema TS — lancia `column ... does not exist` e Next restituisce 500.
 *
 * Qui eseguiamo, **una sola volta per processo**, un set di statement
 * idempotenti (`IF NOT EXISTS`) che portano il DB in linea con lo schema TS.
 *
 * Nessun dato viene modificato: è puro catch-up strutturale. Le vere
 * migrazioni `drizzle/*.sql` restano la source of truth in CI.
 */

/** Incrementa ad ogni modifica a `runOnce`: così i worker warm ri-eseguono il catch-up. */
const ENSURE_VERSION = 14;

let ensurePromise: Promise<void> | null = null;
let ensureVersionApplied = 0;

async function runOnce(): Promise<void> {
  // Enum portfolio_review_status (creata dalla migration 0003) ─────────────
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "public"."portfolio_review_status" AS ENUM (
        'needs_inputs', 'in_review', 'scored', 'archived'
      );
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);

  // workspaces: ESG, team name, whatsapp webhook ───────────────────────────
  await db.execute(sql`
    ALTER TABLE "workspaces"
      ADD COLUMN IF NOT EXISTS "esg_enabled" boolean NOT NULL DEFAULT false;
  `);
  await db.execute(sql`
    ALTER TABLE "workspaces"
      ADD COLUMN IF NOT EXISTS "ai_transformation_team_name" varchar(255);
  `);
  await db.execute(sql`
    ALTER TABLE "workspaces"
      ADD COLUMN IF NOT EXISTS "whatsapp_webhook_url" varchar(1000);
  `);
  await db.execute(sql`
    ALTER TABLE "workspaces"
      ADD COLUMN IF NOT EXISTS "portfolio_share_epoch" integer NOT NULL DEFAULT 0;
  `);
  await db.execute(sql`
    ALTER TABLE "workspaces"
      ADD COLUMN IF NOT EXISTS "unit_terminology" jsonb;
  `);

  // workspace collaboration: accesso workspace-specifico e link invito ────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "workspace_memberships" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "workspace_id" uuid NOT NULL
        REFERENCES "workspaces"("id") ON DELETE CASCADE,
      "user_id" uuid NOT NULL
        REFERENCES "users"("id") ON DELETE CASCADE,
      "role" "member_role" NOT NULL DEFAULT 'contributor',
      "source" varchar(50) NOT NULL DEFAULT 'direct',
      "invited_by_user_id" uuid
        REFERENCES "users"("id") ON DELETE SET NULL,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "workspace_memberships_workspace_user_idx"
      ON "workspace_memberships" ("workspace_id", "user_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "workspace_memberships_user_idx"
      ON "workspace_memberships" ("user_id");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "workspace_invitations" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "workspace_id" uuid NOT NULL
        REFERENCES "workspaces"("id") ON DELETE CASCADE,
      "organization_id" uuid NOT NULL
        REFERENCES "organizations"("id") ON DELETE CASCADE,
      "email" varchar(255),
      "role" "member_role" NOT NULL DEFAULT 'contributor',
      "token_hash" varchar(128) NOT NULL UNIQUE,
      "max_uses" integer NOT NULL DEFAULT 1,
      "used_count" integer NOT NULL DEFAULT 0,
      "expires_at" timestamp NOT NULL,
      "revoked_at" timestamp,
      "created_by_user_id" uuid
        REFERENCES "users"("id") ON DELETE SET NULL,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "workspace_invitations_workspace_idx"
      ON "workspace_invitations" ("workspace_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "workspace_invitations_token_hash_idx"
      ON "workspace_invitations" ("token_hash");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "workspace_invitation_acceptances" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "invitation_id" uuid NOT NULL
        REFERENCES "workspace_invitations"("id") ON DELETE CASCADE,
      "workspace_id" uuid NOT NULL
        REFERENCES "workspaces"("id") ON DELETE CASCADE,
      "user_id" uuid NOT NULL
        REFERENCES "users"("id") ON DELETE CASCADE,
      "email_snapshot" varchar(255),
      "accepted_at" timestamp NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "workspace_invitation_acceptances_invite_user_idx"
      ON "workspace_invitation_acceptances" ("invitation_id", "user_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "workspace_invitation_acceptances_workspace_idx"
      ON "workspace_invitation_acceptances" ("workspace_id");
  `);

  // workspace integration tokens: Claude/MCP e futuri connector esterni ───
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "workspace_integration_tokens" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "workspace_id" uuid NOT NULL
        REFERENCES "workspaces"("id") ON DELETE CASCADE,
      "label" varchar(255) NOT NULL,
      "provider" varchar(50) NOT NULL DEFAULT 'claude_mcp',
      "token_hash" varchar(128) NOT NULL UNIQUE,
      "token_prefix" varchar(32) NOT NULL,
      "scopes" jsonb NOT NULL DEFAULT '["portfolio:submit"]'::jsonb,
      "created_by_user_id" uuid
        REFERENCES "users"("id") ON DELETE SET NULL,
      "last_used_at" timestamp,
      "expires_at" timestamp,
      "revoked_at" timestamp,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "workspace_integration_tokens_workspace_idx"
      ON "workspace_integration_tokens" ("workspace_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "workspace_integration_tokens_hash_idx"
      ON "workspace_integration_tokens" ("token_hash");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "external_contribution_submissions" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "workspace_id" uuid NOT NULL
        REFERENCES "workspaces"("id") ON DELETE CASCADE,
      "integration_token_id" uuid NOT NULL
        REFERENCES "workspace_integration_tokens"("id") ON DELETE CASCADE,
      "idempotency_key" varchar(128) NOT NULL,
      "request_hash" varchar(128) NOT NULL,
      "status" varchar(50) NOT NULL DEFAULT 'pending',
      "use_case_id" uuid
        REFERENCES "use_cases"("id") ON DELETE SET NULL,
      "error_code" varchar(100),
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "external_contribution_idempotency_idx"
      ON "external_contribution_submissions" ("workspace_id", "integration_token_id", "idempotency_key");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "external_contribution_workspace_idx"
      ON "external_contribution_submissions" ("workspace_id");
  `);

  // AI Readiness OS: assessment core ──────────────────────────────────────
  await db.execute(sql`
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
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "ai_readiness_templates_name_version_idx"
      ON "ai_readiness_assessment_templates" ("name", "version", "language");
  `);

  await db.execute(sql`
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
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "ai_readiness_assessments_workspace_idx"
      ON "ai_readiness_assessments" ("workspace_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "ai_readiness_assessments_org_idx"
      ON "ai_readiness_assessments" ("organization_id");
  `);

  await db.execute(sql`
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
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "ai_readiness_respondents_assessment_idx"
      ON "ai_readiness_respondents" ("assessment_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "ai_readiness_respondents_workspace_idx"
      ON "ai_readiness_respondents" ("workspace_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "ai_readiness_respondents_pseudo_idx"
      ON "ai_readiness_respondents" ("pseudonymous_id");
  `);
  await db.execute(sql`
    ALTER TABLE "ai_readiness_respondents"
      ADD COLUMN IF NOT EXISTS "survey_track" varchar(20) NOT NULL DEFAULT 'everyone';
  `);
  await db.execute(sql`
    ALTER TABLE "ai_readiness_respondents"
      ADD COLUMN IF NOT EXISTS "question_scope" jsonb;
  `);

  await db.execute(sql`
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
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "ai_readiness_responses_respondent_assessment_idx"
      ON "ai_readiness_responses" ("assessment_id", "respondent_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "ai_readiness_responses_assessment_idx"
      ON "ai_readiness_responses" ("assessment_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "ai_readiness_responses_pseudo_idx"
      ON "ai_readiness_responses" ("pseudonymous_id");
  `);

  await db.execute(sql`
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
    );
  `);
  await db.execute(sql`
    ALTER TABLE "ai_readiness_use_case_submissions"
      ADD COLUMN IF NOT EXISTS "people_involved" text;
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "ai_readiness_use_cases_assessment_idx"
      ON "ai_readiness_use_case_submissions" ("assessment_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "ai_readiness_use_cases_workspace_idx"
      ON "ai_readiness_use_case_submissions" ("workspace_id");
  `);

  await db.execute(sql`
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
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "ai_readiness_scores_assessment_idx"
      ON "ai_readiness_scores" ("assessment_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "ai_readiness_scores_workspace_idx"
      ON "ai_readiness_scores" ("workspace_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "ai_readiness_scores_scope_idx"
      ON "ai_readiness_scores" ("assessment_id", "scope_type", "scope_key");
  `);

  await db.execute(sql`
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
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "ai_readiness_exports_assessment_idx"
      ON "ai_readiness_exports" ("assessment_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "ai_readiness_exports_workspace_idx"
      ON "ai_readiness_exports" ("workspace_id");
  `);

  await db.execute(sql`
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
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "ai_readiness_audit_workspace_idx"
      ON "ai_readiness_audit_events" ("workspace_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "ai_readiness_audit_assessment_idx"
      ON "ai_readiness_audit_events" ("assessment_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "ai_readiness_audit_event_type_idx"
      ON "ai_readiness_audit_events" ("event_type");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "ai_readiness_insights" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
      "generated_at" timestamp NOT NULL DEFAULT now(),
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "ai_readiness_insights_assessment_idx"
      ON "ai_readiness_insights" ("assessment_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "ai_readiness_insights_workspace_idx"
      ON "ai_readiness_insights" ("workspace_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "ai_readiness_insights_scope_idx"
      ON "ai_readiness_insights" ("assessment_id", "scope_type", "scope_key");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "ai_readiness_insights_type_idx"
      ON "ai_readiness_insights" ("assessment_id", "insight_type");
  `);

  // weekly_signals.is_read (se DB molto vecchio) ───────────────────────────
  await db.execute(sql`
    ALTER TABLE "weekly_signals"
      ADD COLUMN IF NOT EXISTS "is_read" boolean NOT NULL DEFAULT false;
  `);

  // slack_installations.installed_by ───────────────────────────────────────
  await db.execute(sql`
    ALTER TABLE "slack_installations"
      ADD COLUMN IF NOT EXISTS "installed_by" varchar(100);
  `);

  // use_cases: colonne del dominio portfolio / ranking / review ────────────
  await db.execute(sql`ALTER TABLE "use_cases" ADD COLUMN IF NOT EXISTS "source" varchar(50);`);
  await db.execute(sql`ALTER TABLE "use_cases" ADD COLUMN IF NOT EXISTS "proposed_by" varchar(255);`);
  await db.execute(sql`ALTER TABLE "use_cases" ADD COLUMN IF NOT EXISTS "portfolio_kind" varchar(50);`);
  await db.execute(sql`ALTER TABLE "use_cases" ADD COLUMN IF NOT EXISTS "impact_flag" boolean;`);
  await db.execute(sql`
    ALTER TABLE "use_cases"
      ADD COLUMN IF NOT EXISTS "portfolio_review_status" "portfolio_review_status"
        NOT NULL DEFAULT 'needs_inputs';
  `);
  await db.execute(sql`ALTER TABLE "use_cases" ADD COLUMN IF NOT EXISTS "submitted_at" timestamp;`);
  await db.execute(sql`ALTER TABLE "use_cases" ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp;`);
  await db.execute(sql`
    ALTER TABLE "use_cases"
      ADD COLUMN IF NOT EXISTS "reviewed_by" uuid
        REFERENCES "users"("id") ON DELETE SET NULL;
  `);
  await db.execute(sql`ALTER TABLE "use_cases" ADD COLUMN IF NOT EXISTS "review_notes" text;`);
  await db.execute(sql`ALTER TABLE "use_cases" ADD COLUMN IF NOT EXISTS "flow_description" text;`);
  await db.execute(sql`ALTER TABLE "use_cases" ADD COLUMN IF NOT EXISTS "human_in_the_loop" text;`);
  await db.execute(sql`ALTER TABLE "use_cases" ADD COLUMN IF NOT EXISTS "guardrails" text;`);
  await db.execute(sql`ALTER TABLE "use_cases" ADD COLUMN IF NOT EXISTS "data_requirements" text;`);
  await db.execute(sql`ALTER TABLE "use_cases" ADD COLUMN IF NOT EXISTS "sustainability_impact" text;`);
  await db.execute(sql`ALTER TABLE "use_cases" ADD COLUMN IF NOT EXISTS "impact_economic" real;`);
  await db.execute(sql`ALTER TABLE "use_cases" ADD COLUMN IF NOT EXISTS "impact_time" real;`);
  await db.execute(sql`ALTER TABLE "use_cases" ADD COLUMN IF NOT EXISTS "impact_quality" real;`);
  await db.execute(sql`ALTER TABLE "use_cases" ADD COLUMN IF NOT EXISTS "impact_coordination" real;`);
  await db.execute(sql`ALTER TABLE "use_cases" ADD COLUMN IF NOT EXISTS "impact_social" real;`);
  await db.execute(sql`ALTER TABLE "use_cases" ADD COLUMN IF NOT EXISTS "feasibility_data" real;`);
  await db.execute(sql`ALTER TABLE "use_cases" ADD COLUMN IF NOT EXISTS "feasibility_workflow" real;`);
  await db.execute(sql`ALTER TABLE "use_cases" ADD COLUMN IF NOT EXISTS "feasibility_risk" real;`);
  await db.execute(sql`ALTER TABLE "use_cases" ADD COLUMN IF NOT EXISTS "feasibility_tech" real;`);
  await db.execute(sql`ALTER TABLE "use_cases" ADD COLUMN IF NOT EXISTS "feasibility_team" real;`);
  await db.execute(sql`ALTER TABLE "use_cases" ADD COLUMN IF NOT EXISTS "esg_environmental" real;`);
  await db.execute(sql`ALTER TABLE "use_cases" ADD COLUMN IF NOT EXISTS "esg_social" real;`);
  await db.execute(sql`ALTER TABLE "use_cases" ADD COLUMN IF NOT EXISTS "esg_governance" real;`);
  await db.execute(sql`ALTER TABLE "use_cases" ADD COLUMN IF NOT EXISTS "overall_esg_score" real;`);
  await db.execute(sql`ALTER TABLE "use_cases" ADD COLUMN IF NOT EXISTS "overall_impact_score" real;`);
  await db.execute(sql`ALTER TABLE "use_cases" ADD COLUMN IF NOT EXISTS "overall_feasibility_score" real;`);
  await db.execute(sql`ALTER TABLE "use_cases" ADD COLUMN IF NOT EXISTS "overall_score" real;`);
  await db.execute(sql`ALTER TABLE "use_cases" ADD COLUMN IF NOT EXISTS "custom_scores" jsonb;`);

  // workspace_scoring_models: tabella intera + colonne ────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "workspace_scoring_models" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "workspace_id" uuid NOT NULL UNIQUE
        REFERENCES "workspaces"("id") ON DELETE CASCADE,
      "impact_flag_enabled" boolean NOT NULL DEFAULT false,
      "config" jsonb,
      "updated_by_user_id" uuid
        REFERENCES "users"("id") ON DELETE SET NULL,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    ALTER TABLE "workspace_scoring_models"
      ADD COLUMN IF NOT EXISTS "impact_flag_enabled" boolean NOT NULL DEFAULT false;
  `);
  await db.execute(sql`
    ALTER TABLE "workspace_scoring_models"
      ADD COLUMN IF NOT EXISTS "config" jsonb;
  `);
  await db.execute(sql`
    ALTER TABLE "workspace_scoring_models"
      ADD COLUMN IF NOT EXISTS "updated_by_user_id" uuid
        REFERENCES "users"("id") ON DELETE SET NULL;
  `);

  // slack_use_case_drafts: colonne usate dai nuovi handler ────────────────
  await db.execute(sql`
    ALTER TABLE "slack_use_case_drafts"
      ADD COLUMN IF NOT EXISTS "contribution_kind" varchar(50);
  `);
  await db.execute(sql`
    ALTER TABLE "slack_use_case_drafts"
      ADD COLUMN IF NOT EXISTS "slack_channel_id" varchar(50);
  `);
  await db.execute(sql`
    ALTER TABLE "slack_use_case_drafts"
      ADD COLUMN IF NOT EXISTS "sustainability_impact" text;
  `);
  await db.execute(sql`
    ALTER TABLE "slack_use_case_drafts"
      ADD COLUMN IF NOT EXISTS "reminder_24h_sent_at" timestamp;
  `);
  await db.execute(sql`
    ALTER TABLE "slack_use_case_drafts"
      ADD COLUMN IF NOT EXISTS "abandoned_at" timestamp;
  `);
  await db.execute(sql`
    ALTER TABLE "slack_use_case_drafts"
      ALTER COLUMN "urgency" TYPE varchar(255);
  `);

  // Connettore MCP organizzativo (drizzle/0019_connettore_mcp.sql) ─────────
  // Stessi statement e stesso ordine della migrazione, dopo use_cases ed
  // external_contribution_submissions (qui sopra): identità, configurazione e
  // limiti, colonne di use_cases, principal_key, indici e trigger.
  await runConnectorDdl();
}

/**
 * Applica il DDL del connettore in una sola transazione, serializzata da un
 * advisory lock: il backfill di `principal_key` e il suo NOT NULL non si
 * separano, e due avvii a freddo non si pestano i piedi.
 */
export async function runConnectorDdl(statements: readonly string[] = CONNECTOR_DDL): Promise<void> {
  const client = db.$client;
  await client.transaction([
    client.query("SELECT pg_advisory_xact_lock(hashtext('unbundle:connector-ddl'))"),
    ...statements.map((statement) => client.query(statement)),
  ]);
}

async function schemaLooksCurrent(): Promise<boolean> {
  try {
    const result = (await db.execute(sql`
      SELECT (
        to_regtype('public.portfolio_review_status') IS NOT NULL
        AND to_regclass('public.workspace_memberships') IS NOT NULL
        AND to_regclass('public.workspace_invitations') IS NOT NULL
        AND to_regclass('public.workspace_invitation_acceptances') IS NOT NULL
        AND to_regclass('public.workspace_integration_tokens') IS NOT NULL
        AND to_regclass('public.external_contribution_submissions') IS NOT NULL
        AND to_regclass('public.workspace_scoring_models') IS NOT NULL
        AND to_regclass('public.ai_readiness_assessment_templates') IS NOT NULL
        AND to_regclass('public.ai_readiness_assessments') IS NOT NULL
        AND to_regclass('public.ai_readiness_respondents') IS NOT NULL
        AND to_regclass('public.ai_readiness_responses') IS NOT NULL
        AND to_regclass('public.ai_readiness_use_case_submissions') IS NOT NULL
        AND to_regclass('public.ai_readiness_scores') IS NOT NULL
        AND to_regclass('public.ai_readiness_exports') IS NOT NULL
        AND to_regclass('public.ai_readiness_audit_events') IS NOT NULL
        AND to_regclass('public.ai_readiness_insights') IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'workspaces'
            AND column_name IN (
              'esg_enabled',
              'ai_transformation_team_name',
              'whatsapp_webhook_url',
              'unit_terminology',
              'portfolio_share_epoch'
            )
          GROUP BY table_name
          HAVING count(*) = 5
        )
        AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'ai_readiness_respondents'
            AND column_name = 'survey_track'
        )
        AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'ai_readiness_respondents'
            AND column_name = 'question_scope'
        )
        AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'ai_readiness_use_case_submissions'
            AND column_name = 'people_involved'
        )
        AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'use_cases'
            AND column_name IN (
              'portfolio_kind',
              'portfolio_review_status',
              'flow_description',
              'human_in_the_loop',
              'data_requirements',
              'sustainability_impact',
              'overall_impact_score',
              'overall_feasibility_score',
              'overall_esg_score',
              'overall_score',
              'custom_scores'
            )
          GROUP BY table_name
          HAVING count(*) = 11
        )
        AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'slack_use_case_drafts'
            AND column_name IN (
              'contribution_kind',
              'slack_channel_id',
              'sustainability_impact',
              'reminder_24h_sent_at',
              'abandoned_at'
            )
          GROUP BY table_name
          HAVING count(*) = 5
        )
        AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'weekly_signals'
            AND column_name = 'is_read'
        )
        AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'slack_installations'
            AND column_name = 'installed_by'
        )
        AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'workspace_scoring_models'
            AND column_name IN ('impact_flag_enabled', 'config', 'updated_by_user_id')
          GROUP BY table_name
          HAVING count(*) = 3
        )
        AND ${sql.raw(CONNECTOR_PROBE_SQL)}
      ) AS current;
    `)) as unknown as { rows?: Array<{ current?: unknown }> };
    return result.rows?.[0]?.current === true;
  } catch (err) {
    console.warn("[db/ensure-schema] schema probe failed, running self-heal:", err);
    return false;
  }
}

/**
 * Chiamata idempotente e sicura: **la prima invocazione** applica i catch-up,
 * le successive riutilizzano la stessa Promise (anche in caso di errore
 * viene re-triggered al prossimo caller per non restare in uno stato bloccato).
 */
export async function ensureDbSchema(): Promise<void> {
  if (ensureVersionApplied !== ENSURE_VERSION) {
    ensurePromise = null;
    ensureVersionApplied = ENSURE_VERSION;
  }
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    // Nei cold start serverless evitiamo decine di DDL idempotenti se il DB è già allineato.
    if (await schemaLooksCurrent()) return;
    await runOnce();
  })().catch((err) => {
    ensurePromise = null;
    console.error("[db/ensure-schema] self-heal failed:", err);
    throw err;
  });
  return ensurePromise;
}

// ─── Casi d'uso (uc_*): self-heal separato ──────────────────────────
//
// Separato da `runOnce()`/`schemaLooksCurrent()` (PIANO §2.5, D35): un DDL uc che
// fallisce rende «Sezione non disponibile» le sole rotte uc e non tocca
// assessment, portafoglio, Slack e formazione. Lo chiamano solo i moduli
// `queries/uc-*.ts`, e solo con `UC_ENABLED === "true"`: senza flag nessuna
// tabella uc viene creata.
//
// In produzione (`VERCEL_ENV=production`) il self-heal uc è spento, salvo un
// `UC_SCHEMA_SELF_HEAL=on` scritto a mano (`ucSelfHealEnabled`, DESIGN §7.1
// P0-2): l'app esegue solo la sonda e, se lo schema non è aggiornato, la sezione
// risponde 503 finché la 0018 non è applicata a mano (`docs/casi-duso/RUNBOOK.md`).
// Così il DDL uc non parte da una richiesta in produzione.
//
// Regola per il futuro: ogni colonna uc nuova va in `src/lib/uc/ddl.ts`
// (`ADD COLUMN IF NOT EXISTS`), in `UC_ADDITIVE_COLUMNS` e qui in
// `UC_ENSURE_VERSION`. Il probe confronta anche l'impronta del DDL e, in una
// colonna a parte, guarda l'indice unico tra dossier e scheda (versione 2,
// docs/use-case/DESIGN.md §10.4). Con un doppione il DDL salta l'indice e la
// sezione resta disponibile, con il self-heal acceso e spento: conta solo
// `current`. Il log lo dice (`doppioni_dossier`, o `indice_unico_assente` se i
// doppioni non ci sono più e manca solo la 0018 da riapplicare), una volta per
// avvio a freddo. Il self-heal acceso riprova a ogni avvio a freddo solo il
// blocco dell'indice, non tutto il DDL, e un suo errore non spegne la sezione.
//
// Gli import della parte uc stanno qui e non in testa al file: la testa è della
// parte principale (hub, connettore), così le unioni in avanti non si toccano.

import { UC_DOSSIER_DUPLICATES_SQL, UC_UNIQUE_DOSSIER_INDEX_DDL } from "../uc/ddl.ts";
import { errorCodeOf, pgCodeOf, ucLog, ucLogError } from "../uc/log.ts";
import { ucSelfHealEnabled } from "../uc/platform.ts";

/** Incrementa ad ogni modifica al DDL uc: così i worker warm ri-eseguono il controllo. */
const UC_ENSURE_VERSION = 3;

/** La sezione «Casi d'uso» è spenta (`UC_ENABLED` diverso da "true"). */
export class UcSchemaDisabledError extends Error {
  constructor() {
    super("Sezione Casi d'uso disattivata (UC_ENABLED).");
    this.name = "UcSchemaDisabledError";
  }
}

/** Self-heal spento (`UC_SCHEMA_SELF_HEAL=off`) e sonda falsa: lo schema uc si aggiorna a mano. */
export class UcSchemaNotCurrentError extends Error {
  readonly code = "schema_non_aggiornato";
  constructor() {
    super("Schema dei Casi d'uso non aggiornato: applica la migrazione 0018 (self-heal spento).");
    this.name = "UcSchemaNotCurrentError";
  }
}

/** Esito della sonda uc (`UC_PROBE_SQL`). */
export interface UcSchemaState {
  /** Schema allineato al DDL uc: la sezione può servire. */
  current: boolean;
  /** C'è l'indice unico tra dossier e scheda (il DDL lo salta finché c'è un doppione). */
  uniqueIndex: boolean;
}

/** Schema aggiornato ma senza indice unico: doppioni da sistemare, o solo la 0018 da riapplicare. */
export type UcMissingIndexCode = "doppioni_dossier" | "indice_unico_assente";

export interface UcSchemaEnsurerDeps {
  enabled: () => boolean;
  /** Le FK uc puntano a tabelle esistenti: prima si allinea lo schema dell'app. */
  ensureBase: () => Promise<void>;
  probe: () => Promise<UcSchemaState>;
  apply: (statements: readonly string[]) => Promise<void>;
  ddl: readonly string[];
  /** Con lo schema già aggiornato e l'indice unico assente si applica solo questo. Predefinito: `[UC_UNIQUE_DOSSIER_INDEX_DDL]`. */
  indexDdl?: readonly string[];
  /** Falso con il self-heal spento (`ucSelfHealEnabled`): solo la sonda, mai il DDL. Predefinito: acceso. */
  selfHeal?: () => boolean;
  /** Ci sono doppioni? Letta solo con lo schema aggiornato e l'indice assente; un errore vale «sì». Predefinito: sì. */
  duplicates?: () => Promise<boolean>;
  log?: Pick<Console, "warn" | "error">;
  /** Schema aggiornato senza indice unico: la sezione resta disponibile e lo si dice qui. Predefinito: `log.warn`. */
  missingIndex?: (code: UcMissingIndexCode, op: "self_heal" | "sonda") => void;
  /** Il blocco dell'indice da solo è fallito (lock, rete): la sezione resta disponibile. Predefinito: `log.warn`. */
  indexFailed?: (err: unknown) => void;
}

/**
 * Self-heal uc con promessa memoizzata propria; un errore la azzera per il
 * prossimo tentativo. Con il self-heal spento una sonda con `current` falso
 * rifiuta con `UcSchemaNotCurrentError`, senza toccare lo schema, e non si
 * memoizza: dopo l'applicazione manuale della migrazione la richiesta dopo
 * riparte senza deploy.
 *
 * L'indice unico tra dossier e scheda non spegne mai la sezione (DESIGN §10.4):
 * con `current` vero e l'indice assente la promessa si risolve, e si memoizza,
 * dopo una riga di log (`missingIndex`). Il self-heal acceso prova solo il blocco
 * dell'indice (`indexDdl`), che lo crea se i doppioni non ci sono più: tutto il
 * DDL, con i lock su ogni tabella uc, si ripete solo con `current` falso. Se quel
 * blocco fallisce lo dice `indexFailed` e la promessa si risolve lo stesso.
 * «Sonda falsa dopo il DDL» resta solo per uno schema che il DDL non ha allineato.
 */
export function createUcSchemaEnsurer(deps: UcSchemaEnsurerDeps): { ensure: () => Promise<void>; reset: () => void } {
  const log = deps.log ?? console;
  const missingIndex = deps.missingIndex ?? ((code: UcMissingIndexCode) => log.warn(`[db/ensure-schema] uc unique dossier index missing (${code})`));
  const indexFailed = deps.indexFailed ?? ((err: unknown) => log.warn("[db/ensure-schema] uc unique dossier index not applied:", err));
  const indexDdl = deps.indexDdl ?? [UC_UNIQUE_DOSSIER_INDEX_DDL];
  let promise: Promise<void> | null = null;
  return {
    ensure() {
      if (!deps.enabled()) return Promise.reject(new UcSchemaDisabledError());
      if (promise) return promise;
      const selfHeal = deps.selfHeal ? deps.selfHeal() : true;
      const reportMissingIndex = async () => {
        const duplicates = deps.duplicates ? await deps.duplicates().catch(() => true) : true;
        missingIndex(duplicates ? "doppioni_dossier" : "indice_unico_assente", selfHeal ? "self_heal" : "sonda");
      };
      promise = (async () => {
        if (!selfHeal) {
          const state = await deps.probe();
          if (!state.current) throw new UcSchemaNotCurrentError();
          if (!state.uniqueIndex) await reportMissingIndex();
          return;
        }
        await deps.ensureBase();
        const before = await deps.probe();
        if (before.current && before.uniqueIndex) return;
        if (before.current) {
          // Lo schema serve già: solo l'indice, e un suo errore non spegne la sezione.
          const applied = await deps.apply(indexDdl).then(
            () => true,
            (err: unknown) => {
              indexFailed(err);
              return false;
            },
          );
          if (!applied || !(await deps.probe()).uniqueIndex) await reportMissingIndex();
          return;
        }
        await deps.apply(deps.ddl);
        const after = await deps.probe();
        if (!after.current) log.warn("[db/ensure-schema] uc schema probe still false after self-heal");
        else if (!after.uniqueIndex) await reportMissingIndex();
      })().catch((err) => {
        promise = null;
        if (err instanceof UcSchemaNotCurrentError) log.error("[db/ensure-schema] uc schema not current and the uc self-heal is off");
        else log.error("[db/ensure-schema] uc self-heal failed:", err);
        throw err;
      });
      return promise;
    },
    reset() {
      promise = null;
    },
  };
}

/** Sonda uc: schema allineato al DDL corrente (tabelle, funzioni, trigger, CHECK, impronta) e indice unico. */
export async function ucSchemaState(): Promise<UcSchemaState> {
  try {
    const result = (await db.execute(sql.raw(UC_PROBE_SQL))) as unknown as { rows?: Array<{ current?: unknown; unique_index?: unknown }> };
    const row = result.rows?.[0];
    return { current: row?.current === true, uniqueIndex: row?.unique_index === true };
  } catch (err) {
    ucLog({ level: "warn", area: "uc.schema", op: "sonda", code: errorCodeOf(err), pgCode: pgCodeOf(err) });
    return { current: false, uniqueIndex: false };
  }
}

/** Vero se il self-heal uc non ha nulla da fare: schema allineato e indice unico presente. */
export async function ucSchemaLooksCurrent(): Promise<boolean> {
  const state = await ucSchemaState();
  return state.current && state.uniqueIndex;
}

/** Ci sono doppioni tra dossier e scheda (righe complete e incomplete)? Nel dubbio sì: il rimedio è `dossier-dups`. */
export async function ucDossierDuplicates(): Promise<boolean> {
  try {
    const result = (await db.execute(sql.raw(UC_DOSSIER_DUPLICATES_SQL))) as unknown as { rows?: Array<{ duplicates?: unknown }> };
    return result.rows?.[0]?.duplicates !== false;
  } catch (err) {
    ucLog({ level: "warn", area: "uc.schema", op: "doppioni", code: errorCodeOf(err), pgCode: pgCodeOf(err) });
    return true;
  }
}

/**
 * Applica il DDL uc in una sola transazione, serializzata da un advisory lock:
 * o tutto o niente, e due avvii a freddo non si pestano i piedi. Il NOTICE di un
 * indice unico saltato non arriva fin qui: lo dice la sonda dopo il DDL.
 */
export async function runUcOnce(statements: readonly string[] = UC_DDL): Promise<void> {
  const client = db.$client;
  await client.transaction([
    client.query("SELECT pg_advisory_xact_lock(hashtext('unbundle:uc-ddl'))"),
    ...statements.map((statement) => client.query(statement)),
  ]);
}

/** Log del self-heal uc in una riga JSON (P0-6): codici, mai l'errore per esteso. */
const ucSchemaLog: Pick<Console, "warn" | "error"> = {
  warn: () => {
    ucLog({ level: "warn", area: "uc.schema", op: "self_heal", code: "sonda_falsa_dopo_ddl" });
  },
  error: (_message?: unknown, err?: unknown) => {
    if (err === undefined) ucLog({ level: "error", area: "uc.schema", op: "sonda", code: "schema_non_aggiornato" });
    else ucLogError({ area: "uc.schema", op: "self_heal" }, err);
  },
};

const ucEnsurer = createUcSchemaEnsurer({
  enabled: () => process.env.UC_ENABLED === "true",
  ensureBase: ensureDbSchema,
  probe: ucSchemaState,
  apply: runUcOnce,
  ddl: UC_DDL,
  selfHeal: () => ucSelfHealEnabled(process.env),
  duplicates: ucDossierDuplicates,
  log: ucSchemaLog,
  missingIndex: (code, op) => {
    ucLog({ level: "warn", area: "uc.schema", op, code });
  },
  indexFailed: (err) => {
    ucLog({ level: "warn", area: "uc.schema", op: "self_heal", code: "indice_unico_non_applicato", pgCode: pgCodeOf(err) });
  },
});
let ucEnsureVersionApplied = 0;

/**
 * Self-heal delle tabelle uc. Rifiuta con `UcSchemaDisabledError` se la sezione
 * è spenta e con `UcSchemaNotCurrentError` se il self-heal è spento e lo schema
 * non è aggiornato (le rotte uc rispondono 503).
 */
export async function ensureUcSchema(): Promise<void> {
  if (ucEnsureVersionApplied !== UC_ENSURE_VERSION) {
    ucEnsurer.reset();
    ucEnsureVersionApplied = UC_ENSURE_VERSION;
  }
  return ucEnsurer.ensure();
}
