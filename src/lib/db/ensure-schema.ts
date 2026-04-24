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
const ENSURE_VERSION = 2;

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
      ADD COLUMN IF NOT EXISTS "slack_channel_id" varchar(50);
  `);
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
  ensurePromise = runOnce().catch((err) => {
    ensurePromise = null;
    console.error("[db/ensure-schema] self-heal failed:", err);
    throw err;
  });
  return ensurePromise;
}
