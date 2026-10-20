/**
 * Contenuti sensibili nei testi di una segnalazione (connettore MCP, WP3).
 *
 * Blocca (errore `sensitive_content`, con i campi):
 *  - codice fiscale, anche con omocodia (carattere di controllo valido, oppure la
 *    forma con le sette cifre: un refuso nel controllo non lo fa passare);
 *  - IBAN (lunghezza del paese e controllo mod-97), anche a gruppi di quattro;
 *  - numeri di carta (13-19 cifre, contigue o a gruppi, con Luhn), anche seguiti da
 *    scadenza o codice di sicurezza («4111 1111 1111 1111 12/27»);
 *  - numeri di telefono: +39 o 0039 (e ogni prefisso internazionale con almeno 8
 *    cifre), cellulari italiani che iniziano per 3 (9-10 cifre, compatti o a gruppi:
 *    «347 123 45 67», «347/1234567», «(347) 1234567»), fissi che iniziano per 0 con un
 *    separatore dopo il prefisso (8-11 cifre, anche a coppie: «06 12 34 56 78»);
 *  - indirizzi email diversi da `submittedBy.email`; nel titolo, che la ricerca mostra
 *    a tutta l'organizzazione, ogni indirizzo email.
 * Avvisa senza bloccare:
 *  - parole che fanno pensare a dati sanitari;
 *  - nomi propri, con un'euristica leggera: titolo o ruolo seguito da una parola con
 *    l'iniziale maiuscola («sig. Rossi», «comandante Verdi», «cliente Bianchi»).
 *
 * Taratura prudente: nessun falso positivo sui numeri della rubrica («220 volte
 * l'anno», «20 min x 220 x 6 persone = 440 ore/anno»), su importi («350.000 €»,
 * «1.000-3.000»), date («03/11/2026», «01 10 2026», «03/2026»), orari («08-12»,
 * «08.30-12.30»), numeri di documento («0012/2026», «2026/000123»), elenchi di anni e
 * codici («XX-0012»). I risultati dicono solo il tipo di dato e il campo: mai il valore.
 *
 * Modulo puro, senza import dall'app: gira con `node --test`.
 */
import { connectorError, type ConnectorError, type ConnectorWarning } from "./contract.ts";

export type SensitiveKind = "codice_fiscale" | "iban" | "carta" | "telefono" | "email";

export interface SensitiveFinding {
  field: string;
  kinds: SensitiveKind[];
}

export interface SensitiveAnalysis {
  /** Campi con dati da bloccare; vuoto se non c'è nulla. */
  blocked: SensitiveFinding[];
  /** Avvisi (`health_terms`, `proper_names`), con i campi. */
  warnings: ConnectorWarning[];
}

/** I campi di testo di `submit_contribution` che si analizzano, nell'ordine del contratto. */
export const SUBMISSION_TEXT_FIELDS = [
  "title",
  "problem",
  "flowDescription",
  "humanInTheLoop",
  "guardrails",
  "expectedImpact",
  "dataRequirements",
  "sustainabilityImpact",
  "toolsOther",
  "promptSnippet",
  "sourceConversation",
  "proposerEstimate.efficiency.reasoning",
  "proposerEstimate.effort.reasoning",
  "proposerEstimate.impactFlag.reasoning",
  "submittedBy.name",
] as const;

/**
 * Campi di testo che la ricerca e lo stato mostrano a tutta l'organizzazione: qui
 * nessuna email è ammessa, nemmeno quella di chi propone.
 */
export const PUBLIC_TEXT_FIELDS: ReadonlySet<string> = new Set(["title"]);

/** Forma minima letta da `analyzeSubmission` (la soddisfa `SubmitContributionInput`). */
export interface SubmissionTextSource {
  title?: string;
  problem?: string;
  flowDescription?: string;
  humanInTheLoop?: string;
  guardrails?: string;
  expectedImpact?: string;
  dataRequirements?: string;
  sustainabilityImpact?: string;
  toolsOther?: string;
  promptSnippet?: string;
  sourceConversation?: string;
  proposerEstimate?: {
    efficiency?: { reasoning?: string };
    effort?: { reasoning?: string };
    impactFlag?: { reasoning?: string };
  };
  submittedBy?: { name?: string; email?: string };
}

// ─── Codice fiscale ─────────────────────────────────────────────────────────

