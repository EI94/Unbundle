import "server-only";
import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getWorkspaceAccessForUser } from "@/lib/workspace-access";
import { LearningError, learningEnabled } from "./server";
import type { PrivateTrainingPack } from "./types";
import {
  companyDomain,
  companyDomains,
  DOCUMENTED,
  distinctPeople,
  isValidDomain,
  joinTiming,
  joinTimingLabel,
  moduleCompetencies,
  participation,
  participationLabel,
  type JoinTiming,
  type ParticipationStatus,
} from "./register-model";

/**
 * Registro della formazione in materia di IA, per l'amministratore dell'azienda.
 *
 * Si ricava dai fatti che la piattaforma registra — turni, iscrizioni, ingressi
 * dal link, consegne, materiali con impronta, versione del contenuto — più i
 * pochi dati che solo l'azienda conosce. Non è una tabella da tenere
 * aggiornata: non può divergere da ciò che è successo.
 */

const BOOTSTRAP_ROLES = ["exec_sponsor", "transformation_lead"];
/** 27 luglio 2026, 00:00 a Roma: entra in vigore il testo dell'art. 4 modificato dal Reg. (UE) 2026/1744. */
const ARTICLE4_AMENDED_FROM = Date.parse("2026-07-26T22:00:00Z");
export const AI_ACT_ROLES = { deployer: "Deployer (utilizza sistemi di IA)", provider: "Fornitore (sviluppa o immette sistemi di IA)", both: "Deployer e fornitore" } as const;
export const REGISTER_PROVIDER = { name: "Lateral Space", platform: "Unbundle" };

async function rows<T>(query: SQL): Promise<T[]> {
  return (await db.execute(query)).rows as T[];
}
const iso = (value: string | Date) => new Date(value).toISOString();
const forbidden = () => new LearningError("forbidden", "Registro non disponibile per questo account.");

export type RegisterAccess = Awaited<ReturnType<typeof requireRegisterAccess>>;

/**
 * Chi consulta il registro: chi amministra il workspace (tutti i corsi), oppure
 * chi gestisce o esporta un corso (solo quei corsi). Un partecipante mai,
 * nemmeno del proprio corso.
 */
export async function requireRegisterAccess(workspaceId: string) {
  if (!learningEnabled()) throw new LearningError("unavailable", "La formazione non è disponibile in questo ambiente.");
  if (!z.uuid().safeParse(workspaceId).success) throw forbidden();
  const session = await auth();
  if (!session?.user?.id) throw new LearningError("unauthenticated", "Accedi di nuovo per consultare il registro.");
  const userId = session.user.id;
  const access = await getWorkspaceAccessForUser(userId, workspaceId);
  if (!access || access.role === "learner") throw forbidden();
  const admin = BOOTSTRAP_ROLES.includes(access.role);
  let programIds: string[] | null = null;
  if (!admin) {
    const granted = await rows<{ programId: string }>(sql`SELECT DISTINCT program_id AS "programId" FROM learning_grants
      WHERE workspace_id=${workspaceId}::uuid AND user_id=${userId}::uuid AND revoked_at IS NULL AND capability IN ('manage','export')`);
    if (!granted.length) throw forbidden();
    programIds = granted.map((grant) => grant.programId);
  }
  return { userId, workspace: access.workspace, programIds, canEditSettings: admin };
}

const inScope = (access: Pick<RegisterAccess, "programIds">, programId: string) =>
  access.programIds === null || access.programIds.includes(programId);

export type RegisterParticipant = {
  key: string;
  userId: string | null;
  name: string;
  email: string | null;
  programId: string;
  programTitle: string;
  moduleId: string;
  moduleTitle: string;
  cohortId: string;
  sessionStartsAt: string;
  sessionHeld: boolean;
  source: "piattaforma" | "registrazione_manuale";
  joinedAt: string | null;
  joinTiming: JoinTiming | null;
  joinLabel: string;
  required: number;
  submitted: number;
  status: ParticipationStatus;
  statusLabel: string;
  manualEntryId: string | null;
  manualNote: string | null;
  recordedBy: string | null;
  recordedAt: string | null;
};

export type TrainingRegister = Awaited<ReturnType<typeof getTrainingRegister>>;

