"use server";

import type { Session } from "@/lib/auth";
import { requireWorkspaceAccess } from "@/lib/auth/require-workspace";
import {
  anonymizeContact,
  approveDelegation,
  assignItems,
  copyRequestLink,
  createContact,
  extendExpiry,
  previewRequests,
  requestApproval,
  requestConfirmation,
  revokeAllLinks,
  revokeRequest,
  sendRequest,
  sendRequests,
  updateContact,
  type AssignmentResult,
  type CopiedLink,
  type RequestPreviewGroup,
  type SendResult,
  type UpdatedContact,
} from "@/lib/db/queries/uc-requests";
import { assignRoleQuestions, reassignContactQuestions, type BulkAssignmentResult } from "@/lib/db/queries/uc-people-view";
import type { Result } from "@/lib/uc/types";
import { EMAIL_NOT_CONFIGURED_TEXT, assignOutcomeText, sendOutcomeText } from "@/lib/uc/views/people";
import type { CaseRole, RequestChannel } from "@/lib/uc/vocab";
import type { WorkspaceAccess } from "@/lib/workspace-access";
import { finishUcCommand, fromResult, openUcCase, type OpenedUcCase, type UcActionResult } from "./uc-action-context";

/**
 * Server action su referenti, assegnazioni e richieste (PIANO §5.3,
 * `uc-people.ts`; DESIGN §3.9). Ognuna chiama per prima
 * `requireWorkspaceAccess(workspaceId)`, poi i ruoli di caso (`openUcCase`),
 * poi il comando, che rivalida l'input con zod e ricalcola i permessi con le
 * funzioni pure. Nessuna azione restituisce valori delle risposte; solo «Copia
 * link» restituisce un link, una volta. I messaggi parlano di domande, mai di
 * chiavi o voci: li leggono anche le persone del cliente.
 */

const LS_LEAD: readonly CaseRole[] = ["ls_lead"];
const LS_LEAD_OR_OWNER: readonly CaseRole[] = ["ls_lead", "owner_cliente"];

/** Le email partono davvero solo con Resend e il mittente configurati; altrimenti restano in coda e il link si copia. */
function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.UC_EMAIL_FROM?.trim());
}

const EMAIL_NOT_CONFIGURED = EMAIL_NOT_CONFIGURED_TEXT;

async function onCase<T>(
  guard: { session: Session; access: WorkspaceAccess },
  workspaceId: string,
  caseId: string,
  allow: readonly CaseRole[],
  command: (o: OpenedUcCase) => Promise<Result<T>>,
  options: { write?: boolean; message?: (value: T) => string | undefined } = {},
): Promise<UcActionResult<T>> {
  const opened = await openUcCase({ ...guard, workspaceId, caseId, allow, write: options.write });
  if (!opened.ok) return opened.result;
  const result = await command(opened.value);
  if (result.ok && options.write !== false) finishUcCommand({ workspaceId, caseId });
  return fromResult(result, undefined, result.ok ? options.message?.(result.value) : undefined);
}

/**
 * «Inviate 2 richieste.», oppure «Link pronti: copiali dalle righe di
 * Persone.» quando le email non partono (DESIGN §3.9.2). In un invio misto il
 * testo chiede di copiare solo i link di chi non ha l'email.
 */
function sendMessage(result: { requests: { channel: RequestChannel; items: number }[]; skippedTotal: number }): string {
  return sendOutcomeText({
    requests: result.requests.length,
    manual: result.requests.filter((r) => r.channel === "link_manuale").length,
    emailConfigured: emailConfigured(),
    skipped: result.skippedTotal,
  });
}

/** L'esito di un'assegnazione in parole di esito, mai i comandi di Lateral Space: lo legge anche il responsabile del cliente. */
const assignMessage = assignOutcomeText;

// ── Referenti ─────────────────────────────────────────────────────────

/** Aggiunge un referente del cliente: nome, ruolo ed email bastano; il telefono serve solo per WhatsApp. */
export async function createContactAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ contactId: string }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, LS_LEAD_OR_OWNER, (o) => createContact(o.executor, o.ctx, input), {
    message: () => "Referente aggiunto.",
  });
}

/** Modifica un referente; un'email cambiata revoca i link già mandati. */
export async function updateContactAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<UpdatedContact>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, LS_LEAD, (o) => updateContact(o.executor, o.ctx, input), {
    message: (v) => (v.linksRevoked ? "Referente aggiornato. I link già mandati non valgono più: reinvia la richiesta." : "Referente aggiornato."),
  });
}

/** Anonimizza un referente: resta solo l'etichetta del ruolo. */
export async function anonymizeContactAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ contactId: string }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, LS_LEAD, (o) => anonymizeContact(o.executor, o.ctx, input), {
    message: () => "Referente anonimizzato.",
  });
}

// ── Assegnazione ──────────────────────────────────────────────────────

