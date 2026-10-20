/**
 * Testi fissi delle firme (DESIGN §4.5, §3.11): un solo posto per il link di
 * approvazione (`/r`) e per la pagina `/firme`, così si cambiano in un commit
 * (domanda 2 di §9.2). Titoli e righe di ogni decisione li scrive il server
 * (`views/approvals.ts`); qui ci sono l'elenco, i pulsanti, la riga sull'altra
 * firma e l'esito.
 *
 * Modulo puro e senza dipendenze di Node: lo importano i componenti del
 * browser e i test (`views/approvals.test.ts` lo passa a `copy-guard`).
 */
import type { ApprovalView } from "@/lib/uc/public-view";
import type { ApprovalStep, SignerSide } from "@/lib/uc/views/approvals";
import { CLIENT_CASE_ROLES, LS_CASE_ROLES, type CaseRole } from "../../../lib/uc/vocab.ts";

export type ApprovalDecision = "approvo" | "non_approvo";

/**
 * Misure di chi legge. Il cliente legge a 16 px con il primario a 48 px
 * (§4.5 A2, §4.7), sul link e su `/firme`: A1 e A2 sono identici. Lateral Space
 * ha le misure dell'app.
 */
export type ApprovalVariant = "cliente" | "ls";

/** Le misure di `/firme` per i ruoli di chi guarda: del cliente solo senza ruoli di Lateral Space. */
export function approvalVariantFor(roles: readonly CaseRole[]): ApprovalVariant {
  const has = (list: readonly CaseRole[]) => roles.some((r) => list.includes(r));
  return has(CLIENT_CASE_ROLES) && !has(LS_CASE_ROLES) ? "cliente" : "ls";
}

/**
 * Una firma del link come passo dell'elenco: se i testi di §4.5 mancano (una
 * risposta dell'API di prima), valgono quelli del link. Il lato è il cliente.
 */
export function asApprovalStep(a: ApprovalView | ApprovalStep): ApprovalStep {
  const s = a as ApprovalView & Partial<ApprovalStep>;
  return {
    ...a,
    side: s.side ?? "cliente",
    otherSideSigned: s.otherSideSigned ?? !a.waitingForLs,
    summary: s.summary ?? "",
    intro: s.intro ?? null,
    details: s.details ?? [],
    itemId: s.itemId ?? null,
    subject: s.subject ?? null,
    technical: s.technical ?? [],
  };
}

/** Chiave stabile di una decisione (tipo e oggetto). */
export function approvalKey(a: Pick<ApprovalView, "kind" | "targetId">): string {
  return `${a.kind}:${a.targetId.toLowerCase()}`;
}

/** Le due righe sopra l'elenco (A1). */
export function listIntro(count: number): { lead: string; calm: string } {
  return count === 1
    ? { lead: "Ci serve la tua firma su una decisione.", calm: "Leggila con calma: finché non firmi, resta ferma." }
    : { lead: `Ci servono le tue firme su ${count} decisioni.`, calm: "Leggile con calma: finché non firmi, restano ferme." };
}

export function startLabel(count: number): string {
  return count > 1 ? "Inizia dalla prima" : "Inizia";
}

/** «1 di 3». */
export function stepCounter(index: number, total: number): string {
  return `${index + 1} di ${total}`;
}

/** Titolo della scheda a ogni passo (§4.7): «Firma 1 di 3 · Via allo sviluppo · Unbundle». */
export function approvalDocumentTitle(index: number, total: number, title: string): string {
  return `Firma ${stepCounter(index, total)} · ${title} · Unbundle`;
}

/** «Avanti · 2 di 3» (`index` è il passo che si apre, da 0). */
export function nextLabel(index: number, total: number): string {
  return `Avanti · ${index + 1} di ${total}`;
}

/**
 * Rifiuti dopo i quali la pagina va riletta, come fa il link (`referente-page.tsx`):
 * il testo è cambiato o la decisione non aspetta più chi guarda. Il passo
 * aperto prende così il testo di adesso, e la decisione presa altrove esce
 * dall'elenco.
 */
export function approvalNeedsReload(code: string): boolean {
  return code === "testo_cambiato" || code === "approvazione_non_trovata";
}

