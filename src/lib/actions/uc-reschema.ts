"use server";

import { requireWorkspaceAccess } from "@/lib/auth/require-workspace";
import { reschemaCase } from "@/lib/db/queries/uc-reschema";
import { SCHEMA_CHANGE_TEXT as T } from "@/lib/uc/views/case-settings";
import { finishUcCommand, openUcCase, ucFailure, type UcActionResult } from "./uc-action-context";
import { UUID } from "@/lib/uc/ids";

/**
 * Impostazioni › «Cambia schema di partenza» (R3 di `docs/dossier/SCHEMA-DI-PARTENZA.md`): chi modifica le
 * impostazioni oggi (il responsabile Lateral Space, come `updateCaseSettingsAction`), solo in «Bozza». Il comando
 * (`reschemaCase`) controlla di nuovo stato e domande che bloccano, rifà domande, regole, mappa ed entità e scrive la
 * riga di storico; lo stesso schema di adesso non cambia nulla e non invalida niente.
 */

/** Dal modulo arriva l'id di uno schema visibile, oppure «Dal caso d'uso». */
function targetOf(input: unknown): { templateId: string } | "dal_caso" | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const v = input as Record<string, unknown>;
  if (v.to === "dal_caso") return "dal_caso";
  if (typeof v.templateId === "string" && UUID.test(v.templateId)) return { templateId: v.templateId.toLowerCase() };
  return null;
}

export async function changeStartingSchemaAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ changed: boolean }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  const to = targetOf(input);
  if (!to) return ucFailure("dati_non_validi", T.invalid);
  const opened = await openUcCase({ session, access, workspaceId, caseId, allow: ["ls_lead"] });
  if (!opened.ok) return opened.result;
  const result = await reschemaCase(opened.value.executor, { workspaceId, caseId, actorUserId: opened.value.caseAccess.user.userId, to });
  if (!result.ok) return ucFailure(result.code, T.failures[result.code] ?? result.message);
  if (!result.value.changed) return { ok: true, data: { changed: false }, message: T.unchanged };
  finishUcCommand({ workspaceId, caseId });
  return { ok: true, data: { changed: true }, message: T.changed(result.value.plan.to.name) };
}
