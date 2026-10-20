/**
 * Dati personali nei testi liberi (PIANO §3.10): nomi di persona, date di
 * nascita, codici fiscali, email e telefoni. Usato dalla scansione (`scan.ts`)
 * e dalla redazione (`redact.ts`).
 *
 * Nomi:
 * - nome dell'elenco generico (maiuscola iniziale) seguito da una parola con la
 *   maiuscola («Mario Rossi», «Anna De Luca», «Luca ROSSI»), oppure cognome tutto
 *   maiuscolo prima del nome («ROSSI Mario») → nome e cognome;
 * - titolo seguito da una parola con la maiuscola («sig. Rossi», «dott.ssa
 *   Bianchi», «comandante Verdi») → titolo e cognome;
 * - nome dell'elenco da solo → solo un avviso;
 * - nomi del file privato (seed) → sempre.
 * Non sono persone: i luoghi e le vie («via Giuseppe Verdi», «Santa Maria»), gli
 * aeroporti e le figure storiche («Marco Polo»), le aziende («Marina Militare»).
 *
 * Modulo puro.
 */
import { FIRST_NAMES, HONORIFICS, NOT_SURNAMES, PLACE_PREFIXES, PUBLIC_NAME_PAIRS } from "./first-names.ts";
import { foldSameLength, isAllCaps, isTitleCase, onlySpacesBetween, rawWord, wordIndexAt, type PreparedText } from "./words.ts";

export interface Span {
  start: number;
  end: number;
}

