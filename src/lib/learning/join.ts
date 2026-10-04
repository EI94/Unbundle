import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { hashJoinToken, looksLikeJoinToken } from "./join-token";

/**
 * Iscrizione a una lezione tramite link del formatore.
 *
 * Il link e' una porta, non un'autorita': crea le precondizioni per entrare
 * (membership `learner` e iscrizione al turno) e non aggira nessuno dei cancelli
 * del modulo. Chi scrive resta deciso dal write guard SQL di server.ts, la
 * visibilita' resta decisa da LEARNING_ENABLED e da feature_enabled, e una
 * iscrizione sospesa dal formatore non viene mai riaperta da un link.
 */

export type JoinUnusableReason =
  | "not_found"
  | "revoked"
  | "expired"
  | "door_closed"
  | "course_unavailable"
  | "full";

export type JoinPreview = {
  ok: true;
  workspaceId: string;
  workspaceName: string;
  programId: string;
  programTitle: string;
  moduleId: string;
  moduleTitle: string | null;
  cohortId: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  sessionStatus: string;
  durationMinutes: number | null;
  retentionDays: number;
  trainerName: string | null;
  seatsLeft: number;
  label: string | null;
};

/**
 * Quando il link è valido ma non si può ancora entrare (ingresso chiuso, posti
 * finiti) si mostrano comunque corso e lezione: chi apre il link deve capire
 * di avere quello giusto, e l'anteprima nelle chat — che WhatsApp memorizza al
 * primo invio — non deve restare una scheda anonima.
 */
export type JoinCourseCard = Pick<JoinPreview, "programTitle" | "workspaceName" | "moduleTitle" | "startsAt" | "endsAt" | "timezone" | "trainerName">;
export type JoinPreviewResult = JoinPreview | { ok: false; reason: JoinUnusableReason; course: JoinCourseCard | null };

type PreviewRow = {
  workspaceId: string;
  workspaceName: string;
  programId: string;
  programTitle: string;
  moduleId: string;
  cohortId: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  sessionStatus: string;
  retentionDays: number;
  trainerName: string | null;
  label: string | null;
  seatsLeft: number;
  revoked: boolean;
  expired: boolean;
  doorOpen: boolean;
  courseReady: boolean;
  moduleTitle: string | null;
  durationMinutes: number | null;
};

/**
 * Dati da mostrare sulla pagina pubblica, senza richiedere una sessione.
 *
 * Espone il minimo che serve a far capire a una persona dove sta entrando:
 * corso, lezione, orario, durata e nome del formatore. Mai la sua email, mai
 * identificatori interni, mai i contenuti del pacchetto.
 */
