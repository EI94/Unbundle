import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getWorkspaceAccessForUser } from "@/lib/workspace-access";
import { LearningError, learningEnabled } from "./server";
import { materialAccess, type MaterialAccess, type MaterialViewer } from "./material-access";

/**
 * Materiali del corso. L'accesso è deciso da materialAccess (puro e testato):
 * la pagina e la rotta di download chiedono la stessa cosa alla stessa funzione,
 * così ciò che la pagina mostra come scaricabile è esattamente ciò che la rotta
 * concede.
 */

const BOOTSTRAP_ROLES = ["exec_sponsor", "transformation_lead"];
export const MATERIAL_MAX_BYTES = 4_000_000;

type MaterialRow = {
  id: string;
  workspaceId: string;
  programId: string;
  moduleId: string | null;
  title: string;
  description: string | null;
  kind: string;
  audience: string;
  downloadBefore: boolean;
  availableAfterSession: boolean;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sortOrder: number;
};

export type LearnerMaterial = Omit<MaterialRow, "workspaceId" | "programId" | "audience"> & {
  forTrainers: boolean;
  access: Exclude<MaterialAccess, { visible: false }>;
  href: string;
};

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute(query)).rows as T[];
}

const materialColumns = sql`m.id, m.workspace_id AS "workspaceId", m.program_id AS "programId", m.module_id AS "moduleId",
  m.title, m.description, m.kind, m.audience, m.download_before AS "downloadBefore",
  m.available_after_session AS "availableAfterSession", m.file_name AS "fileName", m.mime_type AS "mimeType",
  m.size_bytes AS "sizeBytes", m.sort_order AS "sortOrder"`;

/** Ciò che serve a decidere l'accesso, per una persona e un corso. */
async function viewerFor(userId: string, workspaceId: string, programId: string): Promise<MaterialViewer | null> {
  const access = await getWorkspaceAccessForUser(userId, workspaceId);
  if (!access) return null;
  const [state] = await rows<{
    featureEnabled: boolean | null;
    grants: number;
    endsAt: string | null;
    sessionStatus: string | null;
    enrolled: boolean;
  }>(sql`SELECT
      (SELECT p.feature_enabled FROM learning_programs p WHERE p.workspace_id=${workspaceId}::uuid AND p.id=${programId}::uuid) AS "featureEnabled",
      (SELECT count(*)::int FROM learning_grants g WHERE g.workspace_id=${workspaceId}::uuid AND g.program_id=${programId}::uuid
         AND g.user_id=${userId}::uuid AND g.revoked_at IS NULL) AS grants,
      e.id IS NOT NULL AS enrolled, s.ends_at AS "endsAt", s.status AS "sessionStatus"
    FROM (SELECT 1) one
    LEFT JOIN learning_enrollments e ON e.workspace_id=${workspaceId}::uuid AND e.program_id=${programId}::uuid
      AND e.user_id=${userId}::uuid AND e.module_id='m1' AND e.status='active'
    LEFT JOIN learning_sessions s ON s.workspace_id=e.workspace_id AND s.program_id=e.program_id
      AND s.module_id=e.module_id AND s.cohort_id=e.cohort_id`);
  if (!state || state.featureEnabled === null) return null;
  return {
    trainer: BOOTSTRAP_ROLES.includes(access.role) || state.grants > 0,
    enrolled: state.enrolled,
    featureEnabled: state.featureEnabled,
    session: state.endsAt ? { endsAt: state.endsAt, status: state.sessionStatus ?? "scheduled" } : null,
  };
}

/** Materiali visibili a questa persona, con il motivo di ogni blocco. */
export async function listProgramMaterials(userId: string, workspaceId: string, programId: string): Promise<LearnerMaterial[]> {
  const viewer = await viewerFor(userId, workspaceId, programId);
  if (!viewer) return [];
  const materials = await rows<MaterialRow>(sql`SELECT ${materialColumns} FROM learning_materials m
    WHERE m.workspace_id=${workspaceId}::uuid AND m.program_id=${programId}::uuid ORDER BY m.sort_order, m.created_at`);
  const now = Date.now();
  return materials.flatMap((material) => {
    const access = materialAccess(material, viewer, now);
    if (!access.visible) return [];
    const { workspaceId: _w, programId: _p, audience, ...rest } = material;
    void _w; void _p;
    return [{ ...rest, forTrainers: audience !== "learners", access, href: `/api/learning/materials/${material.id}` }];
  });
}