/**
 * Il registro del workspace, oppure di una sola società quando un corso ne
 * serve più d'una: in quel caso restano solo le persone con l'email di quella
 * società, e l'intestazione porta la sua ragione sociale.
 */
export async function getTrainingRegister(access: Pick<RegisterAccess, "programIds" | "workspace">, options: { domain?: string | null; now?: Date } = {}) {
  const workspaceId = access.workspace.id;
  const now = options.now ?? new Date();
  const domain = options.domain ?? null;

  const [org] = await rows<{ workspaceName: string }>(sql`SELECT name AS "workspaceName" FROM workspaces WHERE id=${workspaceId}::uuid`);
  const [settings] = await rows<{
    organizationLegalName: string | null; registerOwner: string | null; aiSystems: string[]; useContext: string | null;
    trainers: string | null; companyNames: Record<string, string>; aiActRole: keyof typeof AI_ACT_ROLES | null; otherInitiatives: string | null; updatedAt: string | null; updatedBy: string | null;
  }>(sql`SELECT s.organization_legal_name AS "organizationLegalName", s.register_owner AS "registerOwner", s.ai_systems AS "aiSystems", s.ai_act_role AS "aiActRole",
      s.use_context AS "useContext", s.trainers, s.company_names AS "companyNames", s.other_initiatives AS "otherInitiatives", s.updated_at AS "updatedAt",
      COALESCE(u.name,u.email) AS "updatedBy"
    FROM learning_register_settings s LEFT JOIN users u ON u.id=s.updated_by WHERE s.workspace_id=${workspaceId}::uuid`);

  const programs = (await rows<{
    id: string; title: string; contentVersion: string; packHash: string; privatePack: PrivateTrainingPack;
    publishedAt: string; status: string; closedAt: string | null; retentionDays: number;
  }>(sql`SELECT id, title, content_version AS "contentVersion", pack_hash AS "packHash", private_pack AS "privatePack",
      published_at AS "publishedAt", status, closed_at AS "closedAt", retention_days AS "retentionDays"
    FROM learning_programs WHERE workspace_id=${workspaceId}::uuid ORDER BY published_at`)).filter((p) => inScope(access, p.id));

  const sessions = (await rows<{
    programId: string; moduleId: string; cohortId: string; startsAt: string; endsAt: string; status: string; timezone: string;
  }>(sql`SELECT program_id AS "programId", module_id AS "moduleId", cohort_id AS "cohortId", starts_at AS "startsAt",
      ends_at AS "endsAt", status, timezone
    FROM learning_sessions WHERE workspace_id=${workspaceId}::uuid ORDER BY starts_at`)).filter((s) => inScope(access, s.programId));

  const enrolled = (await rows<{
    userId: string; name: string | null; email: string; programId: string; moduleId: string; cohortId: string;
    enrollmentStatus: string; joinedAt: string | null; submittedIds: string[] | null;
  }>(sql`SELECT e.user_id AS "userId", u.name, u.email, e.program_id AS "programId", e.module_id AS "moduleId", e.cohort_id AS "cohortId",
      e.status AS "enrollmentStatus",
      -- Ingresso dal link del turno a cui la persona è iscritta: chi ha
      -- cambiato turno conta dal link del turno attuale.
      (SELECT min(r.created_at) FROM learning_join_redemptions r JOIN learning_join_links l ON l.id=r.link_id
        WHERE r.workspace_id=e.workspace_id AND r.program_id=e.program_id AND r.enrollment_id=e.id
          AND l.module_id=e.module_id AND l.cohort_id=e.cohort_id) AS "joinedAt",
      -- Consegne: dagli eventi (restano anche dopo la cancellazione delle
      -- risposte a fine conservazione) e dai tentativi ancora conservati.
      (SELECT array_agg(DISTINCT x.activity_id) FROM (
          SELECT a.metadata->>'activityId' AS activity_id FROM learning_audit_events a
            WHERE a.workspace_id=e.workspace_id AND a.program_id=e.program_id AND a.actor_id=e.user_id
              AND a.event_type='attempt_submitted' AND a.metadata ? 'activityId'
          UNION
          SELECT t.activity_id FROM learning_attempts t
            WHERE t.workspace_id=e.workspace_id AND t.program_id=e.program_id AND t.enrollment_id=e.id AND t.status='submitted'
        ) x WHERE x.activity_id IS NOT NULL) AS "submittedIds"
    FROM learning_enrollments e JOIN users u ON u.id=e.user_id
    WHERE e.workspace_id=${workspaceId}::uuid ORDER BY lower(COALESCE(u.name,u.email))`)).filter((e) => inScope(access, e.programId));

  const manual = (await rows<{
    id: string; programId: string; moduleId: string; cohortId: string; personName: string; personEmail: string | null; note: string | null;
    recordedAt: string; recordedBy: string; voidedAt: string | null; voidReason: string | null; voidedBy: string | null;
  }>(sql`SELECT m.id, m.program_id AS "programId", m.module_id AS "moduleId", m.cohort_id AS "cohortId", m.person_name AS "personName",
      m.person_email AS "personEmail", m.note, m.recorded_at AS "recordedAt", COALESCE(r.name,r.email) AS "recordedBy",
      m.voided_at AS "voidedAt", m.void_reason AS "voidReason", COALESCE(v.name,v.email) AS "voidedBy"
    FROM learning_register_manual_entries m JOIN users r ON r.id=m.recorded_by LEFT JOIN users v ON v.id=m.voided_by
    WHERE m.workspace_id=${workspaceId}::uuid ORDER BY m.recorded_at`)).filter((m) => inScope(access, m.programId));

  const materials = (await rows<{ programId: string; moduleId: string | null; title: string; fileName: string; sha256: string; audience: string; createdAt: string }>(sql`
    SELECT program_id AS "programId", module_id AS "moduleId", title, file_name AS "fileName", sha256, audience, created_at AS "createdAt"
    FROM learning_materials WHERE workspace_id=${workspaceId}::uuid ORDER BY sort_order, created_at`)).filter((m) => inScope(access, m.programId));

  // Rilevazione dei bisogni: solo quante persone hanno risposto, mai cosa.
  const assessments = await rows<{ name: string; status: string; createdAt: string; completed: number }>(sql`
    SELECT a.name, a.status, a.created_at AS "createdAt",
      (SELECT count(*)::int FROM ai_readiness_respondents r WHERE r.assessment_id=a.id AND r.invite_status='completed') AS completed
    FROM ai_readiness_assessments a WHERE a.workspace_id=${workspaceId}::uuid AND a.status <> 'draft' ORDER BY a.created_at`);

  const programById = new Map(programs.map((program) => [program.id, program]));
  const sessionKey = (p: string, m: string, c: string) => `${p}|${m}|${c}`;
  const sessionByKey = new Map(sessions.map((session) => [sessionKey(session.programId, session.moduleId, session.cohortId), session]));
  const moduleTitle = (programId: string, moduleId: string) =>
    programById.get(programId)?.privatePack.modules.find((m) => m.id === moduleId)?.title ?? moduleId;
  const ended = (session: { status: string; endsAt: string }) => session.status === "closed" || new Date(session.endsAt).getTime() <= now.getTime();

  const participants: RegisterParticipant[] = [];
  for (const row of enrolled) {
    const program = programById.get(row.programId);
    const session = sessionByKey.get(sessionKey(row.programId, row.moduleId, row.cohortId));
    if (!program || !session) continue;
    const timing = joinTiming(row.joinedAt, session.startsAt, session.endsAt);
    const done = participation({ pack: program.privatePack, moduleId: row.moduleId, submittedActivityIds: row.submittedIds ?? [],
      enrollmentStatus: row.enrollmentStatus, joinTiming: timing, sessionHeld: ended(session) });
    participants.push({
      key: `u:${row.userId}:${row.programId}:${row.moduleId}`,
      userId: row.userId, name: row.name || row.email, email: row.email,
      programId: row.programId, programTitle: program.title, moduleId: row.moduleId, moduleTitle: moduleTitle(row.programId, row.moduleId),
      cohortId: row.cohortId, sessionStartsAt: iso(session.startsAt), sessionHeld: ended(session),
      source: "piattaforma", joinedAt: row.joinedAt ? iso(row.joinedAt) : null, joinTiming: timing, joinLabel: joinTimingLabel[timing],
      required: done.required, submitted: done.submitted, status: done.status, statusLabel: participationLabel[done.status],
      manualEntryId: null, manualNote: null, recordedBy: null, recordedAt: null,
    });
  }
  const corrections: typeof manual = [];
  for (const row of manual) {
    if (row.voidedAt) { corrections.push(row); continue; }
    const program = programById.get(row.programId);
    const session = sessionByKey.get(sessionKey(row.programId, row.moduleId, row.cohortId));
    if (!program || !session) continue;
    participants.push({
      key: `m:${row.id}`, userId: null, name: row.personName, email: row.personEmail,
      programId: row.programId, programTitle: program.title, moduleId: row.moduleId, moduleTitle: moduleTitle(row.programId, row.moduleId),
      cohortId: row.cohortId, sessionStartsAt: iso(session.startsAt), sessionHeld: ended(session),
      source: "registrazione_manuale", joinedAt: null, joinTiming: null, joinLabel: "Registrata dal formatore",
      required: 0, submitted: 0, status: "presenza_manuale", statusLabel: participationLabel.presenza_manuale,
      manualEntryId: row.id, manualNote: row.note, recordedBy: row.recordedBy, recordedAt: iso(row.recordedAt),
    });
  }
  const person = (p: RegisterParticipant) => ({ userId: p.userId, email: p.email, name: p.name });
  const companyNames = settings?.companyNames ?? {};
  const companies = companyDomains(participants.filter((p) => p.status !== "iscrizione_sospesa").map(person))
    .map((c) => ({ ...c, legalName: (companyNames[c.domain] as string | undefined) ?? null }));
  const withoutCompany = domain ? participants.filter((p) => !companyDomain(p.email)).length : 0;
  if (domain) {
    for (let i = participants.length - 1; i >= 0; i--) if (companyDomain(participants[i].email) !== domain) participants.splice(i, 1);
    for (let i = corrections.length - 1; i >= 0; i--) if (companyDomain(corrections[i].personEmail) !== domain) corrections.splice(i, 1);
  }
  participants.sort((a, b) => a.sessionStartsAt.localeCompare(b.sessionStartsAt) || a.name.localeCompare(b.name, "it"));

  const sessionRows = sessions.map((session) => {
    const people = participants.filter((p) => p.programId === session.programId && p.moduleId === session.moduleId && p.cohortId === session.cohortId);
    const counted = people.filter((p) => DOCUMENTED.has(p.status));
    const isEnded = ended(session);
    return {
      programId: session.programId,
      programTitle: programById.get(session.programId)?.title ?? "",
      moduleId: session.moduleId,
      moduleTitle: moduleTitle(session.programId, session.moduleId),
      cohortId: session.cohortId,
      startsAt: iso(session.startsAt),
      endsAt: iso(session.endsAt),
      timezone: session.timezone,
      durationMinutes: Math.round((new Date(session.endsAt).getTime() - new Date(session.startsAt).getTime()) / 60_000),
      state: (!isEnded ? "in_programma" : counted.length > 0 ? "svolta" : "senza_partecipanti") as "in_programma" | "svolta" | "senza_partecipanti",
      participants: counted.filter((p) => p.source === "piattaforma").length,
      manualParticipants: counted.filter((p) => p.source === "registrazione_manuale").length,
      allExercises: counted.filter((p) => p.status === "esercitazioni_completate").length,
      undocumented: people.filter((p) => p.status === "partecipazione_non_documentata").length,
      enrolled: people.filter((p) => p.source === "piattaforma" && p.status !== "iscrizione_sospesa").length,
      // Testo dell'art. 4 in vigore il giorno della sessione.
      article4: (new Date(session.startsAt).getTime() < ARTICLE4_AMENDED_FROM ? "originario" : "modificato") as "originario" | "modificato",
    };
  });

  const attended = participants.filter((p) => DOCUMENTED.has(p.status));
  const upcoming = participants.filter((p) => p.status === "sessione_in_programma");
  const held = sessionRows.filter((s) => s.state === "svolta");
  const workspaceName = org?.workspaceName ?? access.workspace.name;
  // Il workspace appartiene all'organizzazione di chi eroga la formazione: il
  // suo nome non è quello dell'azienda formata e non va mai in intestazione.
  const legalName = (domain ? (companyNames[domain] as string | undefined) : settings?.organizationLegalName) ?? null;

  return {
    generatedAt: now.toISOString(),
    organization: {
      name: legalName || (domain ? `${workspaceName} · @${domain}` : workspaceName),
      legalName,
      workspaceLegalName: settings?.organizationLegalName ?? null,
      workspaceName,
      companyNames,
      registerOwner: settings?.registerOwner ?? null,
      aiActRole: settings?.aiActRole ?? null,
      aiSystems: settings?.aiSystems ?? [],
      useContext: settings?.useContext ?? null,
      trainers: settings?.trainers ?? null,
      otherInitiatives: settings?.otherInitiatives ?? null,
      settingsUpdatedAt: settings?.updatedAt ? iso(settings.updatedAt) : null,
      settingsUpdatedBy: settings?.updatedBy ?? null,
    },
    provider: REGISTER_PROVIDER,
    scoped: access.programIds !== null,
    domain,
    companies,
    withoutCompany,
    needsAssessments: assessments.map((a) => ({ name: a.name, status: a.status, completed: a.completed, createdAt: iso(a.createdAt) })),
    programs: programs.map((program) => ({
      id: program.id, title: program.title, contentVersion: program.contentVersion, packHash: program.packHash,
      sourceSnapshotSha: program.privatePack.source_snapshot_sha, publishedAt: iso(program.publishedAt),
      status: program.status, closedAt: program.closedAt ? iso(program.closedAt) : null, retentionDays: program.retentionDays,
      modules: program.privatePack.modules
        .filter((m) => sessions.some((s) => s.programId === program.id && s.moduleId === m.id))
        .map((m) => ({
          id: m.id, title: m.title, subtitle: m.subtitle ?? null, objective: m.objective ?? null, durationMinutes: m.duration_minutes ?? null,
          agenda: (m.agenda ?? []).map((b) => ({ from: b.from_minute, to: b.to_minute, title: b.title })),
          competencies: moduleCompetencies(program.privatePack, m.id),
          exercises: program.privatePack.activities.filter((a) => a.module_id === m.id && a.completion_gate && a.purpose !== "retake").map((a) => a.title),
        })),
      materials: materials.filter((mat) => mat.programId === program.id).map((mat) => ({
        title: mat.title, fileName: mat.fileName, sha256: mat.sha256, audience: mat.audience as "learners" | "trainers", moduleId: mat.moduleId,
        createdAt: iso(mat.createdAt),
      })),
    })),
    sessions: sessionRows,
    participants,
    corrections: corrections.map((c) => ({
      id: c.id, personName: c.personName, personEmail: c.personEmail, moduleTitle: moduleTitle(c.programId, c.moduleId), cohortId: c.cohortId,
      recordedAt: iso(c.recordedAt), recordedBy: c.recordedBy,
      voidedAt: iso(c.voidedAt!), voidedBy: c.voidedBy ?? "", voidReason: c.voidReason ?? "",
    })),
    totals: {
      /** Tutte le persone nel registro, qualunque sia lo stato della loro partecipazione. */
      people: distinctPeople(participants.filter((p) => p.status !== "iscrizione_sospesa").map(person)),
      peopleAttended: distinctPeople(attended.map(person)),
      peopleUpcoming: distinctPeople(upcoming.filter((p) => !attended.some((a) => (a.userId ?? a.email) === (p.userId ?? p.email))).map(person)),
      participations: attended.length,
      allExercises: attended.filter((p) => p.status === "esercitazioni_completate").length,
      manualEntries: attended.filter((p) => p.source === "registrazione_manuale").length,
      undocumented: participants.filter((p) => p.status === "partecipazione_non_documentata").length,
      sessionsHeld: held.length,
      hoursDelivered: Math.round(held.reduce((n, s) => n + s.durationMinutes, 0) / 6) / 10,
      sessionsScheduled: sessionRows.filter((s) => s.state === "in_programma").length,
    },
  };
}