/** Assegna le domande: una per una, in blocco per ruolo o con il referente proposto dal ruolo. */
export async function assignItemsAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<AssignmentResult>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, LS_LEAD_OR_OWNER, (o) => assignItems(o.executor, o.ctx, input), {
    message: assignMessage,
  });
}

/**
 * «Senza referente › Assegna» e il passo 1 di «Invia le domande»: le domande
 * aperte di un ruolo vanno a un referente, in un colpo solo (DESIGN §3.9.2).
 */
export async function assignRoleQuestionsAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<BulkAssignmentResult>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, LS_LEAD_OR_OWNER, (o) => assignRoleQuestions(o.executor, o.ctx, input), {
    message: assignMessage,
  });
}

/** «Affida le sue domande a un altro collega» (DESIGN §3.9.3): le domande aperte di un referente passano a un collega. */
export async function reassignContactQuestionsAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<BulkAssignmentResult>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, LS_LEAD_OR_OWNER, (o) => reassignContactQuestions(o.executor, o.ctx, input), {
    message: assignMessage,
  });
}

// ── Richieste ─────────────────────────────────────────────────────────

/** Anteprima di «Invia le domande»: domande e tempo stimato per ogni referente. Nessuna scrittura. */
export async function previewRequestsAction(
  workspaceId: string,
  caseId: string,
  input: unknown,
): Promise<UcActionResult<{ groups: RequestPreviewGroup[]; notRequestable: number; emailConfigured: boolean }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase(
    { session, access },
    workspaceId,
    caseId,
    LS_LEAD,
    async (o) => {
      const r = await previewRequests(o.executor, o.ctx, input);
      return r.ok ? { ok: true as const, value: { ...r.value, emailConfigured: emailConfigured() } } : r;
    },
    { write: false },
  );
}

/** Invia una bozza: le domande partono. */
export async function sendRequestAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<SendResult>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, LS_LEAD, (o) => sendRequest(o.executor, o.ctx, input), { message: sendMessage });
}

/** «Invia»: una richiesta per ogni referente con le sue domande da inviare. */
export async function sendRequestsAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<SendResult>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, LS_LEAD, (o) => sendRequests(o.executor, o.ctx, input), { message: sendMessage });
}

/** «Chiedi conferma»: le domande in verifica tornano a chi ha il dato. */
export async function requestConfirmationAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<SendResult>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, LS_LEAD, (o) => requestConfirmation(o.executor, o.ctx, input), { message: sendMessage });
}

/** «Copia link»: un link nuovo, mostrato una volta. Mai per i link di approvazione. */
export async function copyRequestLinkAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<CopiedLink>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, LS_LEAD, (o) => copyRequestLink(o.executor, o.ctx, input), {
    message: (v) => (v.sent ? "Richiesta inviata. Copia il link e mandalo tu: si vede solo adesso." : "Link nuovo pronto: copialo adesso, poi non si vede più."),
  });
}

/** Revoca un link: le domande ancora senza risposta tornano da inviare. */
export async function revokeRequestAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ requestId: string; released: number; reopened: number }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, LS_LEAD, (o) => revokeRequest(o.executor, o.ctx, input), {
    message: () => "Link revocato.",
  });
}

/** «Revoca tutti i link del caso in un colpo solo», compresi i token MCP del caso. */
export async function revokeAllLinksAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ shareEpoch: number; requests: number; reopened: number }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, LS_LEAD, (o) => revokeAllLinks(o.executor, o.ctx, input), {
    message: (v) => (v.requests === 1 ? "1 link revocato." : `${v.requests} link revocati.`),
  });
}

/** Approva una delega a un collega con un dominio nuovo: parte il link per il collega. */
export async function approveDelegationAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ requestId: string; items: number; channel: RequestChannel }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, LS_LEAD, (o) => approveDelegation(o.executor, o.ctx, input), {
    message: (v) => (v.channel === "email" && emailConfigured() ? "Delega approvata: il collega riceve il link per email." : `Delega approvata. ${EMAIL_NOT_CONFIGURED}`),
  });
}

/** «Cambia la scadenza»: al massimo 30 giorni da oggi. */
export async function extendExpiryAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ requestId: string; expiresAt: string; clamped: boolean }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, LS_LEAD, (o) => extendExpiry(o.executor, o.ctx, input), {
    message: (v) => (v.clamped ? "Scadenza spostata al massimo consentito: 30 giorni da oggi." : "Scadenza aggiornata."),
  });
}

/** «Chiedi la firma»: link di approvazione per email al firmatario designato. Non si mostra mai. */
export async function requestApprovalAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ requestId: string; created: boolean }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  return onCase({ session, access }, workspaceId, caseId, LS_LEAD, (o) => requestApproval(o.executor, o.ctx, input, { emailConfigured: emailConfigured() }), {
    message: () => "Link di approvazione in partenza per email al firmatario.",
  });
}
