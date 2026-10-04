import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { learningRequestOrigin, LearningHttpError, LEARNING_REQUEST_MAX_BYTES } from "@/lib/learning/http";
import {
  addManualEntry,
  findRegisterExport,
  getTrainingRegister,
  logRegisterExport,
  manualEntrySchema,
  registerSettingsSchema,
  requireRegisterAccess,
  saveRegisterSettings,
  voidManualEntry,
} from "@/lib/learning/register";
import { registerFileName, registerPdf, registerXlsx } from "@/lib/learning/register-export";
import { contentDisposition } from "@/lib/learning/material-access";
import { LearningError } from "@/lib/learning/server";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const statuses: Record<string, number> = { unauthenticated: 401, forbidden: 403, invalid: 422, conflict: 409, closed: 409, unavailable: 503, technical: 503 };

const scope = { workspaceId: z.uuid(), expectedUserId: z.uuid() };
const request = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("export"), ...scope, format: z.enum(["pdf", "xlsx"]), domain: z.string().max(253).nullable().optional() }).strict(),
  z.object({ operation: z.literal("saveSettings"), ...scope, settings: registerSettingsSchema }).strict(),
  z.object({ operation: z.literal("addManualEntry"), ...scope, entry: manualEntrySchema }).strict(),
  z.object({ operation: z.literal("voidManualEntry"), ...scope, entryId: z.uuid(), reason: z.string().trim().min(3, "Scrivi il motivo (almeno 3 caratteri).").max(500) }).strict(),
  z.object({ operation: z.literal("verify"), ...scope, sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict(),
]);

function fail(status: number, code: string, message: string) {
  return Response.json({ ok: false, code, message }, { status, headers });
}

const MIME = { pdf: "application/pdf", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } as const;

/**
 * Registro della formazione IA. Tutto in POST: l'esportazione lascia una
 * traccia (codice e impronta) e non deve partire da un prefetch; le altre
 * operazioni scrivono. Stesse difese delle rotte del formatore: origine della
 * richiesta, identità della scheda, permesso sul registro.
 */
export async function POST(nextRequest: NextRequest) {
  try {
    const origin = learningRequestOrigin(nextRequest, nextRequest.nextUrl.protocol);
    if (nextRequest.headers.get("origin") !== origin) throw new LearningHttpError(403, "Origine della richiesta non autorizzata.");
    if (nextRequest.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new LearningHttpError(415, "La richiesta deve contenere JSON.");
    const body = await nextRequest.text();
    if (body.length > LEARNING_REQUEST_MAX_BYTES) throw new LearningHttpError(413, "La richiesta supera il limite consentito.");
    let parsed: z.infer<typeof request>;
    try { parsed = request.parse(JSON.parse(body)); }
    catch (error) {
      const issue = error instanceof z.ZodError ? error.issues[0] : null;
      const human = issue && !/^(Invalid|Expected|Unrecognized)/.test(issue.message) ? issue.message : "Dati della richiesta non validi.";
      return fail(422, "invalid", human);
    }

    const access = await requireRegisterAccess(parsed.workspaceId);
    if (access.userId !== parsed.expectedUserId) return fail(409, "conflict", "Questa scheda appartiene a un altro accesso. Ricarica la pagina.");

    switch (parsed.operation) {
      case "export": {
        const domain = parsed.domain?.trim().toLowerCase() || null;
        if (domain && !(await getTrainingRegister(access)).companies.some((c) => c.domain === domain)) {
          return fail(422, "invalid", "Nessun partecipante di questa società nel registro.");
        }
        const register = await getTrainingRegister(access, { domain });
        const exportId = randomUUID();
        const generatedBy = await generatedByName(access.userId);
        const meta = { exportId, generatedBy };
        const file = parsed.format === "pdf" ? registerPdf(register, meta) : registerXlsx(register, meta);
        const participants = register.participants.filter((p) => p.status !== "iscrizione_sospesa").length;
        const sha256 = await logRegisterExport(access, exportId, parsed.format, file, participants, domain);
        return new Response(new Uint8Array(file), {
          headers: {
            ...headers,
            "Content-Type": MIME[parsed.format],
            "Content-Length": String(file.byteLength),
            "Content-Disposition": contentDisposition(registerFileName(register, parsed.format)),
            "X-Register-Export-Id": exportId,
            "X-Register-Sha256": sha256,
            "Cache-Control": "private, no-store",
          },
        });
      }
      case "saveSettings":
        await saveRegisterSettings(access, parsed.settings);
        return Response.json({ ok: true, message: "Dati dell'azienda salvati. Compaiono nelle prossime esportazioni." }, { headers });
      case "addManualEntry":
        await addManualEntry(access, parsed.entry);
        return Response.json({ ok: true, message: `Presenza di ${parsed.entry.personName.trim()} registrata.` }, { headers });
      case "voidManualEntry":
        await voidManualEntry(access, parsed.entryId, parsed.reason);
        return Response.json({ ok: true, message: "Presenza annullata. Resta visibile fra le correzioni." }, { headers });
      case "verify": {
        const match = await findRegisterExport(access.workspace.id, parsed.sha256);
        return Response.json({ ok: true, match }, { headers });
      }
    }
  } catch (error) {
    if (error instanceof LearningHttpError) return fail(error.status, "invalid", error.message);
    if (error instanceof LearningError) return fail(statuses[error.code] ?? 400, error.code, error.message);
    console.error("[learning-register] operazione non riuscita", error);
    return fail(503, "technical", "Operazione non riuscita. Riprova fra poco.");
  }
}

async function generatedByName(userId: string) {
  const { rows } = await db.execute(sql`SELECT COALESCE(NULLIF(name,''), email) AS name, email FROM users WHERE id=${userId}::uuid`);
  const row = rows[0] as { name: string; email: string } | undefined;
  return row ? (row.name === row.email ? row.email : `${row.name} (${row.email})`) : userId;
}