// ─── Dati dell'azienda ─────────────────────────────────────────────────

export const registerSettingsSchema = z.object({
  organizationLegalName: z.string().trim().max(300),
  registerOwner: z.string().trim().max(300),
  aiActRole: z.enum(["deployer", "provider", "both"]).nullable(),
  aiSystems: z.array(z.string().trim().min(1).max(200)).max(30),
  useContext: z.string().trim().max(4000),
  trainers: z.string().trim().max(2000),
  companyNames: z.record(z.string().refine(isValidDomain, "Dominio non valido."), z.string().trim().max(300))
    .refine((names) => Object.keys(names).length <= 20, "Al massimo 20 società."),
  otherInitiatives: z.string().trim().max(4000),
}).strict();

export async function saveRegisterSettings(access: RegisterAccess, input: z.infer<typeof registerSettingsSchema>) {
  if (!access.canEditSettings) throw new LearningError("forbidden", "Solo chi amministra il workspace modifica i dati dell'azienda.");
  const systems = [...new Set(input.aiSystems)];
  const companies = Object.fromEntries(Object.entries(input.companyNames).map(([d, n]) => [d.toLowerCase(), n.trim()]).filter(([, n]) => n));
  await db.execute(sql`INSERT INTO learning_register_settings(workspace_id, organization_legal_name, register_owner, ai_act_role, ai_systems, use_context, trainers, company_names, other_initiatives, updated_by, updated_at)
    VALUES (${access.workspace.id}::uuid, ${input.organizationLegalName || null}, ${input.registerOwner || null}, ${input.aiActRole},
      ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(systems)}::jsonb)),
      ${input.useContext || null}, ${input.trainers || null}, ${JSON.stringify(companies)}::jsonb, ${input.otherInitiatives || null}, ${access.userId}::uuid, now())
    ON CONFLICT (workspace_id) DO UPDATE SET organization_legal_name=EXCLUDED.organization_legal_name, register_owner=EXCLUDED.register_owner, ai_act_role=EXCLUDED.ai_act_role,
      ai_systems=EXCLUDED.ai_systems, use_context=EXCLUDED.use_context, trainers=EXCLUDED.trainers, company_names=EXCLUDED.company_names,
      other_initiatives=EXCLUDED.other_initiatives, updated_by=EXCLUDED.updated_by, updated_at=now()`);
}