export async function getJoinPreview(token: string): Promise<JoinPreviewResult> {
  if (!looksLikeJoinToken(token)) return { ok: false, reason: "not_found", course: null };

  const { rows } = await db.execute(sql`
    SELECT
      l.workspace_id AS "workspaceId", w.name AS "workspaceName",
      l.program_id AS "programId", p.title AS "programTitle",
      l.module_id AS "moduleId", l.cohort_id AS "cohortId",
      s.starts_at AS "startsAt", s.ends_at AS "endsAt", s.timezone, s.status AS "sessionStatus",
      p.retention_days AS "retentionDays",
      trainer.name AS "trainerName",
      l.label,
      GREATEST(l.max_uses - l.used_count, 0)::int AS "seatsLeft",
      (l.revoked_at IS NOT NULL) AS revoked,
      (l.expires_at <= now()) AS expired,
      l.door_open AS "doorOpen",
      (p.feature_enabled AND p.status = 'published') AS "courseReady",
      (SELECT m->>'title' FROM jsonb_array_elements(p.private_pack->'modules') m
        WHERE m->>'id' = l.module_id LIMIT 1) AS "moduleTitle",
      (SELECT (m->>'duration_minutes')::int FROM jsonb_array_elements(p.private_pack->'modules') m
        WHERE m->>'id' = l.module_id LIMIT 1) AS "durationMinutes"
    FROM learning_join_links l
    JOIN learning_programs p ON p.workspace_id = l.workspace_id AND p.id = l.program_id
    JOIN workspaces w ON w.id = l.workspace_id
    JOIN learning_sessions s ON s.workspace_id = l.workspace_id AND s.program_id = l.program_id
      AND s.module_id = l.module_id AND s.cohort_id = l.cohort_id
    LEFT JOIN users trainer ON trainer.id = l.created_by
    WHERE l.token_hash = ${hashJoinToken(token)}
    LIMIT 1
  `);

  const row = rows[0] as PreviewRow | undefined;
  if (!row) return { ok: false, reason: "not_found", course: null };
  // Link morto o corso nascosto: niente dettagli, il link non porta da nessuna parte.
  if (row.revoked) return { ok: false, reason: "revoked", course: null };
  if (row.expired) return { ok: false, reason: "expired", course: null };
  if (!row.courseReady) return { ok: false, reason: "course_unavailable", course: null };
  const course: JoinCourseCard = {
    programTitle: row.programTitle, workspaceName: row.workspaceName, moduleTitle: row.moduleTitle,
    startsAt: new Date(row.startsAt).toISOString(), endsAt: new Date(row.endsAt).toISOString(),
    timezone: row.timezone, trainerName: row.trainerName,
  };
  if (!row.doorOpen) return { ok: false, reason: "door_closed", course };
  if (row.seatsLeft <= 0) return { ok: false, reason: "full", course };

  return {
    ok: true,
    workspaceId: row.workspaceId,
    workspaceName: row.workspaceName,
    programId: row.programId,
    programTitle: row.programTitle,
    moduleId: row.moduleId,
    moduleTitle: row.moduleTitle,
    cohortId: row.cohortId,
    startsAt: new Date(row.startsAt).toISOString(),
    endsAt: new Date(row.endsAt).toISOString(),
    timezone: row.timezone,
    sessionStatus: row.sessionStatus,
    durationMinutes: row.durationMinutes,
    retentionDays: row.retentionDays,
    trainerName: row.trainerName,
    seatsLeft: row.seatsLeft,
    label: row.label,
  };
}

export type JoinOutcome =
  | "enrolled"
  | "already_enrolled"
  | "moved"
  | "kept_other_cohort";

export type JoinResult =
  | {
      ok: true;
      outcome: JoinOutcome;
      workspaceId: string;
      programId: string;
      moduleId: string;
      cohortId: string;
      previousCohortId: string | null;
    }
  | { ok: false; reason: JoinUnusableReason | "suspended" | "unknown" };

type JoinRow = {
  linkFound: number;
  allowed: number;
  suspended: number;
  seatsLeft: number;
  revoked: boolean | null;
  expired: boolean | null;
  doorOpen: boolean | null;
  courseReady: boolean | null;
  workspaceId: string | null;
  programId: string | null;
  moduleId: string | null;
  cohortId: string | null;
  outcome: JoinOutcome | null;
  previousCohort: string | null;
};

/**
 * Prende il posto e iscrive, in una sola istruzione.
 *
 * Tutte le condizioni del link sono rivalutate qui dentro — revoca, scadenza,
 * porta, posti, stato del corso — perche' fra il momento in cui la pagina e'
 * stata mostrata e questa chiamata il formatore puo' aver chiuso la porta o
 * revocato il link.
 *
 * I "doppioni" del committente non possono essere iscrizioni doppie: il vincolo
 * unique su (workspace, program, user, module) dice che una persona ha una sola
 * iscrizione per modulo, e le lezioni sono turni dello stesso modulo. Quindi i
 * doppioni sono LINK, e convergono tutti sulla stessa iscrizione:
 *
 *  - nessuna iscrizione          -> la crea sul turno del link           (enrolled)
 *  - stessa coorte del link      -> niente, in silenzio                  (already_enrolled)
 *  - altra coorte, nessun lavoro -> la sposta sul turno del link         (moved)
 *  - altra coorte, con lavoro    -> non tocca nulla                      (kept_other_cohort)
 *  - iscrizione sospesa          -> si ferma: un link non annulla una decisione del formatore
 *
 * Il posto si consuma solo alla prima riscossione di quella persona su quel
 * link: riaprire lo stesso link non ne brucia un secondo.
 */
