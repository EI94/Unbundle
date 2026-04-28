import { sql } from "drizzle-orm";
import { db } from ".";

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
const ENSURE_VERSION = 6;

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
}

async function schemaLooksCurrent(): Promise<boolean> {
  try {
    const result = (await db.execute(sql`
      SELECT (
        to_regtype('public.portfolio_review_status') IS NOT NULL
        AND to_regclass('public.workspace_memberships') IS NOT NULL
        AND to_regclass('public.workspace_invitations') IS NOT NULL
        AND to_regclass('public.workspace_invitation_acceptances') IS NOT NULL
        AND to_regclass('public.workspace_scoring_models') IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'workspaces'
            AND column_name IN (
              'esg_enabled',
              'ai_transformation_team_name',
              'whatsapp_webhook_url',
              'unit_terminology'
            )
          GROUP BY table_name
          HAVING count(*) = 4
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
