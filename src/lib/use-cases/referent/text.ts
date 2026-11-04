/**
 * Il controllo dei testi di «Chiedi al referente» (SPEC §2.1 `text.ts`), con la scansione dei
 * dossier (`scanText`, contesto «risposta»).
 *
 * - **Referente** (rilascio 5.1, decisione del titolare del 04/11/2026: «basta che lo diciamo prima
 *   nelle informative»): nomi, email e telefoni non bloccano più e non danno avvisi. Dati sanitari e
 *   discriminatori si rifiutano sempre (anche nella bozza); codici fiscali e date di nascita sono un
 *   avviso nella bozza e si rifiutano all'invio. Vale per le risposte, la nota di «Correggi» e i
 *   commenti del passo «L'impatto».
 * - **Messaggio** del revisore al referente (anche nell'email) e **risposta del team** dalla scheda
 *   (rilascio 5.1, decisione del titolare del 04/11/2026): le stesse regole del referente, senza bozza.
 *   Nomi, email e telefoni di altre persone passano; dati sanitari, discriminatori, codici fiscali e date
 *   di nascita si rifiutano (prima i sanitari e i discriminatori).
 * - **Titoli delle domande** (e i nomi delle voci che il referente legge): l'email o il telefono di
 *   un'altra persona si rifiuta ancora con `testo_contatto`, un nome con `testo_nome_persona`.
 *
 * Gli avvisi portano solo il codice e il messaggio, mai il testo trovato. Modulo puro.
 */
import { issue, type Issue } from "../../uc/answers/issues.ts";
import { HARD_BLOCK_CATEGORIES, findingMessage, scanText, type Finding, type ScanCategory } from "../../uc/text/scan.ts";
import { REFERENT_LIMITS } from "./contract.ts";
import { REFERENT_ERROR_MESSAGES } from "./labels.ts";

const OPTS = { context: "risposta" } as const;

/**
 * (Rilascio 5.1) Le categorie che contano per un testo del referente: nomi di persone, email e
 * telefoni (`nome_persona`, `contatto`) restano fuori.
 */
export const REFERENT_TEXT_CATEGORIES: readonly ScanCategory[] = ["sanitario", "discriminatorio", "codice_fiscale", "data_nascita"];

const forReferent = (findings: readonly Finding[]) => findings.filter((f) => REFERENT_TEXT_CATEGORIES.includes(f.category));

function issuesOf(findings: readonly Finding[], field?: string): Issue[] {
  const seen = new Set<string>();
  const out: Issue[] = [];
  for (const f of findings) {
    const code = `testo_${f.category}`;
    if (seen.has(code)) continue;
    seen.add(code);
    out.push(issue(code, findingMessage(f.category), field));
  }
  return out;
}

/** Bozza del referente: si rifiutano solo i dati sanitari e discriminatori; codici fiscali e date di nascita sono avvisi; nomi, email e telefoni niente. */
export function checkDraftText(text: string): { ok: true; warnings: Issue[] } | { ok: false; issues: Issue[] } {
  const scan = scanText(text, OPTS);
  const hard = scan.blocking.filter((f) => HARD_BLOCK_CATEGORIES.includes(f.category));
  if (hard.length > 0) return { ok: false, issues: issuesOf(hard) };
  return { ok: true, warnings: issuesOf(forReferent([...scan.blocking, ...scan.warnings])) };
}

/** Invio del referente: dati sanitari, discriminatori, codici fiscali e date di nascita sono un avviso sul campo `field`; nomi, email e telefoni passano. */
export function checkSubmitText(text: string, field: string): { ok: true } | { ok: false; issues: Issue[] } {
  const blocking = forReferent(scanText(text, OPTS).blocking);
  if (blocking.length === 0) return { ok: true };
  const hard = blocking.filter((f) => HARD_BLOCK_CATEGORIES.includes(f.category));
  return { ok: false, issues: issuesOf(hard.length ? [...hard, ...blocking] : blocking, field) };
}

/** (Rilascio 5.1) Un testo del team per il referente o sulla scheda: il primo dato che il referente non potrebbe scrivere, oppure null. */
function firstTeamBlocking(text: string): { code: string; message: string } | null {
  const blocking = forReferent(scanText(text, OPTS).blocking);
  const first = blocking.find((f) => HARD_BLOCK_CATEGORIES.includes(f.category)) ?? blocking[0];
  return first ? { code: `testo_${first.category}`, message: findingMessage(first.category) } : null;
}

function firstBlocking(text: string): { code: string; message: string } | null {
  const scan = scanText(text, OPTS);
  const hard = scan.blocking.find((f) => HARD_BLOCK_CATEGORIES.includes(f.category));
  const first = hard ?? scan.blocking[0];
  return first ? { code: `testo_${first.category}`, message: findingMessage(first.category) } : null;
}

/** Il messaggio facoltativo del revisore: vuoto vale null, al massimo 1.000 caratteri; nomi, email e telefoni passano, il resto come per il referente. */
export function checkRequestMessage(text: string | null): { ok: true; value: string | null } | { ok: false; code: string; message: string } {
  if (text === null || text === undefined) return { ok: true, value: null };
  if (typeof text !== "string") return { ok: false, code: "dati_non_validi", message: REFERENT_ERROR_MESSAGES.riprova };
  const clean = text.replace(/\r\n?/g, "\n").trim();
  if (!clean) return { ok: true, value: null };
  if (clean.length > REFERENT_LIMITS.messageMax) return { ok: false, code: "messaggio_troppo_lungo", message: REFERENT_ERROR_MESSAGES.messaggio_troppo_lungo };
  const blocked = firstTeamBlocking(clean);
  return blocked ? { ok: false, ...blocked } : { ok: true, value: clean };
}

/** Il titolo di una domanda, come lo vede il referente. */
export function checkQuestionTitle(title: string): { ok: true } | { ok: false; code: string; message: string } {
  const blocked = firstBlocking(title);
  return blocked ? { ok: false, ...blocked } : { ok: true };
}

/** La risposta del team dalla scheda: da 1 a 4.000 caratteri; nomi, email e telefoni passano, il resto come per il referente. */
export function checkReviewerAnswer(text: string): { ok: true; value: string } | { ok: false; code: string; message: string } {
  const clean = typeof text === "string" ? text.replace(/\r\n?/g, "\n").trim() : "";
  if (!clean) return { ok: false, code: "risposta_vuota", message: REFERENT_ERROR_MESSAGES.risposta_vuota };
  if (clean.length > REFERENT_LIMITS.answerMax) return { ok: false, code: "testo_troppo_lungo", message: REFERENT_ERROR_MESSAGES.testo_troppo_lungo };
  const blocked = firstTeamBlocking(clean);
  return blocked ? { ok: false, ...blocked } : { ok: true, value: clean };
}