/** Il file, solo se questa persona lo può scaricare adesso. */
export async function readMaterialForDownload(materialId: string, userId: string) {
  if (!learningEnabled()) throw new LearningError("unavailable", "La formazione non è disponibile.");
  const [material] = await rows<MaterialRow & { content: string }>(sql`SELECT ${materialColumns}, encode(m.content,'base64') AS content
    FROM learning_materials m WHERE m.id=${materialId}::uuid`);
  if (!material) throw new LearningError("forbidden", "Materiale non disponibile.");
  const viewer = await viewerFor(userId, material.workspaceId, material.programId);
  const access = viewer ? materialAccess(material, viewer, Date.now()) : { visible: false as const };
  // Non distinguere "non esiste" da "non è per te": si risponde allo stesso modo.
  if (!access.visible) throw new LearningError("forbidden", "Materiale non disponibile.");
  if (!access.downloadable) throw new LearningError("closed", access.reason);
  return {
    fileName: material.fileName,
    mimeType: material.mimeType,
    content: Buffer.from(material.content, "base64"),
  };
}

export async function recordMaterialDownload(materialId: string, userId: string) {
  await db.execute(sql`INSERT INTO learning_material_downloads(material_id, user_id) VALUES (${materialId}::uuid, ${userId}::uuid)
    ON CONFLICT (material_id, user_id) DO UPDATE SET last_downloaded_at=now(),
      download_count=learning_material_downloads.download_count+1`);
}

export type NewMaterial = {
  workspaceId: string;
  programId: string;
  moduleId: string | null;
  title: string;
  description: string | null;
  kind: "exercise_files" | "slides" | "document";
  audience: "learners" | "trainers";
  downloadBefore: boolean;
  availableAfterSession: boolean;
  fileName: string;
  mimeType: string;
  content: Buffer;
  sortOrder: number;
  createdBy: string;
};

/** Inserimento. Chi chiama deve aver già verificato il permesso di gestione. */
export async function insertMaterial(material: NewMaterial) {
  if (material.content.byteLength === 0 || material.content.byteLength > MATERIAL_MAX_BYTES) {
    throw new LearningError("invalid", "Il file deve pesare fra 1 byte e 4 MB.");
  }
  const id = randomUUID();
  const sha256 = createHash("sha256").update(material.content).digest("hex");
  await db.execute(sql`INSERT INTO learning_materials(id, workspace_id, program_id, module_id, title, description, kind, audience,
      download_before, available_after_session, file_name, mime_type, size_bytes, sha256, content, sort_order, created_by)
    VALUES (${id}::uuid, ${material.workspaceId}::uuid, ${material.programId}::uuid, ${material.moduleId}, ${material.title},
      ${material.description}, ${material.kind}, ${material.audience}, ${material.downloadBefore}, ${material.availableAfterSession},
      ${material.fileName}, ${material.mimeType}, ${material.content.byteLength}, ${sha256},
      decode(${material.content.toString("base64")}, 'base64'), ${material.sortOrder}, ${material.createdBy}::uuid)`);
  return { id, sha256 };
}

/** Riepilogo per la console del formatore: quante persone hanno scaricato cosa. */
export async function listMaterialsForTrainer(workspaceId: string, programId: string) {
  return rows<MaterialRow & { downloads: number; enrolled: number }>(sql`SELECT ${materialColumns},
      (SELECT count(*)::int FROM learning_material_downloads d WHERE d.material_id=m.id) AS downloads,
      (SELECT count(*)::int FROM learning_enrollments e WHERE e.workspace_id=m.workspace_id AND e.program_id=m.program_id AND e.status='active') AS enrolled
    FROM learning_materials m WHERE m.workspace_id=${workspaceId}::uuid AND m.program_id=${programId}::uuid ORDER BY m.sort_order, m.created_at`);
}

export async function deleteMaterial(workspaceId: string, programId: string, materialId: string) {
  const { rows: deleted } = await db.execute(sql`DELETE FROM learning_materials
    WHERE id=${materialId}::uuid AND workspace_id=${workspaceId}::uuid AND program_id=${programId}::uuid RETURNING id`);
  return deleted.length > 0;
}
