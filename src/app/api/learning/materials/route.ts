import type { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { learningRequestOrigin, LearningHttpError } from "@/lib/learning/http";
import { requireFullProgramManager } from "@/lib/learning/admin";
import { insertMaterial, MATERIAL_MAX_BYTES } from "@/lib/learning/materials";
import { LearningError } from "@/lib/learning/server";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const statuses: Record<string, number> = { unauthenticated: 401, forbidden: 403, invalid: 422, conflict: 409, closed: 409, unavailable: 503, technical: 503 };

const fields = z.object({
  workspaceId: z.uuid(),
  programId: z.uuid(),
  expectedUserId: z.uuid(),
  moduleId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/).nullable(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable(),
  kind: z.enum(["exercise_files", "slides", "document"]),
  audience: z.enum(["learners", "trainers"]),
  downloadBefore: z.boolean(),
  availableAfterSession: z.boolean(),
}).strict();

const ALLOWED_TYPES: Record<string, string> = {
  zip: "application/zip",
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
  md: "text/markdown",
};

function fail(status: number, code: string, message: string) {
  return Response.json({ ok: false, code, message }, { status, headers });
}

/**
 * Caricamento di un materiale dalla console del formatore. Multipart, perché
 * un file fino a 4 MB non sta nell'involucro JSON delle operazioni admin.
 * Stesse difese: origine della richiesta, identità della scheda, permesso di
 * gestione sull'intero corso.
 */
export async function POST(request: NextRequest) {
  try {
    const origin = learningRequestOrigin(request, request.nextUrl.protocol);
    if (request.headers.get("origin") !== origin) throw new LearningHttpError(403, "Origine della richiesta non autorizzata.");
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > MATERIAL_MAX_BYTES + 200_000) return fail(413, "invalid", "Il file supera i 4 MB.");

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return fail(422, "invalid", "Scegli un file da caricare.");
    if (file.size > MATERIAL_MAX_BYTES) return fail(413, "invalid", "Il file supera i 4 MB.");
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    const mimeType = ALLOWED_TYPES[extension];
    if (!mimeType) return fail(422, "invalid", "Formato non supportato. Usa ZIP, PDF, PPTX, DOCX, XLSX, CSV, TXT o MD.");

    const parsed = fields.safeParse({
      workspaceId: form.get("workspaceId"),
      programId: form.get("programId"),
      expectedUserId: form.get("expectedUserId"),
      moduleId: (form.get("moduleId") as string) || null,
      title: form.get("title"),
      description: ((form.get("description") as string) ?? "").trim() || null,
      kind: form.get("kind"),
      audience: form.get("audience"),
      downloadBefore: form.get("downloadBefore") === "true",
      availableAfterSession: form.get("availableAfterSession") === "true",
    });
    if (!parsed.success) return fail(422, "invalid", "Controlla titolo, tipo e destinatari del materiale.");
    const input = parsed.data;

    const ctx = await requireFullProgramManager(input.workspaceId, input.programId, input.expectedUserId);
    const content = Buffer.from(await file.arrayBuffer());
    const [{ next }] = (await db.execute(sql`SELECT COALESCE(max(sort_order),0)+10 AS next FROM learning_materials
      WHERE workspace_id=${ctx.workspaceId}::uuid AND program_id=${ctx.programId}::uuid`)).rows as { next: number }[];
    const { id } = await insertMaterial({
      workspaceId: ctx.workspaceId,
      programId: ctx.programId,
      moduleId: input.moduleId,
      title: input.title,
      description: input.description,
      kind: input.kind,
      audience: input.audience,
      downloadBefore: input.downloadBefore,
      availableAfterSession: input.availableAfterSession,
      fileName: file.name,
      mimeType,
      content,
      sortOrder: Number(next),
      createdBy: ctx.userId,
    });
    await db.execute(sql`INSERT INTO learning_audit_events(workspace_id,program_id,actor_id,resource_id,event_type,metadata)
      VALUES (${ctx.workspaceId}::uuid,${ctx.programId}::uuid,${ctx.userId}::uuid,${id}::uuid,'material_uploaded',
        jsonb_build_object('fileName',${file.name}::text,'audience',${input.audience}::text))`);
    return Response.json({ ok: true, data: { materialId: id, message: "Materiale caricato." } }, { status: 200, headers });
  } catch (error) {
    if (error instanceof LearningHttpError) return fail(error.status, error.status === 403 ? "forbidden" : "invalid", error.message);
    if (error instanceof LearningError) return fail(statuses[error.code] ?? 503, error.code, error.message);
    console.error("[learning-materials] upload non riuscito", error);
    return fail(503, "technical", "Caricamento non confermato. Riprova fra poco.");
  }
}