const TAX_CODE =
  /(?<![\p{L}\p{N}])[A-Za-z]{6}[0-9LMNPQRSTUVlmnpqrstuv]{2}[ABCDEHLMPRSTabcdehlmprst][0-9LMNPQRSTUVlmnpqrstuv]{2}[A-Za-z][0-9LMNPQRSTUVlmnpqrstuv]{3}[A-Za-z](?![\p{L}\p{N}])/gu;
const ODD_VALUES: Record<string, number> = {
  "0": 1, "1": 0, "2": 5, "3": 7, "4": 9, "5": 13, "6": 15, "7": 17, "8": 19, "9": 21,
  A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18,
  N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
};
/** Posizioni (da 0) che nella forma normale sono cifre. */
const TAX_CODE_DIGIT_POSITIONS = [6, 7, 9, 10, 12, 13, 14];

function evenValue(ch: string): number {
  return /[0-9]/.test(ch) ? Number(ch) : ch.charCodeAt(0) - 65;
}

/** Carattere di controllo del codice fiscale (le prime 15 posizioni, maiuscole). */
export function taxCodeCheckChar(first15: string): string {
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const ch = (first15[i] ?? "").toUpperCase();
    sum += i % 2 === 0 ? ODD_VALUES[ch] : evenValue(ch);
  }
  return String.fromCharCode(65 + (sum % 26));
}

function isTaxCode(candidate: string): boolean {
  const code = candidate.toUpperCase();
  if (taxCodeCheckChar(code.slice(0, 15)) === code[15]) return true;
  // Forma normale, senza omocodia: si blocca anche con un refuso nel controllo.
  return TAX_CODE_DIGIT_POSITIONS.every((i) => /[0-9]/.test(code[i]));
}

// ─── IBAN ───────────────────────────────────────────────────────────────────

/** Lunghezza dell'IBAN per paese (registro ISO 13616). */
const IBAN_LENGTHS: Record<string, number> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BR: 29, BY: 28, CH: 21, CR: 22,
  CY: 28, CZ: 24, DE: 22, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22,
  GI: 23, GL: 18, GR: 27, GT: 28, HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30,
  KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MD: 24, ME: 22, MK: 19, MR: 27, MT: 31,
  MU: 30, NL: 18, NO: 15, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, SA: 24, SC: 31, SE: 24,
  SI: 19, SK: 24, SM: 27, ST: 25, SV: 28, TL: 23, TN: 24, TR: 26, UA: 29, VA: 22, VG: 24, XK: 20,
};
const IBAN_START = /(?<![\p{L}\p{N}])[A-Za-z]{2}[0-9]{2}(?=[  ]?[A-Za-z0-9])/gu;

