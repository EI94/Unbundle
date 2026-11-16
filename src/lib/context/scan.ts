/**
 * Il controllo dei testi di «Contesto» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §3.4.2), con le regole
 * dei dossier (`src/lib/uc/text/scan.ts`, contesto `testo_ls`):
 *
 * - **un appunto** (`scanNote`) lo fermano solo i dati sanitari e discriminatori. I nomi restano: l'appunto lo vede
 *   solo Lateral Space;
 * - **un testo che può uscire da Lateral Space** (`scanPersonalData`: un fatto, un impegno, una domanda, una riga di
 *   «In breve», un messaggio della chat che entra nella memoria della chat) lo fermano anche nome e cognome, titolo e
 *   cognome, data di nascita, codice fiscale, e-mail e telefono. Un nome proprio da solo resta un avviso e non ferma;
 * - **un fatto, un impegno, una domanda** (`scanStatement`): come sopra, e in più oltre 200 caratteri `lungo`.
 *
 * Un esito porta la categoria e un messaggio in italiano semplice, mai il dato trovato: si può registrare nei log.
 * Modulo puro.
 */
import { findingMessage, hasHardBlock, scanText, type Finding, type ScanCategory } from "../uc/text/scan.ts";
import { CONTEXT_TEXT } from "./text.ts";
import { CONTEXT_LIMITS, type ProposalIssue } from "./vocab.ts";

export type NoteScan = { ok: true } | { ok: false; category: "sanitario" | "discriminatorio"; term: string; message: string };

/** Un appunto: fermano il salvataggio solo i dati sanitari e discriminatori (`hasHardBlock`). I nomi restano: l'appunto è solo di Lateral Space. */
export function scanNote(text: string): NoteScan {
  const { blocking } = scanText(text, { context: "testo_ls" });
  if (!hasHardBlock(blocking)) return { ok: true };
  const found = blocking.find((f) => f.category === "sanitario") ?? blocking.find((f) => f.category === "discriminatorio");
  if (!found) return { ok: true };
  return found.category === "sanitario"
    ? { ok: false, category: "sanitario", term: found.term, message: CONTEXT_TEXT.add.blockedHealth(found.term) }
    : { ok: false, category: "discriminatorio", term: found.term, message: CONTEXT_TEXT.add.blockedDiscrimination(found.term) };
}

export type StatementIssue = ProposalIssue | "sanitario" | "discriminatorio";
export type StatementScan = { ok: true } | { ok: false; issue: StatementIssue; message: string };

/** Prima ciò che non entra mai, poi i dati di una persona nell'ordine in cui si correggono. */
const ISSUE_ORDER: readonly ScanCategory[] = ["sanitario", "discriminatorio", "nome_persona", "data_nascita", "codice_fiscale", "contatto"];

function firstIssue(findings: readonly Finding[]): ScanCategory | null {
  for (const category of ISSUE_ORDER) if (findings.some((f) => f.category === category)) return category;
  return null;
}

/**
 * Un testo che può uscire da Lateral Space: oltre a sanitario e discriminatorio fermano nome e cognome, titolo e
 * cognome, data di nascita, codice fiscale, e-mail e telefono. Nessun limite di lunghezza.
 */
export function scanPersonalData(text: string): StatementScan {
  const { blocking, warnings } = scanText(text, { context: "testo_ls" });
  // In `testo_ls` e-mail e telefono sono un avviso: qui fermano. Un nome proprio da solo resta un avviso.
  const category = firstIssue([...blocking, ...warnings.filter((f) => f.category === "contatto")]);
  if (!category) return { ok: true };
  return { ok: false, issue: category, message: findingMessage(category) };
}

/** Un fatto, un impegno, una domanda: `scanPersonalData`, e in più oltre 200 caratteri `lungo`. */
export function scanStatement(text: string): StatementScan {
  const personal = scanPersonalData(text);
  if (!personal.ok) return personal;
  if (text.trim().length > CONTEXT_LIMITS.statementMax) return { ok: false, issue: "lungo", message: CONTEXT_TEXT.confirm.tooLong };
  return { ok: true };
}

/** Il messaggio di un `issue` salvato su una proposta (`context_proposals.issue`). */
export function issueMessage(issue: ProposalIssue): string {
  return issue === "lungo" ? CONTEXT_TEXT.confirm.tooLong : findingMessage(issue);
}

/** Vero se l'esito ferma del tutto il testo (dati sanitari o discriminatori): non resta nemmeno come proposta da correggere. */
export function isHardIssue(issue: StatementIssue): issue is "sanitario" | "discriminatorio" {
  return issue === "sanitario" || issue === "discriminatorio";
}