// ─── Presenze registrate dal formatore ─────────────────────────────────

export const manualEntrySchema = z.object({
  programId: z.uuid(),
  moduleId: z.string().min(1).max(100),
  cohortId: z.string().min(1).max(100),
  personName: z.string().trim().min(2, "Scrivi nome e cognome.").max(200),
  personEmail: z.union([z.literal(""), z.email("Email non valida.").max(254)]),
  note: z.string().trim().max(1000),
}).strict();

export async function addManualEntry(access: RegisterAccess, input: z.infer<typeof manualEntrySchema>) {
  if (!inScope(access, input.programId)) throw forbidden();
  const w = access.workspace.id;
  const email = input.personEmail.trim().toLowerCase();
  const [result] = await rows<{ outcome: "recorded" | "no_session" | "duplicate" }>(sql`WITH target AS (
      SELECT 1 FROM learning_sessions s WHERE s.workspace_id=${w}::uuid AND s.program_id=${input.programId}::uuid
        AND s.module_id=${input.moduleId} AND s.cohort_id=${input.cohortId}
    ), duplicate AS (
      SELECT 1 WHERE ${email} <> '' AND (
        EXISTS (SELECT 1 FROM learning_register_manual_entries m WHERE m.workspace_id=${w}::uuid AND m.program_id=${input.programId}::uuid
          AND m.module_id=${input.moduleId} AND m.voided_at IS NULL AND lower(m.person_email)=${email})
        OR EXISTS (SELECT 1 FROM learning_enrollments e JOIN users u ON u.id=e.user_id WHERE e.workspace_id=${w}::uuid
          AND e.program_id=${input.programId}::uuid AND e.module_id=${input.moduleId} AND lower(u.email)=${email}))
    ), inserted AS (
      INSERT INTO learning_register_manual_entries(workspace_id, program_id, module_id, cohort_id, person_name, person_email, note, recorded_by)
      SELECT ${w}::uuid, ${input.programId}::uuid, ${input.moduleId}, ${input.cohortId}, ${input.personName}, ${email || null}, ${input.note || null}, ${access.userId}::uuid
      WHERE EXISTS (SELECT 1 FROM target) AND NOT EXISTS (SELECT 1 FROM duplicate)
      RETURNING id
    ) SELECT CASE WHEN EXISTS (SELECT 1 FROM inserted) THEN 'recorded'
      WHEN NOT EXISTS (SELECT 1 FROM target) THEN 'no_session' ELSE 'duplicate' END AS outcome`);
  if (result?.outcome === "no_session") throw new LearningError("invalid", "Turno non trovato in questo workspace.");
  if (result?.outcome === "duplicate") throw new LearningError("conflict", "Questa persona è già nel registro per questo modulo.");
}

