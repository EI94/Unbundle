#!/usr/bin/env node
/** Scoped response deletion. Dry-run reads only; never loads .env, schedules itself or executes DDL. */
import { neon } from "@neondatabase/serverless";
import { z } from "zod";
import { learningRetentionEligibility } from "../src/lib/learning/retention.ts";

async function main() {
  const allowed = new Set(["--workspace", "--program", "--actor", "--environment", "--confirm-database", "--apply", "--confirm-authorized", "--production-approved"]);
  const booleans = new Set(["--apply", "--confirm-authorized", "--production-approved"]);
  const args = process.argv.slice(2), values = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (!allowed.has(option) || values.has(option)) throw new Error("Invalid or duplicate retention option");
    if (booleans.has(option)) { values.set(option, "true"); continue; }
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${option}`);
    values.set(option, value);
  }
  const required = (key: string) => { const value = values.get(`--${key}`); if (!value) throw new Error(`Missing --${key}`); return value; };
  const workspaceId = z.uuid().parse(required("workspace")), programId = z.uuid().parse(required("program")), actorId = z.uuid().parse(required("actor"));
  const environment = z.enum(["local", "preview", "production"]).parse(required("environment"));
  const apply = values.has("--apply");
  if (apply && !values.has("--confirm-authorized")) throw new Error("Deletion requires --confirm-authorized from the responsible operator");
  if (apply && environment === "production" && !values.has("--production-approved")) throw new Error("Production deletion requires explicit responsible approval: --production-approved");
  const databaseUrl = process.env.LEARNING_ADMIN_DATABASE_URL;
  if (!databaseUrl) throw new Error("Set LEARNING_ADMIN_DATABASE_URL explicitly; .env and DATABASE_URL are not used");
  const target = new URL(databaseUrl);
  const fingerprint = `${target.hostname}${target.port ? `:${target.port}` : ""}${target.pathname}`;
  if (required("confirm-database") !== fingerprint) throw new Error("Database confirmation does not match hostname[:port]/database");
  const sql = neon(databaseUrl);
  // Workspace membership AND an unscoped explicit manage grant are required, even for dry-run counts.
  const programRows = await sql`SELECT p.status,p.closed_at,p.retention_days,
      (SELECT count(*)::int FROM learning_attempts a WHERE a.workspace_id=p.workspace_id AND a.program_id=p.id) AS attempts,
      (SELECT count(*)::int FROM learning_idea_drafts d WHERE d.workspace_id=p.workspace_id AND d.program_id=p.id) AS idea_drafts
    FROM learning_programs p JOIN workspaces w ON w.id=p.workspace_id
    WHERE p.workspace_id=${workspaceId}::uuid AND p.id=${programId}::uuid
      AND EXISTS(SELECT 1 FROM learning_grants g WHERE g.workspace_id=p.workspace_id AND g.program_id=p.id AND g.user_id=${actorId}::uuid AND g.capability='manage' AND g.cohort_id IS NULL AND g.revoked_at IS NULL)
      AND (EXISTS(SELECT 1 FROM memberships m WHERE m.organization_id=w.organization_id AND m.user_id=${actorId}::uuid)
        OR EXISTS(SELECT 1 FROM workspace_memberships wm WHERE wm.workspace_id=w.id AND wm.user_id=${actorId}::uuid))`;
  const program = programRows[0];
  if (!program) throw new Error("Program unavailable in the authorized management scope");
  const eligibility = learningRetentionEligibility({ status: String(program.status), closedAt: program.closed_at ? new Date(String(program.closed_at)) : null, retentionDays: Number(program.retention_days) });
  if (!apply) {
    console.log(JSON.stringify({ status: "DRY_RUN_READ_ONLY", workspaceId, programId, ...eligibility,
      wouldDelete: eligibility.eligible ? { attempts: program.attempts, ideaDrafts: program.idea_drafts } : { attempts: 0, ideaDrafts: 0 },
      retains: ["enrollments", "program content", "sessions", "grants", "audit counts", "promoted portfolio proposals"],
    }, null, 2));
    return;
  }
  if (!eligibility.eligible) throw new Error("Program is not closed beyond its configured retention period; nothing deleted");
  // Lock and recheck eligibility/authorization in the same atomic statement as both deletes and audit.
  // All parent/child attempts are deleted together, preserving FK consistency. No portfolio row is deleted.
  const results = await sql`WITH eligible AS MATERIALIZED (
      SELECT p.id,p.retention_days FROM learning_programs p JOIN workspaces w ON w.id=p.workspace_id
      WHERE p.workspace_id=${workspaceId}::uuid AND p.id=${programId}::uuid AND p.status IN ('closed','archived')
        AND p.closed_at IS NOT NULL AND p.closed_at + p.retention_days * interval '24 hours' <= now()
        AND EXISTS(SELECT 1 FROM learning_grants g WHERE g.workspace_id=p.workspace_id AND g.program_id=p.id AND g.user_id=${actorId}::uuid AND g.capability='manage' AND g.cohort_id IS NULL AND g.revoked_at IS NULL)
        AND (EXISTS(SELECT 1 FROM memberships m WHERE m.organization_id=w.organization_id AND m.user_id=${actorId}::uuid)
          OR EXISTS(SELECT 1 FROM workspace_memberships wm WHERE wm.workspace_id=w.id AND wm.user_id=${actorId}::uuid))
      FOR UPDATE OF p
    ), deleted_attempts AS (
      DELETE FROM learning_attempts a USING eligible e WHERE a.workspace_id=${workspaceId}::uuid AND a.program_id=e.id RETURNING a.id
    ), deleted_ideas AS (
      DELETE FROM learning_idea_drafts d USING eligible e WHERE d.workspace_id=${workspaceId}::uuid AND d.program_id=e.id RETURNING d.id
    ) INSERT INTO learning_audit_events(workspace_id,program_id,actor_id,resource_id,event_type,metadata)
      SELECT ${workspaceId}::uuid,e.id,${actorId}::uuid,e.id,'retention_purged',
        jsonb_build_object('attemptsDeleted',(SELECT count(*) FROM deleted_attempts),'ideaDraftsDeleted',(SELECT count(*) FROM deleted_ideas),'retentionDays',e.retention_days,'basis','elapsed_24_hour_days_from_closed_at')
      FROM eligible e RETURNING metadata`;
  if (!results[0]) throw new Error("Scope or eligibility changed; no data deleted");
  console.log(JSON.stringify({ status: "RESPONSES_DELETED", workspaceId, programId, counts: results[0].metadata, promotedPortfolioPreserved: true }, null, 2));
}
main().catch(() => {
  // Do not print database exceptions, URLs, parameters, private content or credentials.
  console.error("Retention not completed. Verify explicit options, current manager authorization, recorded closure and retention deadline. No success is claimed; use dry-run and database verification before retrying.");
  process.exitCode = 1;
});