/** Controllo mod-97 di un IBAN compatto e maiuscolo. */
export function ibanChecksumOk(iban: string): boolean {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const value = /[0-9]/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/** Estremi dell'IBAN che inizia in `start`, con spazi singoli tra i caratteri; null se non lo è. */
function ibanAt(text: string, start: number): { end: number } | null {
  const country = text.slice(start, start + 2).toUpperCase();
  const length = IBAN_LENGTHS[country];
  if (!length) return null;
  let compact = "";
  let i = start;
  while (i < text.length && compact.length < length) {
    const ch = text[i];
    if (/[A-Za-z0-9]/.test(ch)) {
      compact += ch.toUpperCase();
      i++;
    } else if ((ch === " " || ch === " ") && /[A-Za-z0-9]/.test(text[i + 1] ?? "") && compact.length >= 4) {
      i++;
    } else {
      break;
    }
  }
  if (compact.length !== length || !/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(compact)) return null;
  return ibanChecksumOk(compact) ? { end: i } : null;
}

// ─── Sequenze di cifre ──────────────────────────────────────────────────────
//
// Carte e telefoni si cercano su sequenze di gruppi di cifre uniti da un separatore
// singolo. Non si decide sull'intera sequenza: la carta seguita dalla scadenza («4111
// 1111 1111 1111 12/27») o il cellulare seguito da un altro numero sono un tratto della
// sequenza. Si provano quindi i tratti di gruppi consecutivi che iniziano e finiscono
// a un confine: l'inizio o la fine della sequenza, oppure uno spazio.

const YEAR = /^(?:19|20)[0-9]{2}$/;

interface DigitGroup {
  start: number;
  end: number;
  digits: string;
}

interface DigitRun {
  groups: DigitGroup[];
  /** `seps[k]` sta tra `groups[k]` e `groups[k + 1]`; «)» o «) » dopo un prefisso tra parentesi. */
  seps: string[];
  /** L'ultimo gruppo è attaccato a una lettera (o a un decimale): un tratto non può finire lì. */
  gluedEnd: boolean;
}

function parseRun(text: string, start: number, raw: string, glued: RegExp): DigitRun {
  const groups: DigitGroup[] = [];
  const seps: string[] = [];
  let i = 0;
  if (raw[0] === "(") {
    const close = raw.indexOf(")");
    groups.push({ start, end: start + close + 1, digits: raw.slice(1, close) });
    i = close + 1;
    if (raw[i] === " ") i++;
    seps.push(raw.slice(close, i));
  }
  while (i < raw.length) {
    let j = i;
    while (j < raw.length && raw[j] >= "0" && raw[j] <= "9") j++;
    groups.push({ start: start + i, end: start + j, digits: raw.slice(i, j) });
    if (j < raw.length) seps.push(raw[j]);
    i = j + 1;
  }
  return { groups, seps, gluedEnd: glued.test(text.slice(start + raw.length)) };
}

/**
 * Tratti `[i, j]` di gruppi consecutivi con al massimo `maxDigits` cifre, da un confine a
 * un confine: inizio o fine della sequenza, uno spazio, una parentesi chiusa e uno spazio.
 */
function* runWindows(run: DigitRun, maxDigits: number): Generator<[number, number]> {
  const last = run.groups.length - 1;
  for (let i = 0; i <= last; i++) {
    if (i > 0 && run.seps[i - 1] !== " " && run.seps[i - 1] !== ") ") continue;
    let count = 0;
    for (let j = i; j <= last; j++) {
      count += run.groups[j].digits.length;
      if (count > maxDigits) break;
      if (j === last ? !run.gluedEnd : run.seps[j] === " ") yield [i, j];
    }
  }
}

// ─── Carte ──────────────────────────────────────────────────────────────────

const CARD_RUN = /(?<![\p{L}\p{N}])[0-9]+(?:[ -][0-9]+)*/gu;
const CARD_GLUED = /^[\p{L}\p{N}]/u;

export function luhnOk(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function isCardWindow(groups: readonly DigitGroup[], seps: readonly string[]): boolean {
  const digits = groups.map((g) => g.digits).join("");
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) return false;
  if (new Set(seps).size > 1) return false;
  if (groups.length > 1) {
    // Gruppi da quattro (l'ultimo da 1 a 4) oppure 4-6-5 / 4-6-4: niente elenchi di numeri.
    const sizes = groups.map((g) => g.digits.length);
    const fours = sizes.length >= 3 && sizes.slice(0, -1).every((n) => n === 4) && sizes[sizes.length - 1] <= 4;
    const amex = sizes.length === 3 && sizes[0] === 4 && sizes[1] === 6 && (sizes[2] === 5 || sizes[2] === 4);
    if (!fours && !amex) return false;
    // «2023 2024 2025 2026»: un elenco di anni, non una carta.
    if (groups.every((g) => YEAR.test(g.digits))) return false;
  }
  return luhnOk(digits);
}

// ─── Telefoni ───────────────────────────────────────────────────────────────

const AFTER_AMOUNT = /^\s*(?:€|eur\b|euro\b|%|ore\b|h\b|min\b|km\b|kg\b)/i;
const AFTER_CURRENCY = /^\s*(?:€|eur\b|euro\b|%)/i;
const PHONE_INTL = /(?<![\p{L}\p{N}+])(?:\+|00)[ ]?([1-9][0-9]{0,2})[ .\-]?((?:\(0\)[ ]?)?\(?[0-9]{1,4}\)?(?:[ \-./]?[0-9]{2,4}){1,5})(?![\p{L}\p{N}]|[.,][0-9])/gu;
/** Numeri nazionali: gruppi di cifre con separatori singoli, con un eventuale prefisso tra parentesi. */
const PHONE_RUN = /(?<![\p{L}\p{N}+.,/\-])(?:\([0-9]{2,4}\) ?)?[0-9]+(?:[ .\-/][0-9]+)*/gu;
const PHONE_GLUED = /^(?:[\p{L}\p{N}]|[.,][0-9])/u;
/** Prefisso di un fisso italiano: 0 e una cifra diversa da 0 (00 è il prefisso internazionale). */
const LANDLINE_PREFIX = /^0[1-9][0-9]{0,2}$/;

const digitsOf = (s: string) => s.replace(/[^0-9]/g, "");

function isIntlPhone(match: RegExpMatchArray, text: string, end: number): boolean {
  const country = match[1];
  const national = digitsOf(match[2]);
  if (AFTER_AMOUNT.test(text.slice(end))) return false;
  if (/^0+$/.test(national)) return false;
  if (country === "39") return national.length >= 6 && national.length <= 11 && /^[03]/.test(national);
  return national.length >= 8 && national.length <= 14 && !/\./.test(match[2]);
}

/**
 * Un tratto è un telefono nazionale se:
 *  - cellulare: inizia per 3 (seconda cifra 1-9), 9-10 cifre, compatto oppure con un
 *    primo gruppo di 3 cifre («347 123 45 67», «347/1234567», «(347) 1234567»); non a
 *    gruppi di tre come gli importi («350 000 000») e non seguito da un'unità («€», «ore»);
 *  - fisso: un prefisso 0X-0XXX seguito da un separatore, 8-11 cifre in tutto. Con 8 cifre
 *    non vale se ci sono coppie di cifre, la barra dopo il prefisso o un anno in coda:
 *    sono date («01 10 2026», «03/11/2026») e numeri di documento («0123/2026»).
 * Dopo il primo gruppo il separatore è sempre lo stesso: «08.30-12.30» è un orario.
 */
function isDomesticPhone(run: DigitRun, i: number, j: number, text: string): boolean {
  const groups = run.groups.slice(i, j + 1);
  const seps = run.seps.slice(i, j);
  const rest = groups.slice(1);
  if (new Set(seps.slice(1)).size > 1 || rest.some((g) => g.digits.length < 2)) return false;
  const digits = groups.map((g) => g.digits).join("");
  const after = text.slice(groups[groups.length - 1].end);
  const first = groups[0].digits;

  if (/^3[1-9]/.test(digits)) {
    if (digits.length < 9 || digits.length > 10 || /^0+$/.test(digits.slice(3))) return false;
    if (groups.length > 1 && first.length !== 3) return false;
    // «347.123.456» o «350 000 000» a gruppi di tre sono importi, non cellulari.
    const sizes = groups.map((g) => g.digits.length);
    if (sizes.length === 3 && sizes.every((n) => n === 3) && seps.every((s) => s === " " || s === ".")) return false;
    return !AFTER_AMOUNT.test(after);
  }

  if (groups.length < 2 || !LANDLINE_PREFIX.test(first)) return false;
  if (digits.length < 8 || digits.length > 11 || /^0+$/.test(digits.slice(first.length))) return false;
  const pairs = rest.some((g) => g.digits.length === 2);
  if (digits.length < 9 && (pairs || seps[0] === "/" || YEAR.test(rest[rest.length - 1].digits))) return false;
  return !AFTER_CURRENCY.test(after);
}

// ─── Email ──────────────────────────────────────────────────────────────────

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.[\p{L}]{2,}/gu;

// ─── Ricerca nei testi ──────────────────────────────────────────────────────

/** Sostituisce un tratto già riconosciuto, così i controlli dopo non lo contano due volte. */
function mask(text: string, start: number, end: number): string {
  return text.slice(0, start) + "#".repeat(end - start) + text.slice(end);
}

/**
 * Tipi di dato da bloccare in un testo. `allowedEmails`: indirizzi ammessi (quello di
 * chi propone), senza distinguere maiuscole.
 */
export function findSensitiveKinds(text: string, opts: { allowedEmails?: readonly string[] } = {}): SensitiveKind[] {
  const found = new Set<SensitiveKind>();
  const allowed = new Set((opts.allowedEmails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean));
  let work = text.normalize("NFC");

  for (const m of [...work.matchAll(EMAIL)]) {
    if (!allowed.has(m[0].toLowerCase())) found.add("email");
    work = mask(work, m.index, m.index + m[0].length);
  }
  for (const m of [...work.matchAll(IBAN_START)]) {
    const hit = ibanAt(work, m.index);
    if (hit) {
      found.add("iban");
      work = mask(work, m.index, hit.end);
    }
  }
  for (const m of [...work.matchAll(TAX_CODE)]) {
    if (isTaxCode(m[0])) {
      found.add("codice_fiscale");
      work = mask(work, m.index, m.index + m[0].length);
    }
  }
  for (const m of [...work.matchAll(CARD_RUN)]) {
    const run = parseRun(work, m.index, m[0], CARD_GLUED);
    for (const [i, j] of runWindows(run, 19)) {
      if (isCardWindow(run.groups.slice(i, j + 1), run.seps.slice(i, j))) {
        found.add("carta");
        work = mask(work, run.groups[i].start, run.groups[j].end);
        break;
      }
    }
  }
  for (const m of [...work.matchAll(PHONE_INTL)]) {
    const end = m.index + m[0].length;
    if (isIntlPhone(m, work, end)) {
      found.add("telefono");
      work = mask(work, m.index, end);
    }
  }
  if (!found.has("telefono")) {
    phones: for (const m of work.matchAll(PHONE_RUN)) {
      const run = parseRun(work, m.index, m[0], PHONE_GLUED);
      for (const [i, j] of runWindows(run, 11)) {
        if (isDomesticPhone(run, i, j, work)) {
          found.add("telefono");
          break phones;
        }
      }
    }
  }
  return [...found];
}

// ─── Avvisi ─────────────────────────────────────────────────────────────────

/** Senza accenti e in minuscolo, stessa lunghezza non garantita: solo per gli avvisi. */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
}