// ── Email, telefono, codice fiscale ──────────────────────────────────────

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const PHONE_INTL = /(?<![\w+.,'’])(?:\+|00(?=[1-9]))\d{1,3}(?:[ .\-/]?\(?\d+\)?){2,6}(?![\w]|[.,]\d)/g;
const PHONE_MOBILE = /(?<![\w.,])3\d{2}(?:[ .\-/]?\d{3}[ .\-/]?\d{3,4}|\d{6,7}|[ .\-/]\d{6,7})(?![\w]|[.,]\d)/g;
const PHONE_LANDLINE = /(?<![\w.,])0\d{1,3}[ .\-/]?\d{5,8}(?![\w]|[.,]\d)/g;
const TAX_CODE =
  /(?<![A-Za-z0-9])[A-Za-z]{6}[0-9LMNPQRSTUVlmnpqrstuv]{2}[ABCDEHLMPRSTabcdehlmprst][0-9LMNPQRSTUVlmnpqrstuv]{2}[A-Za-z][0-9LMNPQRSTUVlmnpqrstuv]{3}[A-Za-z](?![A-Za-z0-9])/g;

function spans(text: string, pattern: RegExp, keep: (match: string) => boolean = () => true): Span[] {
  const out: Span[] = [];
  for (const m of text.matchAll(pattern)) {
    if (keep(m[0])) out.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  return out;
}

const digitCount = (s: string) => (s.match(/\d/g) ?? []).length;

export function findEmails(text: string): Span[] {
  return spans(text, EMAIL);
}

/**
 * Telefoni: internazionali (+39…, 0039…), cellulari italiani (3xx…, 9-10 cifre) e
 * fissi (0x…). «350 000 000» a gruppi di tre è un numero, non un cellulare.
 */
export function findPhones(text: string): Span[] {
  const found = [
    ...spans(text, PHONE_INTL, (m) => {
      const d = digitCount(m);
      return d >= 8 && d <= 17;
    }),
    ...spans(text, PHONE_MOBILE, (m) => {
      const d = digitCount(m);
      return d >= 9 && d <= 10 && !/^\d{3}[ .']\d{3}[ .']\d{3}$/.test(m);
    }),
    ...spans(text, PHONE_LANDLINE, (m) => digitCount(m) >= 6),
  ];
  return mergeSpans(found);
}

/** Codici fiscali italiani (anche con omocodia), con almeno 4 cifre. */
export function findTaxCodes(text: string): Span[] {
  return spans(text, TAX_CODE, (m) => digitCount(m) >= 4);
}

/** Unisce gli intervalli che si sovrappongono, in ordine. */
export function mergeSpans(list: readonly Span[]): Span[] {
  const sorted = [...list].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start < last.end) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

// ── Date di nascita ──────────────────────────────────────────────────────

const BIRTH_WORD = /^(?:nat[oaie]|nascita|compleanno|dob)$/;
const DATE_NUMERIC = /(?<!\d)\d{1,2}[/.\-]\d{1,2}[/.\-](?:\d{4}|\d{2})(?!\d)/g;
const DATE_WORDS = /(?<!\d)\d{1,2}\s*(?:°|º)?\s+(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+\d{4}(?!\d)/gi;
const YEAR = /(?<![\d.,])(?:19|20)\d{2}(?![\d.,])/g;

export const BIRTH_DISTANCE = 6;

/** Una data o un anno a non più di 6 parole da «nato», «nascita», «compleanno»… */
export function findBirthDates(t: PreparedText): Span[] {
  const keywords: number[] = [];
  t.norms.forEach((w, i) => {
    if (BIRTH_WORD.test(w)) keywords.push(i);
  });
  if (keywords.length === 0) return [];
  const dates = mergeSpans([...spans(t.text, DATE_NUMERIC), ...spans(t.text, DATE_WORDS), ...spans(t.text, YEAR)]);
  const out: Span[] = [];
  for (const d of dates) {
    const first = wordIndexAt(t, d.start);
    const last = wordIndexAt(t, Math.max(d.start, d.end - 1));
    const k = keywords.find((i) => (i < first ? first - i : i > last ? i - last : 0) <= BIRTH_DISTANCE);
    if (k !== undefined) out.push({ start: Math.min(t.starts[k], d.start), end: Math.max(t.ends[k], d.end) });
  }
  return mergeSpans(out);
}

// ── Nomi di persona ──────────────────────────────────────────────────────

export type NameKind = "nome_cognome" | "titolo_cognome" | "nome_noto" | "nome";

export interface NameMatch {
  kind: NameKind;
  /** Indici della prima e dell'ultima parola. */
  first: number;
  last: number;
}

/** Suffissi dei titoli abbreviati: «dott.ssa», «sig.ra», «sig.na». */
const HONORIFIC_SUFFIX = /^(?:ssa|ra|na)$/;

/** Particelle dei cognomi: «De Luca», «Della Valle», «D'Amico», «Lo Russo». */
const SURNAME_PARTICLE = /^(?:de|di|da|del|della|dello|dei|degli|delle|dal|dalla|dall|dell|d|lo|la|li|le|van|von|mac|mc)$/;

/** Dopo una particella il cognome continua: restituisce l'ultima parola del cognome. */
function surnameEnd(t: PreparedText, j: number): number {
  const k = j + 1;
  if (k >= t.norms.length || !SURNAME_PARTICLE.test(t.norms[j])) return j;
  const gap = t.text.slice(t.ends[j], t.starts[k]);
  return /^(?:[ \t]+|['’])$/.test(gap) && capitalised(rawWord(t, k)) ? k : j;
}

/** Salta le parole maiuscole di un nome di luogo («corso Vittorio Emanuele II»). */
function placeNameEnd(t: PreparedText, i: number): number {
  let k = i;
  while (k + 1 < t.norms.length && onlySpacesBetween(t, k, k + 1) && (capitalised(rawWord(t, k + 1)) || /^[ivxlc]+$/.test(t.norms[k + 1]))) k++;
  return k;
}

function capitalised(raw: string): boolean {
  return isTitleCase(raw) || isAllCaps(raw);
}

/** Parola che può essere un cognome dopo un nome o un titolo. */
function surnameAt(t: PreparedText, j: number): boolean {
  if (j >= t.norms.length) return false;
  const raw = rawWord(t, j);
  const norm = t.norms[j];
  if (NOT_SURNAMES.has(norm) || PLACE_PREFIXES.has(norm) || HONORIFICS.has(norm)) return false;
  if (capitalised(raw)) return true;
  // «D'Annunzio», «Dell'Acqua»: lettera o particella maiuscola seguita da apostrofo.
  const next = t.text[t.ends[j]] ?? "";
  return /^\p{Lu}\p{Ll}{0,3}$/u.test(raw) && (next === "'" || next === "’");
}

function knownNameIndex(names: readonly string[]): Map<string, string[][]> {
  const index = new Map<string, string[][]>();
  for (const name of names) {
    if (typeof name !== "string") continue;
    const tokens: string[] = [...(foldSameLength(name.normalize("NFC")).match(/[\p{L}\p{N}]+/gu) ?? [])];
    const head = tokens[0];
    if (head === undefined || tokens.join("").length < 2) continue;
    const list = index.get(head) ?? [];
    list.push(tokens);
    index.set(head, list);
  }
  for (const list of index.values()) list.sort((a, b) => b.length - a.length);
  return index;
}

/** Nomi di persona nel testo, con il tipo (vedi l'intestazione del modulo). */
export function findPersonNames(t: PreparedText, knownNames: readonly string[] = []): NameMatch[] {
  const out: NameMatch[] = [];
  const n = t.norms.length;
  const known = knownNameIndex(knownNames);
  for (let i = 0; i < n; i++) {
    const norm = t.norms[i];

    // Nomi del file privato: sempre, in qualsiasi forma di maiuscole.
    const candidates = known.get(norm);
    if (candidates) {
      const hit = candidates.find((tokens) => tokens.every((tok, k) => t.norms[i + k] === tok));
      if (hit) {
        out.push({ kind: "nome_noto", first: i, last: i + hit.length - 1 });
        i += hit.length - 1;
        continue;
      }
    }

    const raw = rawWord(t, i);
    // Titolo + cognome: «sig. Rossi», «dott.ssa Bianchi», «comandante Verdi».
    if (HONORIFICS.has(norm)) {
      let j = i + 1;
      if (j < n && HONORIFIC_SUFFIX.test(t.norms[j]) && /^\.?$/.test(t.text.slice(t.ends[i], t.starts[j]))) j++;
      const gap = j < n ? t.text.slice(t.ends[j - 1], t.starts[j]) : "";
      if (j < n && /^\.?[ \t]+$|^\.$/.test(gap) && surnameAt(t, j)) {
        const last = surnameEnd(t, j);
        out.push({ kind: "titolo_cognome", first: i, last });
        i = last;
        continue;
      }
    }

    if (!FIRST_NAMES.has(norm) || !capitalised(raw)) continue;
    const prev = i - 1;
    if (prev >= 0 && PLACE_PREFIXES.has(t.norms[prev]) && onlySpacesBetween(t, prev, i)) {
      i = placeNameEnd(t, i);
      continue;
    }
    const next = i + 1;
    if (next < n && onlySpacesBetween(t, i, next)) {
      if (PUBLIC_NAME_PAIRS.has(`${norm} ${t.norms[next]}`)) {
        i = next;
        continue;
      }
      const nextRaw = rawWord(t, next);
      // «Marina Militare», «Leonardo Helicopters»: un'istituzione, non una persona.
      if (capitalised(nextRaw) && NOT_SURNAMES.has(t.norms[next])) {
        i = next;
        continue;
      }
      const sameStyle = isAllCaps(raw) ? isAllCaps(nextRaw) : true;
      if (sameStyle && surnameAt(t, next)) {
        const last = surnameEnd(t, next);
        out.push({ kind: "nome_cognome", first: i, last });
        i = last;
        continue;
      }
    }
    // «ROSSI Mario»: cognome tutto maiuscolo prima del nome.
    if (prev >= 0 && isTitleCase(raw) && onlySpacesBetween(t, prev, i)) {
      const prevRaw = rawWord(t, prev);
      if (isAllCaps(prevRaw) && !NOT_SURNAMES.has(t.norms[prev]) && !HONORIFICS.has(t.norms[prev]) && !PLACE_PREFIXES.has(t.norms[prev])) {
        out.push({ kind: "nome_cognome", first: prev, last: i });
        continue;
      }
    }
    out.push({ kind: "nome", first: i, last: i });
  }
  return out;
}