export async function voidManualEntry(access: RegisterAccess, entryId: string, reason: string) {
  const [entry] = await rows<{ programId: string }>(sql`SELECT program_id AS "programId" FROM learning_register_manual_entries
    WHERE id=${entryId}::uuid AND workspace_id=${access.workspace.id}::uuid`);
  if (!entry || !inScope(access, entry.programId)) throw new LearningError("conflict", "Presenza non trovata.");
  const changed = await rows<{ id: string }>(sql`UPDATE learning_register_manual_entries SET voided_at=now(), voided_by=${access.userId}::uuid, void_reason=${reason}
    WHERE id=${entryId}::uuid AND workspace_id=${access.workspace.id}::uuid AND voided_at IS NULL RETURNING id`);
  if (!changed.length) throw new LearningError("conflict", "Presenza già annullata.");
}

// ─── Esportazioni ──────────────────────────────────────────────────────

export function sha256Hex(content: Buffer | Uint8Array) {
  return createHash("sha256").update(content).digest("hex");
}

export async function logRegisterExport(access: RegisterAccess, exportId: string, format: "pdf" | "xlsx", content: Buffer, participantCount: number, domain: string | null) {
  const sha = sha256Hex(content);
  await db.execute(sql`INSERT INTO learning_register_exports(id, workspace_id, format, sha256, size_bytes, participant_count, company_domain, generated_by)
    VALUES (${exportId}::uuid, ${access.workspace.id}::uuid, ${format}, ${sha}, ${content.byteLength}, ${participantCount}, ${domain}, ${access.userId}::uuid)`);
  return sha;
}

