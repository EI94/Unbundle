/**
 * Il controllo dei testi di «Chiedi al referente» (SPEC §2.1 `text.ts`), con la scansione dei
 * dossier (`scanText`, contesto «risposta»): dati sanitari e discriminatori bloccano sempre; nomi e
 * cognomi, email, telefoni, date di nascita e codici fiscali bloccano all'invio.
 *
 * - **Bozza** del referente: si rifiutano solo dati sanitari e discriminatori; il resto torna come
 *   avviso, perché una bozza si corregge prima di inviarla.
 * - **Invio** del referente: si rifiuta ogni risultato bloccante; il campo dell'avviso è la domanda.
 * - **Messaggio** e **titoli delle domande** del revisore: arrivano al referente (il messaggio anche
 *   nell'email), quindi stesso contesto delle risposte: l'email o il telefono di un'altra persona
 *   si rifiuta con `testo_contatto`.
 * - **Risposta del team** dalla scheda: lo stesso controllo dell'invio.
 *
 * Gli avvisi portano solo il codice e il messaggio, mai il testo trovato. Modulo puro.
 */
import { issue, type Issue } from "../../uc/answers/issues.ts";
import { HARD_BLOCK_CATEGORIES, findingMessage, scanText, type Finding } from "../../uc/text/scan.ts";
import { REFERENT_LIMITS } from "./contract.ts";
import { REFERENT_ERROR_MESSAGES } from "./labels.ts";

const OPTS = { context: "risposta" } as const;

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

/** Bozza: si rifiutano solo i dati sanitari e discriminatori; il resto sono avvisi. */
export function checkDraftText(text: string): { ok: true; warnings: Issue[] } | { ok: false; issues: Issue[] } {
  const scan = scanText(text, OPTS);
  const hard = scan.blocking.filter((f) => HARD_BLOCK_CATEGORIES.includes(f.category));
  if (hard.length > 0) return { ok: false, issues: issuesOf(hard) };
  return { ok: true, warnings: issuesOf([...scan.blocking, ...scan.warnings]) };
}

/** Invio: ogni risultato bloccante è un avviso sul campo `field` (l'id dell'esigenza). */
export function checkSubmitText(text: string, field: string): { ok: true } | { ok: false; issues: Issue[] } {
  const scan = scanText(text, OPTS);
  if (scan.blocking.length === 0) return { ok: true };
  const hard = scan.blocking.filter((f) => HARD_BLOCK_CATEGORIES.includes(f.category));
  return { ok: false, issues: issuesOf(hard.length ? [...hard, ...scan.blocking] : scan.blocking, field) };
}

function firstBlocking(text: string): { code: string; message: string } | null {
  const scan = scanText(text, OPTS);
  const hard = scan.blocking.find((f) => HARD_BLOCK_CATEGORIES.includes(f.category));
  const first = hard ?? scan.blocking[0];
  return first ? { code: `testo_${first.category}`, message: findingMessage(first.category) } : null;
}

/** Il messaggio facoltativo del revisore: vuoto vale null, al massimo 1.000 caratteri, niente nomi, email o telefoni. */
export function checkRequestMessage(text: string | null): { ok: true; value: string | null } | { ok: false; code: string; message: string } {
  if (text === null || text === undefined) return { ok: true, value: null };
  if (typeof text !== "string") return { ok: false, code: "dati_non_validi", message: REFERENT_ERROR_MESSAGES.riprova };
  const clean = text.replace(/\r\n?/g, "\n").trim();
  if (!clean) return { ok: true, value: null };
  if (clean.length > REFERENT_LIMITS.messageMax) return { ok: false, code: "messaggio_troppo_lungo", message: REFERENT_ERROR_MESSAGES.messaggio_troppo_lungo };
  const blocked = firstBlocking(clean);
  return blocked ? { ok: false, ...blocked } : { ok: true, value: clean };
}

/** Il titolo di una domanda, come lo vede il referente. */
export function checkQuestionTitle(title: string): { ok: true } | { ok: false; code: string; message: string } {
  const blocked = firstBlocking(title);
  return blocked ? { ok: false, ...blocked } : { ok: true };
}

/** La risposta del team dalla scheda: da 1 a 4.000 caratteri, senza dati personali o sanitari. */
export function checkReviewerAnswer(text: string): { ok: true; value: string } | { ok: false; code: string; message: string } {
  const clean = typeof text === "string" ? text.replace(/\r\n?/g, "\n").trim() : "";
  if (!clean) return { ok: false, code: "risposta_vuota", message: REFERENT_ERROR_MESSAGES.risposta_vuota };
  if (clean.length > REFERENT_LIMITS.answerMax) return { ok: false, code: "testo_troppo_lungo", message: REFERENT_ERROR_MESSAGES.testo_troppo_lungo };
  const blocked = firstBlocking(clean);
  return blocked ? { ok: false, ...blocked } : { ok: true, value: clean };
}
