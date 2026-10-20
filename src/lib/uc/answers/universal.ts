/**
 * Azioni universali (PIANO §3.9), sempre disponibili su ogni voce:
 * - `non_so {who_might_know?}`: «Non lo so» è una risposta valida, non un errore;
 * - `delega {nome, email, messaggio?, voci[]}`: email valida, voci ⊆ voci attive
 *   della richiesta;
 * - `proposta_na {reason}`: motivo di almeno 10 caratteri.
 *
 * Modulo puro.
 */
import type { Json } from "../types.ts";
import { emailDomain } from "../lateral-space.ts";
import { issue, type Issue } from "./issues.ts";
import { cleanMultiline } from "./simple.ts";
import { cleanText, isPlainObject, nonEmptyString } from "./strings.ts";

export type UniversalAction = "non_so" | "delega" | "proposta_na";

export const NA_REASON_MIN_LENGTH = 10;

export type UniversalResult = { ok: true; value: Json } | { ok: false; errors: Issue[] };

function done(value: Json, errors: Issue[]): UniversalResult {
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}

/** Email in minuscolo se valida, altrimenti null. */
export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const email = cleanText(input).toLowerCase();
  if (email.length > 254 || !/^[^\s@"<>(),;:]+@[^\s@]+$/.test(email)) return null;
  return emailDomain(email) === null ? null : email;
}

/** «Non lo so», con chi potrebbe saperlo (facoltativo). */
export function normalizeNonSo(raw: unknown): UniversalResult {
  const who = isPlainObject(raw) ? nonEmptyString(raw.who_might_know) : null;
  const errors: Issue[] = [];
  if (who !== null && who.length > 300) errors.push(issue("testo_troppo_lungo", "Al massimo 300 caratteri.", "who_might_know"));
  return done(who === null ? {} : { who_might_know: who }, errors);
}

/** Delega a un collega: nuovo link solo per quelle voci. */
export function normalizeDelega(raw: unknown, ctx: { activeItemIds: readonly string[] }): UniversalResult {
  if (!isPlainObject(raw)) return { ok: false, errors: [issue("delega_mancante", "Indica nome ed email del collega.", "nome")] };
  const errors: Issue[] = [];
  const nome = nonEmptyString(raw.nome);
  const email = normalizeEmail(raw.email);
  const messaggio = typeof raw.messaggio === "string" && cleanText(raw.messaggio) !== "" ? cleanMultiline(raw.messaggio) : null;
  if (nome === null) errors.push(issue("nome_mancante", "Scrivi il nome del collega.", "nome"));
  else if (nome.length > 120) errors.push(issue("nome_troppo_lungo", "Il nome è troppo lungo.", "nome"));
  if (email === null) errors.push(issue("email_non_valida", "Scrivi un'email valida.", "email"));
  if (messaggio !== null && messaggio.length > 1000) {
    errors.push(issue("messaggio_troppo_lungo", "Il messaggio può avere al massimo 1.000 caratteri.", "messaggio"));
  }
  const active = new Set(ctx.activeItemIds);
  const voci: string[] = [];
  const list = Array.isArray(raw.voci) ? raw.voci : [];
  list.forEach((v, index) => {
    if (typeof v !== "string" || !active.has(v)) {
      errors.push(issue("voce_non_delegabile", "Puoi delegare solo le domande ancora aperte di questo link.", `voci[${index}]`));
    } else if (!voci.includes(v)) voci.push(v);
  });
  if (voci.length === 0 && errors.every((e) => !e.field?.startsWith("voci"))) {
    errors.push(issue("voci_mancanti", "Scegli almeno una domanda da delegare.", "voci"));
  }
  const value: Record<string, Json> = { nome, email, voci };
  if (messaggio !== null) value.messaggio = messaggio;
  return done(value, errors);
}

/** «Non si applica», con il motivo. */
export function normalizePropostaNa(raw: unknown): UniversalResult {
  const input = isPlainObject(raw) ? raw.reason : raw;
  const reason = typeof input === "string" ? cleanMultiline(input) : "";
  const errors: Issue[] = [];
  if ([...reason].length < NA_REASON_MIN_LENGTH) {
    errors.push(issue("motivo_troppo_corto", `Spiega perché non si applica (almeno ${NA_REASON_MIN_LENGTH} caratteri).`, "reason"));
  } else if (reason.length > 2000) {
    errors.push(issue("motivo_troppo_lungo", "Il motivo può avere al massimo 2.000 caratteri.", "reason"));
  }
  return done({ reason }, errors);
}

/** Smista un'azione universale. */
export function normalizeUniversalAction(action: UniversalAction, raw: unknown, ctx: { activeItemIds: readonly string[] }): UniversalResult {
  switch (action) {
    case "non_so":
      return normalizeNonSo(raw);
    case "delega":
      return normalizeDelega(raw, ctx);
    case "proposta_na":
      return normalizePropostaNa(raw);
  }
}
