"use server";

import type { Session } from "@/lib/auth";
import { requireWorkspaceAccess } from "@/lib/auth/require-workspace";
import {
  addCaseMember,
  proposePersonalZoneAccess,
  removeCaseMember,
  revokePersonalZoneAccess,
  setCaseSigner,
  signPersonalZoneAccess,
  transitionCase,
  updateCaseRoi,
} from "@/lib/db/queries/uc-cases";
import { updateCaseSettings } from "@/lib/db/queries/uc-people-view";
import type { Result } from "@/lib/uc/types";
import type { CaseRole, CaseStatus } from "@/lib/uc/vocab";
import type { WorkspaceAccess } from "@/lib/workspace-access";
import { finishUcCommand, fromResult, openUcCase, type OpenedUcCase, type UcActionResult } from "./uc-action-context";

/**
 * Server action sui casi d'uso (PIANO §5.3, `uc-cases.ts`). Ognuna chiama per
 * prima `requireWorkspaceAccess(workspaceId)`, poi i ruoli di caso
 * (`openUcCase`), poi il comando, che rivalida l'input con zod e ricalcola i
 * permessi con le funzioni pure. Le azioni restituiscono solo ciò che serve
 * all'interfaccia.
 */

async function onCase<T>(
  guard: { session: Session; access: WorkspaceAccess },
  workspaceId: string,
  caseId: string,
  allow: readonly CaseRole[] | undefined,
  command: (o: OpenedUcCase) => Promise<Result<T>>,
  message?: (value: T) => string | undefined,
): Promise<UcActionResult<T>> {
  const opened = await openUcCase({ ...guard, workspaceId, caseId, allow });
  if (!opened.ok) return opened.result;
  const result = await command(opened.value);
  if (result.ok) finishUcCommand({ workspaceId, caseId });
  return fromResult(result, undefined, result.ok ? message?.(result.value) : undefined);
}

/**
 * Impostazioni › «Il caso» e «Perimetro e leve» (DESIGN §3.13.3, solo il
 * responsabile Lateral Space): nome, frase, perimetro e leve. Il codice non si
 * cambia: è quello dello use case.
 */
export async function updateCaseSettingsAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ fields: string[] }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, ["ls_lead"], (o) => updateCaseSettings(o.executor, o.ctx, input), (v) =>
    v.fields.length > 0 ? "Impostazioni salvate." : "Nessuna modifica da salvare.",
  );
}

/** Cambio di stato del caso (solo quelli ammessi; il motivo dove serve). */
export async function transitionCaseAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ status: CaseStatus }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, ["ls_lead", "owner_cliente"], (o) => transitionCase(o.executor, o.ctx, input));
}

/** Aggiunge un ruolo di caso a un collaboratore del workspace. */
export async function addMemberAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ userId: string; role: CaseRole }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, ["ls_lead"], (o) => addCaseMember(o.executor, o.ctx, input));
}

/** Toglie un ruolo di caso (mai l'ultimo Responsabile del caso). */
export async function removeMemberAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ userId: string; role: CaseRole }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, ["ls_lead"], (o) => removeCaseMember(o.executor, o.ctx, input));
}

/** Proposta di accesso alla zona personale (dopo la scheda A.8). */
export async function proposePersonalZoneAccessAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ userId: string }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, ["ls_lead"], (o) => proposePersonalZoneAccess(o.executor, o.ctx, input));
}

/** Firma dell'approvatore privacy sull'accesso alla zona personale. */
export async function signPersonalZoneAccessAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ userId: string; active: boolean }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, ["approvatore_privacy"], (o) => signPersonalZoneAccess(o.executor, o.ctx, input));
}

/** Revoca immediata dell'accesso alla zona personale. */
export async function revokePersonalZoneAccessAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ userId: string; revoked: boolean }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, undefined, (o) => revokePersonalZoneAccess(o.executor, o.ctx, input));
}

/** Designa l'Owner del cliente come firmatario dal link (con la prova scritta). */
export async function setOwnerContactAction(
  workspaceId: string,
  caseId: string,
  input: { contactId: string | null; evidenceFileId?: string | null },
): Promise<UcActionResult<{ designation: "owner" | "privacy"; contactId: string | null }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, ["ls_lead", "owner_cliente"], (o) =>
    setCaseSigner(o.executor, o.ctx, { ...(input && typeof input === "object" ? input : {}), designation: "owner" }),
  );
}

/** Designa l'approvatore privacy del cliente come firmatario dal link (con la prova scritta). */
export async function setPrivacyApproverContactAction(
  workspaceId: string,
  caseId: string,
  input: { contactId: string | null; evidenceFileId?: string | null },
): Promise<UcActionResult<{ designation: "owner" | "privacy"; contactId: string | null }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, ["ls_lead", "owner_cliente"], (o) =>
    setCaseSigner(o.executor, o.ctx, { ...(input && typeof input === "object" ? input : {}), designation: "privacy" }),
  );
}

/** Righe di costo e beneficio del ROI in stima. */
export async function updateRoiAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ version: number }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, ["ls_lead"], (o) => updateCaseRoi(o.executor, o.ctx, input));
}