export async function joinCourseByLink(params: {
  token: string;
  userId: string;
  email: string;
}): Promise<JoinResult> {
  if (!looksLikeJoinToken(params.token)) return { ok: false, reason: "not_found" };

  const hash = hashJoinToken(params.token);
  const uid = sql`${params.userId}::uuid`;

  const { rows } = await db.execute(sql`
    WITH candidate AS MATERIALIZED (
      SELECT l.id, l.workspace_id, l.program_id, l.module_id, l.cohort_id,
             l.max_uses, l.used_count, l.created_by,
             (l.revoked_at IS NOT NULL) AS revoked,
             (l.expires_at <= now()) AS expired,
             l.door_open,
             (p.feature_enabled AND p.status = 'published') AS course_ready
      FROM learning_join_links l
      JOIN learning_programs p ON p.workspace_id = l.workspace_id AND p.id = l.program_id
      WHERE l.token_hash = ${hash}
    ),
    usable AS MATERIALIZED (
      SELECT * FROM candidate
      WHERE NOT revoked AND NOT expired AND door_open AND course_ready
    ),
    prior AS MATERIALIZED (
      SELECT r.id FROM learning_join_redemptions r, usable u
      WHERE r.link_id = u.id AND r.user_id = ${uid}
    ),
    existing AS MATERIALIZED (
      SELECT e.id, e.cohort_id, e.status,
        (EXISTS(SELECT 1 FROM learning_attempts a
            WHERE a.workspace_id = e.workspace_id AND a.program_id = e.program_id AND a.enrollment_id = e.id)
         OR EXISTS(SELECT 1 FROM learning_idea_drafts d
            WHERE d.workspace_id = e.workspace_id AND d.program_id = e.program_id AND d.enrollment_id = e.id)
        ) AS has_work
      FROM learning_enrollments e, usable u
      WHERE e.workspace_id = u.workspace_id AND e.program_id = u.program_id
        AND e.user_id = ${uid} AND e.module_id = u.module_id
    ),
    allowed AS MATERIALIZED (
      SELECT 1 FROM usable u
      WHERE NOT EXISTS(SELECT 1 FROM existing WHERE status <> 'active')
        AND (EXISTS(SELECT 1 FROM prior)
             OR EXISTS(SELECT 1 FROM existing)
             OR u.used_count < u.max_uses)
    ),
    seat AS (
      UPDATE learning_join_links l SET used_count = l.used_count + 1
      FROM usable u
      WHERE l.id = u.id AND EXISTS(SELECT 1 FROM allowed)
        AND NOT EXISTS(SELECT 1 FROM prior)
        AND l.used_count < l.max_uses
      RETURNING l.id
    ),
    membership AS (
      INSERT INTO workspace_memberships(workspace_id, user_id, role, source, invited_by_user_id)
      SELECT u.workspace_id, ${uid}, 'learner'::member_role, 'learning_join_link', u.created_by
      FROM usable u, allowed
      ON CONFLICT (workspace_id, user_id) DO NOTHING
      RETURNING user_id
    ),
    moved AS (
      UPDATE learning_enrollments e SET cohort_id = u.cohort_id
      FROM usable u, existing x
      WHERE e.id = x.id AND EXISTS(SELECT 1 FROM allowed)
        AND x.cohort_id <> u.cohort_id AND NOT x.has_work
      RETURNING e.id
    ),
    created AS (
      INSERT INTO learning_enrollments(workspace_id, program_id, user_id, module_id, cohort_id)
      SELECT u.workspace_id, u.program_id, ${uid}, u.module_id, u.cohort_id
      FROM usable u, allowed
      WHERE NOT EXISTS(SELECT 1 FROM existing)
      ON CONFLICT (workspace_id, program_id, user_id, module_id) DO NOTHING
      RETURNING id
    ),
    -- Dipende da allowed: senza quel vincolo l'istruzione riporterebbe un
    -- esito anche nei casi in cui non ha scritto nulla (iscrizione sospesa,
    -- posti esauriti), e chi leggesse outcome prima di suspended
    -- concluderebbe che la persona e' entrata.
    resolved AS (
      SELECT id, 'enrolled'::text AS outcome, NULL::text AS previous FROM created
      UNION ALL
      SELECT x.id,
        CASE
          WHEN EXISTS(SELECT 1 FROM moved WHERE moved.id = x.id) THEN 'moved'
          WHEN x.cohort_id = (SELECT cohort_id FROM usable) THEN 'already_enrolled'
          ELSE 'kept_other_cohort'
        END,
        x.cohort_id
      FROM existing x, allowed
    ),
    redemption AS (
      INSERT INTO learning_join_redemptions(
        workspace_id, program_id, link_id, user_id, enrollment_id, email_snapshot, outcome)
      SELECT u.workspace_id, u.program_id, u.id, ${uid}, r.id, ${params.email}, r.outcome
      FROM usable u, resolved r, allowed
      ON CONFLICT (link_id, user_id) DO NOTHING
      RETURNING id
    ),
    audited AS (
      INSERT INTO learning_audit_events(
        workspace_id, program_id, actor_id, resource_id, event_type, metadata)
      SELECT u.workspace_id, u.program_id, ${uid}, r.id,
        CASE WHEN r.outcome = 'moved' THEN 'learner_cohort_moved' ELSE 'learner_joined_by_link' END,
        jsonb_build_object('cohortId', u.cohort_id, 'linkId', u.id, 'outcome', r.outcome)
      FROM usable u, resolved r, allowed
      RETURNING id
    )
    SELECT
      (SELECT count(*) FROM candidate)::int AS "linkFound",
      (SELECT count(*) FROM allowed)::int AS allowed,
      (SELECT count(*) FROM existing WHERE status <> 'active')::int AS suspended,
      -- La CTE candidate e' fotografata prima dell'UPDATE del posto: sottraggo
      -- quello appena preso, altrimenti il numero mostrato e' vecchio di uno.
      GREATEST(
        COALESCE((SELECT max_uses - used_count FROM candidate), 0)
          - (SELECT count(*) FROM seat), 0
      )::int AS "seatsLeft",
      (SELECT revoked FROM candidate) AS revoked,
      (SELECT expired FROM candidate) AS expired,
      (SELECT door_open FROM candidate) AS "doorOpen",
      (SELECT course_ready FROM candidate) AS "courseReady",
      (SELECT workspace_id FROM usable) AS "workspaceId",
      (SELECT program_id FROM usable) AS "programId",
      (SELECT module_id FROM usable) AS "moduleId",
      (SELECT cohort_id FROM usable) AS "cohortId",
      (SELECT outcome FROM resolved LIMIT 1) AS outcome,
      (SELECT previous FROM resolved LIMIT 1) AS "previousCohort"
  `);

  const row = rows[0] as JoinRow | undefined;
  if (!row || row.linkFound === 0) return { ok: false, reason: "not_found" };
  if (row.revoked) return { ok: false, reason: "revoked" };
  if (row.expired) return { ok: false, reason: "expired" };
  if (!row.courseReady) return { ok: false, reason: "course_unavailable" };
  if (!row.doorOpen) return { ok: false, reason: "door_closed" };
  if (row.suspended > 0) return { ok: false, reason: "suspended" };
  if (row.allowed === 0) {
    return { ok: false, reason: row.seatsLeft <= 0 ? "full" : "unknown" };
  }
  if (!row.outcome || !row.workspaceId || !row.programId || !row.moduleId || !row.cohortId) {
    return { ok: false, reason: "unknown" };
  }

  return {
    ok: true,
    outcome: row.outcome,
    workspaceId: row.workspaceId,
    programId: row.programId,
    moduleId: row.moduleId,
    cohortId: row.cohortId,
    previousCohortId: row.outcome === "moved" ? row.previousCohort : null,
  };
}

/**
 * «Chiedi al formatore di riaprire il turno».
 *
 * Unico campo che il partecipante puo' cambiare su una riscossione esistente,
 * e il trigger della migrazione 0014 lo garantisce. La riga e' unica per
 * (link, persona), quindi la richiesta e' auto-limitata a una per persona per
 * link: non serve alcun rate limiting.
 */
export async function requestCohortReopen(params: {
  token: string;
  userId: string;
}): Promise<{ ok: boolean }> {
  if (!looksLikeJoinToken(params.token)) return { ok: false };
  const { rows } = await db.execute(sql`
    WITH changed AS (
      UPDATE learning_join_redemptions r SET reopen_requested_at = now()
      FROM learning_join_links l
      WHERE l.token_hash = ${hashJoinToken(params.token)}
        AND r.link_id = l.id AND r.user_id = ${params.userId}::uuid
        AND r.outcome = 'kept_other_cohort' AND r.reopen_requested_at IS NULL
      RETURNING r.id
    )
    SELECT count(*)::int AS changed FROM changed
  `);
  return { ok: Number((rows[0] as { changed?: number } | undefined)?.changed ?? 0) > 0 };
}
