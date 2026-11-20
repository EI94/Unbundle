"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { logSafeError } from "@/lib/log/safe-error";
import { boardAbilities } from "@/lib/mappatura/abilities";
import { UNIT_NAME_MAX, UNIT_TEXT } from "@/lib/mappatura/text";
import { addUnit } from "@/lib/mappatura/units";
import { MAPPING_LIMITS } from "@/lib/mappatura/vocab";
import { getCollaboratorAccess } from "@/lib/workspace-access";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AddUnitResult = { ok: true; value: { departmentId: string } } | { ok: false; message: string; field?: "name" };

/** Il nome come si salva: una riga, senza spazi doppi né caratteri di controllo. */
function cleanUnitName(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim() : "";
}

/**
 * «Aggiungi un'unità» (rilascio 10, docs/ui-10/PROPOSTA-10.md §3.7, F-160): un'unità nuova del workspace, con il solo
 * nome. Prima le unità nascevano solo dalla chat dell'Intervista iniziale (`createDepartment`), aperta a ogni
 * collaboratore: qui la stessa regola, quella della board (`boardAbilities(role).edit`: ogni collaboratore, mai chi
 * segue solo un corso). Il nome si ricontrolla sul server: vuoto, troppo lungo o uguale a quello di un'altra unità del
 * workspace (senza badare alle maiuscole) non passa; un workspace con `MAPPING_LIMITS.units` unità è pieno. Il controllo
 * del nome e l'aggiunta stanno in una transazione con il lucchetto del workspace (`addUnit`). Nessun modello, nessuna
 * e-mail. Poi la pagina porta alla board dell'unità, dove l'assistente si apre da sé (un'unità senza passi).
 */
export async function addUnitAction(workspaceId: string, rawName: string): Promise<AddUnitResult> {
  const session = await auth();
  if (!session?.user?.id || typeof workspaceId !== "string" || !UUID.test(workspaceId)) return { ok: false, message: UNIT_TEXT.denied };
  const access = await getCollaboratorAccess(session.user.id, workspaceId);
  if (!access || !boardAbilities(access.role).edit) return { ok: false, message: UNIT_TEXT.denied };
  const name = cleanUnitName(rawName);
  if (!name) return { ok: false, message: UNIT_TEXT.nameMissing, field: "name" };
  if (name.length > UNIT_NAME_MAX) return { ok: false, message: UNIT_TEXT.nameTooLong(UNIT_NAME_MAX), field: "name" };
  try {
    const added = await addUnit(await getAppUcExecutor(), workspaceId, name);
    if (!added.ok) return { ok: false, message: added.reason === "duplicate" ? UNIT_TEXT.duplicate : UNIT_TEXT.full(MAPPING_LIMITS.units), field: "name" };
    revalidatePath(`/dashboard/${workspaceId}/contesto`, "layout");
    revalidatePath(`/dashboard/${workspaceId}/mapping`, "layout");
    return { ok: true, value: { departmentId: added.departmentId } };
  } catch (error) {
    logSafeError("mappatura/unita", "unita_non_aggiunta", error, { workspaceId });
    return { ok: false, message: UNIT_TEXT.failed };
  }
}