export const APPROVAL_TEXT = {
  listLabel: "Firme in attesa",
  backToList: "Tutte le firme",
  approve: "Ho letto e approvo",
  reject: "Non approvo",
  rejectReason: "Perché non approvi?",
  rejectHint: "Almeno 3 caratteri. Lo legge chi ha fatto la proposta.",
  reasonTooShort: "Scrivi perché non approvi: almeno 3 caratteri.",
  confirmReject: "Confermo: non approvo",
  cancel: "Annulla",
  details: "Dettagli",
  allSigned: "Hai firmato tutto. Grazie!",
  allDecided: "Hai deciso su tutto. Grazie!",
  backToListAction: "Torna all'elenco",
  emptyLink: "Non ci sono firme in attesa. Ti scriviamo quando servirà la tua.",
  emptyApp: "Non ci sono firme in attesa.",
  failed: "Non riesco a registrarlo. Riprova tra poco.",
} as const;

/** Al posto di «Non approvo» quando la decisione non si respinge (§4.5). */
export function notRejectableText(side: SignerSide): string {
  return side === "cliente"
    ? "Se non sei d'accordo, non firmare e rispondi all'email di Lateral Space: senza la tua firma resta tutto fermo."
    : "Se non sei d'accordo, non firmare: senza la tua firma resta tutto fermo.";
}

/** La riga sull'altra firma, sotto il testo (A2). */
export function otherSideText(a: Pick<ApprovalStep, "kind" | "side" | "otherSideSigned">): string {
  if (a.kind === "zona_personale") return "L'ha proposto Lateral Space: con la tua firma l'accesso si attiva.";
  if (a.side === "cliente") return a.otherSideSigned ? "Lateral Space ha già firmato: manca solo la tua." : "Serve anche la firma di Lateral Space.";
  return a.otherSideSigned ? "Il cliente ha già firmato: manca solo la tua." : "Serve anche la firma del cliente.";
}

/** L'esito dopo la scelta (`role=status`). */
export function outcomeText(i: { side: SignerSide; decision: ApprovalDecision; complete: boolean; waitingForEvidence?: boolean }): string {
  if (i.decision === "non_approvo") return i.side === "cliente" ? "Non approvata. Lateral Space legge il tuo motivo." : "Non approvata: la proposta è respinta.";
  if (i.waitingForEvidence) return i.side === "cliente" ? "Firmato. Ora Lateral Space allega la prova scritta." : "Firmato. Ora manca la prova scritta: allegala in Via allo sviluppo.";
  if (i.complete) return "Firmato. Con la tua firma la decisione è completa.";
  return i.side === "cliente" ? "Firmato. Ora manca la firma di Lateral Space." : "Firmato. Ora manca la firma del cliente.";
}

/** Il «completa» che la pagina del link scrive quando l'API risponde `complete: true`. */
const LINK_COMPLETE_MESSAGE = outcomeText({ side: "cliente", decision: "approvo", complete: true });

/**
 * L'esito di una decisione presa sul link (`/r`), con le stesse frasi di
 * `/firme`, per «Ho letto e approvo» e per «Non approvo».
 *
 * - `complete`: quello dell'API se la pagina del link lo passa; altrimenti lo
 *   dice il suo messaggio di «completa».
 * - La via firmata dal cliente dopo Lateral Space che resta incompleta aspetta
 *   solo la prova scritta (`signGate`: `waitingFor: 'prova_scritta'`), non la
 *   firma di Lateral Space.
 */
export function linkOutcomeText(
  approval: Pick<ApprovalStep, "kind" | "side" | "otherSideSigned">,
  decision: ApprovalDecision,
  outcome: { message: string; complete?: boolean; waitingForEvidence?: boolean },
): string {
  if (decision === "non_approvo") return outcomeText({ side: approval.side, decision, complete: true });
  const complete = outcome.complete ?? outcome.message === LINK_COMPLETE_MESSAGE;
  const waitingForEvidence = outcome.waitingForEvidence ?? (!complete && approval.kind === "gate" && approval.otherSideSigned);
  return outcomeText({ side: approval.side, decision, complete, waitingForEvidence });
}