export async function listRegisterExports(workspaceId: string) {
  return (await rows<{ id: string; format: "pdf" | "xlsx"; sha256: string; sizeBytes: number; participantCount: number; companyDomain: string | null; generatedAt: string; generatedBy: string }>(sql`
    SELECT e.id, e.format, e.sha256, e.size_bytes AS "sizeBytes", e.participant_count AS "participantCount", e.company_domain AS "companyDomain", e.generated_at AS "generatedAt",
      COALESCE(u.name,u.email) AS "generatedBy"
    FROM learning_register_exports e JOIN users u ON u.id=e.generated_by
    WHERE e.workspace_id=${workspaceId}::uuid ORDER BY e.generated_at DESC LIMIT 50`))
    .map((e) => ({ ...e, generatedAt: iso(e.generatedAt) }));
}

/** Un file mostrato a un ispettore è autentico se la sua impronta è in questo elenco. */
export async function findRegisterExport(workspaceId: string, sha: string) {
  if (!/^[0-9a-f]{64}$/.test(sha)) return null;
  const [row] = await rows<{ id: string; format: "pdf" | "xlsx"; generatedAt: string; generatedBy: string; participantCount: number; companyDomain: string | null }>(sql`
    SELECT e.id, e.format, e.generated_at AS "generatedAt", COALESCE(u.name,u.email) AS "generatedBy", e.participant_count AS "participantCount", e.company_domain AS "companyDomain"
    FROM learning_register_exports e JOIN users u ON u.id=e.generated_by
    WHERE e.workspace_id=${workspaceId}::uuid AND e.sha256=${sha} ORDER BY e.generated_at LIMIT 1`);
  return row ? { ...row, generatedAt: iso(row.generatedAt) } : null;
}