const HEALTH_TERMS = [
  "visita medica", "visite mediche", "certificato medico", "certificati medici",
  "certificato di malattia", "malattia", "malattie", "diagnosi", "idoneita medica", "inidoneita",
  "terapia", "terapie", "farmaco", "farmaci", "ricovero", "ricoveri", "ricoverato", "ricoverata",
  "invalidita", "gravidanza", "gravidanze", "maternita", "cartella clinica", "cartelle cliniche",
  "patologia", "patologie", "infortunio", "infortuni", "medico competente", "sorveglianza sanitaria",
  "dati sanitari", "dato sanitario", "esami del sangue", "analisi del sangue", "vaccino", "vaccinazione",
  "allergia", "allergie", "sieropositivo", "psicologo", "psichiatrico",
];
const HEALTH = new RegExp(`(?<![a-z0-9])(?:${HEALTH_TERMS.map((t) => t.replace(/ /g, "\\s+")).join("|")})(?![a-z0-9])`);
/**
 * «Disabilità» si riconosce solo con l'accento (o con l'apostrofo al suo posto), sul
 * testo non piegato: senza accento è il verbo «disabilita» («il sistema disabilita
 * l'utente»), frequente nei controlli e nei flussi.
 */
const HEALTH_ACCENTED = /(?<![\p{L}\p{N}])disabilit(?:à|a['’`])/u;

export function hasHealthTerms(text: string): boolean {
  return HEALTH.test(fold(text)) || HEALTH_ACCENTED.test(text.normalize("NFC").toLowerCase());
}

const NAME_TITLES =
  /(?<![\p{L}\p{N}])(sig\.ra|sig\.|sigg\.|signora|signore|signor|dott\.ssa|dott\.|dr\.ssa|dr\.|ing\.|avv\.|prof\.ssa|prof\.|rag\.|geom\.|arch\.|comandante|capitano|cap\.|cliente|pilota|collega)[ \t]+([\p{L}'’]+)/giu;
const NOT_A_NAME = new Set(["Il", "Lo", "La", "I", "Gli", "Le", "Un", "Uno", "Una", "Di", "Del", "Della", "E", "Ed", "Che", "Per", "In", "Con", "Su", "Da", "Al", "Alla"]);

export function hasProperNameHint(text: string): boolean {
  for (const m of text.matchAll(NAME_TITLES)) {
    const word = m[2];
    if (/^\p{Lu}\p{Ll}/u.test(word) && !NOT_A_NAME.has(word)) return true;
  }
  return false;
}

// ─── Segnalazione intera ────────────────────────────────────────────────────

/** Coppie `[campo, testo]` dei campi da analizzare, solo quelli valorizzati. */
export function submissionTexts(source: SubmissionTextSource): Array<[string, string]> {
  const values: Record<(typeof SUBMISSION_TEXT_FIELDS)[number], string | undefined> = {
    title: source.title,
    problem: source.problem,
    flowDescription: source.flowDescription,
    humanInTheLoop: source.humanInTheLoop,
    guardrails: source.guardrails,
    expectedImpact: source.expectedImpact,
    dataRequirements: source.dataRequirements,
    sustainabilityImpact: source.sustainabilityImpact,
    toolsOther: source.toolsOther,
    promptSnippet: source.promptSnippet,
    sourceConversation: source.sourceConversation,
    "proposerEstimate.efficiency.reasoning": source.proposerEstimate?.efficiency?.reasoning,
    "proposerEstimate.effort.reasoning": source.proposerEstimate?.effort?.reasoning,
    "proposerEstimate.impactFlag.reasoning": source.proposerEstimate?.impactFlag?.reasoning,
    "submittedBy.name": source.submittedBy?.name,
  };
  return SUBMISSION_TEXT_FIELDS.flatMap((field) => {
    const text = values[field];
    return typeof text === "string" && text.trim() ? [[field, text] as [string, string]] : [];
  });
}

/**
 * Passo 2 di `submit_contribution`: dati da bloccare e avvisi. L'email di chi propone
 * (`submittedBy.email`) è ammessa, tranne nei campi pubblici (`PUBLIC_TEXT_FIELDS`); il
 * nome di chi propone non dà l'avviso sui nomi.
 */
/**
 * Prime parole degli avvisi su dati sanitari e nomi. Il codice dell'avviso non arriva al client
 * (`warningTexts` tiene solo il messaggio): la skill li riconosce da queste parole.
 */
export const HEALTH_WARNING_OPENING = "Possibili riferimenti a dati sanitari";
export const NAMES_WARNING_OPENING = "Possibili nomi di persone";

export function analyzeSubmission(source: SubmissionTextSource): SensitiveAnalysis {
  const ownEmails = source.submittedBy?.email ? [source.submittedBy.email] : [];
  const blocked: SensitiveFinding[] = [];
  const health: string[] = [];
  const names: string[] = [];
  for (const [field, text] of submissionTexts(source)) {
    const allowedEmails = PUBLIC_TEXT_FIELDS.has(field) ? [] : ownEmails;
    const kinds = findSensitiveKinds(text, { allowedEmails });
    if (kinds.length) blocked.push({ field, kinds });
    if (hasHealthTerms(text)) health.push(field);
    if (field !== "submittedBy.name" && hasProperNameHint(text)) names.push(field);
  }
  const warnings: ConnectorWarning[] = [];
  if (health.length) {
    warnings.push({
      code: "health_terms",
      message: `${HEALTH_WARNING_OPENING} in: ${health.join(", ")}. Verifica con la persona e, se serve, invia una correzione senza quei dettagli.`,
      fields: health,
    });
  }
  if (names.length) {
    warnings.push({
      code: "proper_names",
      message: `${NAMES_WARNING_OPENING} in: ${names.join(", ")}. Verifica con la persona e, se serve, usa ruoli al posto dei nomi.`,
      fields: names,
    });
  }
  return { blocked, warnings };
}

const KIND_LABEL: Record<SensitiveKind, string> = {
  codice_fiscale: "un codice fiscale",
  iban: "un IBAN",
  carta: "un numero di carta",
  telefono: "un numero di telefono",
  email: "un indirizzo email di un'altra persona",
};

/** Nei campi pubblici l'email può essere anche quella di chi propone. */
const PUBLIC_EMAIL_LABEL = "un indirizzo email (questo campo lo vede tutta l'organizzazione)";

/** Errore `sensitive_content`: un messaggio per campo, con i tipi di dato e mai i valori. */
export function sensitiveContentError(blocked: readonly SensitiveFinding[]): ConnectorError {
  const fieldErrors: Record<string, string> = {};
  for (const finding of blocked) {
    const isPublic = PUBLIC_TEXT_FIELDS.has(finding.field);
    const labels = finding.kinds.map((k) => (k === "email" && isPublic ? PUBLIC_EMAIL_LABEL : KIND_LABEL[k]));
    const list = labels.length > 1 ? `${labels.slice(0, -1).join(", ")} e ${labels[labels.length - 1]}` : labels[0];
    fieldErrors[finding.field] = `Contiene ${list}: riscrivi il campo in modo generico.`;
  }
  return connectorError("sensitive_content", { fieldErrors });
}
