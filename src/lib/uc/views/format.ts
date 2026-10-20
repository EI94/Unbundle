/**
 * Valori, date e importi come si mostrano nelle pagine interne del caso.
 *
 * - Il valore di una risposta si mostra solo se il ruolo lo vede
 *   (`valueVisibleTo`): i dati sanitari mai, quelli personali mai qui (restano
 *   cifrati nella zona personale), gli altri secondo `value_visibility`.
 * - Date e importi si formattano sul server, in `Europe/Rome`, e arrivano ai
 *   componenti client già come testo (niente differenze tra server e browser).
 * - Nelle righe «23 ott», nei pannelli «23 ottobre 2026», sotto i 7 giorni
 *   «3 giorni fa» (DESIGN §5.4). I conteggi passano da un solo formattatore.
 * - `stripFactCodes` e `stripLegalRefs` tolgono codici dei fatti e articoli dai
 *   testi per chi non è di Lateral Space (DESIGN §1, principio 3);
 *   `plainPriorityWords` mette le priorità in italiano, accordate al nome.
 *
 * Modulo puro.
 */
import { displayJsonValue } from "../export/format.ts";
import { valueVisibleTo } from "../permissions.ts";
import type { Json } from "../types.ts";
import type { CaseRole, PrivacyClass, SourceKind, ValueVisibility } from "../vocab.ts";
import { SOURCE_KIND_LABEL } from "./labels.ts";

export type ValueView =
  | { kind: "value"; text: string }
  | { kind: "hidden"; reason: "personale" | "sanitario" | "visibilita" | "cancellato"; text: string }
  | { kind: "none" };

const HIDDEN_TEXT = {
  personale: "Dato personale: resta cifrato nella zona personale",
  sanitario: "I dati sanitari non si registrano",
  visibilita: "Valore non visibile per il tuo ruolo",
  cancellato: "Valore cancellato per privacy",
} as const;

function hidden(reason: keyof typeof HIDDEN_TEXT): ValueView {
  return { kind: "hidden", reason, text: HIDDEN_TEXT[reason] };
}

/**
 * Valore della risposta per chi guarda. `value` arriva già `NULL` dal database
 * per le classi personali e sanitarie e per i valori cancellati: qui si decide
 * anche cosa dire al posto del valore.
 */
export function answerValueView(i: {
  value: Json | null | undefined;
  encrypted: boolean;
  erased: boolean;
  privacyClass: PrivacyClass;
  valueVisibility: ValueVisibility;
  roles: readonly CaseRole[];
}): ValueView {
  if (i.privacyClass === "escluso_sanitario") return hidden("sanitario");
  if (i.privacyClass === "personale" || i.privacyClass === "personale_equipaggio") return i.encrypted || i.value != null ? hidden("personale") : { kind: "none" };
  if (i.erased) return hidden("cancellato");
  if (i.value === null || i.value === undefined) return { kind: "none" };
  if (!valueVisibleTo(i.valueVisibility, i.roles, i.privacyClass, false)) return hidden("visibilita");
  const text = displayJsonValue(i.value);
  return text ? { kind: "value", text } : { kind: "none" };
}

/** «Dichiarato in call · F012», «Referente», «Documento · Bilancio 2025». */
export function provenanceText(sourceKind: SourceKind, sourceRef: string | null | undefined): string {
  const label = SOURCE_KIND_LABEL[sourceKind] ?? sourceKind;
  const ref = sourceRef?.trim();
  return ref ? `${label} · ${ref}` : label;
}

const DATE = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "short", year: "numeric" });
const DATE_TIME = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00Z` : v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** «7 ott 2026», oppure null. Le date `YYYY-MM-DD` si leggono a mezzogiorno UTC (stesso giorno a Roma). */
export function formatDateIt(v: Date | string | null | undefined): string | null {
  const d = toDate(v);
  return d ? DATE.format(d) : null;
}

/** «7 ott 2026, 10:05», oppure null. */
export function formatDateTimeIt(v: Date | string | null | undefined): string | null {
  const d = toDate(v);
  return d ? DATE_TIME.format(d) : null;
}

const DAY = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "short" });
const DAY_YEAR = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "short", year: "numeric" });
const LONG_DAY = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "long", year: "numeric" });
const ROME_KEY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" });

/** Giorno di calendario a Roma, `YYYY-MM-DD`. */
function romeDayKey(d: Date): string {
  return ROME_KEY.format(d);
}

/**
 * «23 ott» nelle righe (DESIGN §5.4); con l'anno solo se diverso da quello di
 * `now`. Oppure null.
 */
export function formatDayIt(v: Date | string | null | undefined, opts: { now?: Date } = {}): string | null {
  const d = toDate(v);
  if (!d) return null;
  if (opts.now && romeDayKey(d).slice(0, 4) !== romeDayKey(opts.now).slice(0, 4)) return DAY_YEAR.format(d);
  return DAY.format(d);
}

/** «23 ottobre 2026» nei pannelli. Oppure null. */
export function formatLongDayIt(v: Date | string | null | undefined): string | null {
  const d = toDate(v);
  return d ? LONG_DAY.format(d) : null;
}

/**
 * Data relativa sotto i 7 giorni, come la leggono le persone: «adesso»,
 * «5 minuti fa», «2 ore fa», «ieri», «3 giorni fa». Dal settimo giorno, e per
 * le date future, il giorno («23 ott»). I giorni si contano sul calendario di
 * Roma. Oppure null.
 */
export function formatRelativeIt(v: Date | string | null | undefined, now: Date): string | null {
  const d = toDate(v);
  if (!d) return null;
  const ms = now.getTime() - d.getTime();
  if (ms < 0) return formatDayIt(d, { now });
  const days = Math.round((Date.parse(`${romeDayKey(now)}T00:00:00Z`) - Date.parse(`${romeDayKey(d)}T00:00:00Z`)) / 86_400_000);
  if (days === 0) {
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 1) return "adesso";
    if (minutes < 60) return minutes === 1 ? "1 minuto fa" : `${minutes} minuti fa`;
    const hours = Math.floor(minutes / 60);
    return hours === 1 ? "1 ora fa" : `${hours} ore fa`;
  }
  if (days === 1) return "ieri";
  if (days < 7) return `${days} giorni fa`;
  return formatDayIt(d, { now });
}

// ── Testi senza codici (§1, principio 3) ──────────────────────────────

/** Spazi doppi, spazi prima della punteggiatura, separatori e parentesi rimasti vuoti. */
function tidy(text: string): string {
  return text
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,;:!?)])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/(?:\s*·\s*){2,}/g, " · ")
    .replace(/^\s*·\s*|\s*·\s*$/g, "")
    .replace(/([.,;:])\1+/g, "$1")
    .trim();
}

const FACT_LIST = String.raw`F\d{3,}(?:\s*(?:,|;|\/|\be\b)\s*F\d{3,})*`;

/**
 * Toglie i codici dei fatti (`F012`) da un testo per chi non è di Lateral
 * Space: «Dichiarato in call · F010» → «Dichiarato in call»,
 * «stabile (F012, F013).» → «stabile.». I codici restano in «Dettagli tecnici».
 */
export function stripFactCodes(text: string): string {
  if (!/F\d{3}/.test(text)) return text;
  const out = text
    .replace(new RegExp(String.raw`\s*\((?:font[ei]\s+)?${FACT_LIST}\)`, "gi"), "")
    .replace(new RegExp(String.raw`\s*[·•–—,;]\s*(?:font[ei]\s+)?${FACT_LIST}\b`, "gi"), "")
    .replace(new RegExp(String.raw`\s*\bfont[ei]\s+${FACT_LIST}\b`, "gi"), "")
    .replace(new RegExp(String.raw`\s*\b${FACT_LIST}\b`, "g"), "");
  return tidy(out);
}

const ARTICLE = String.raw`artt?\.\s?\d+(?:\.\d+)*(?:\s*(?:,|-|–|\be\b)\s*\d+(?:\.\d+)*)*`;

/**
 * Toglie gli articoli di contratto e la sigla della scheda privacy da un testo
 * per chi non è di Lateral Space: «Costi da autorizzare (art. 8.4)» →
 * «Costi da autorizzare», «ai sensi dell'art. 7.2» → «», «Scheda A.8» →
 * «Scheda privacy». Gli articoli restano in «Dettagli tecnici» e nei documenti.
 */
export function stripLegalRefs(text: string): string {
  if (!/\bartt?\.\s?\d|\bA\.8\b/i.test(text)) return text;
  const out = text
    .replace(new RegExp(String.raw`\s*\((?:ai sensi dell['’]\s*)?${ARTICLE}(?:\s+(?:del contratto|dell['’]accordo))?\)`, "gi"), "")
    .replace(new RegExp(String.raw`\s*,?\s*(?:ai sensi|come previsto|secondo quanto previsto)\s+d[ae]ll?['’]\s*${ARTICLE}(?:\s+(?:del contratto|dell['’]accordo))?`, "gi"), "")
    .replace(new RegExp(String.raw`\s*\b(?:dell|all|nell|l)['’]\s*${ARTICLE}`, "gi"), "")
    .replace(new RegExp(String.raw`\s*\b${ARTICLE}`, "gi"), "")
    .replace(/\s*\(A\.8\)/g, "")
    .replace(/\b([Ss])cheda A\.8\b/g, "$1cheda privacy")
    .replace(/\bA\.8\b/g, "scheda privacy");
  return tidy(out);
}

// ── Priorità in italiano (DESIGN §2.6) ────────────────────────────────

/** Genere e numero a cui si accorda la priorità; `masculine: null` = non si sa. */
interface Agreement {
  plural: boolean;
  masculine: boolean | null;
}

/** Le priorità del template nelle parole di §2.6: maschile e femminile, singolare e plurale. */
const PRIORITY_FORMS: Readonly<Record<string, { ms: string; fs: string; mp: string; fp: string }>> = {
  must: { ms: "indispensabile", fs: "indispensabile", mp: "indispensabili", fp: "indispensabili" },
  should: { ms: "utile", fs: "utile", mp: "utili", fp: "utili" },
  could: { ms: "facoltativo", fs: "facoltativa", mp: "facoltativi", fp: "facoltative" },
};

function wordMap(groups: readonly (readonly [string, Agreement])[]): ReadonlyMap<string, Agreement> {
  const out = new Map<string, Agreement>();
  for (const [list, agreement] of groups) for (const w of list.split(" ")) out.set(w, agreement);
  return out;
}

const MS: Agreement = { plural: false, masculine: true };
const FS: Agreement = { plural: false, masculine: false };
const MP: Agreement = { plural: true, masculine: true };
const FP: Agreement = { plural: true, masculine: false };

/**
 * I nomi del dossier di cui si sa genere e numero. Gli altri si leggono
 * dall'articolo o dalla desinenza; nel dubbio vale il femminile di «domanda».
 */
const NOUNS = wordMap([
  ["dato campo requisito documento argomento passo controllo criterio valore indicatore sistema schema problema punto ruolo obiettivo vincolo elemento aspetto attributo parametro flusso processo caso modulo piano allegato calcolo costo beneficio rischio fatto modello collegamento accesso livello dettaglio formato tempo numero importo prezzo margine", MS],
  ["dati campi requisiti documenti argomenti passi controlli criteri valori indicatori sistemi schemi problemi punti ruoli obiettivi vincoli elementi aspetti attributi parametri flussi processi casi moduli piani allegati calcoli costi benefici rischi fatti modelli collegamenti accessi livelli dettagli formati tempi numeri importi prezzi margini", MP],
  ["domanda voce regola risposta fase tappa scheda fonte informazione metrica colonna tabella condizione richiesta verifica firma", FS],
  ["domande voci regole risposte fasi tappe schede fonti informazioni metriche colonne tabelle condizioni richieste verifiche firme", FP],
]);

/** Nomi uguali al singolare e al plurale: il numero lo dice l'articolo (true = maschile). */
const INVARIANT_NOUNS: ReadonlyMap<string, boolean> = new Map([
  ...["kpi", "file", "test", "report", "export", "dataset"].map((w) => [w, true] as const),
  ...["attività", "priorità"].map((w) => [w, false] as const),
]);

/** Articoli, preposizioni articolate e dimostrativi: genere e numero di ciò che segue. */
const ARTICLES = wordMap([
  ["il lo un uno del dello al allo dal dallo nel nello sul sullo questo quel quello", MS],
  ["la una della alla dalla nella sulla questa quella", FS],
  ["i gli dei degli ai agli dai dagli nei negli sui sugli questi quei quegli tutti altri alcuni", MP],
  ["le delle alle dalle nelle sulle queste quelle tutte altre alcune", FP],
  ["l dell all dall nell sull", { plural: false, masculine: null }],
]);

/** Preposizioni e verbi al singolare: dopo, la priorità sta al singolare («di must» → «di indispensabile»). */
const SINGULAR_AFTER = new Set("di a da in con su per tra fra come ogni qualche è sia era sarà resta rimane diventa risulta viene sembra appare".split(" "));

/** Verbi alla terza persona plurale: dopo, la priorità sta al plurale («sono must» → «sono indispensabili»). */
const PLURAL_VERBS = new Set("sono erano saranno siano restano rimangono diventano risultano vengono sembrano appaiono vanno devono possono servono mancano".split(" "));

/** Fra due priorità coordinate («must e should», «must, should o could») vale l'accordo della prima. */
const COORDINATION = /^[ \t]*(?:[,/][ \t]*(?:(?:e|ed|o|od|oppure)[ \t]+)?|(?:e|ed|o|od|oppure)[ \t]+)$/i;

/** L'ultima parola prima della fine del testo, separata solo da spazi (o dall'apostrofo: «dell'»). */
function lastWord(text: string): { word: string; rest: string } | null {
  const m = /(\p{L}+)['’]?[ \t]*$/u.exec(text);
  return m ? { word: m[1].toLowerCase(), rest: text.slice(0, m.index) } : null;
}

/** Il genere del nome più vicino nella stessa frase (un nome noto o un articolo), oppure null. */
function genderBefore(text: string): boolean | null {
  const clause = text.slice(Math.max(...[".", ";", ":", "!", "?", "\n"].map((c) => text.lastIndexOf(c))) + 1);
  const words = clause.match(/\p{L}+/gu) ?? [];
  for (let i = words.length - 1; i >= Math.max(0, words.length - 8); i--) {
    const w = words[i].toLowerCase();
    const masculine = NOUNS.get(w)?.masculine ?? INVARIANT_NOUNS.get(w) ?? ARTICLES.get(w)?.masculine ?? null;
    if (masculine !== null) return masculine;
  }
  return null;
}

/** L'accordo che dà la parola prima di un nome o di un aggettivo: un articolo o un nome noto. */
function agreementOfWordBefore(text: string): Agreement | null {
  const prev = lastWord(text);
  return prev ? (ARTICLES.get(prev.word) ?? NOUNS.get(prev.word) ?? null) : null;
}

/** Genere e numero per la priorità che segue `before`. */
function priorityAgreement(before: string): Agreement {
  const prev = lastWord(before);
  if (!prev) return { plural: false, masculine: genderBefore(before) };
  const w = prev.word;
  const known = ARTICLES.get(w) ?? NOUNS.get(w);
  if (known) return known.masculine === null ? { plural: known.plural, masculine: genderBefore(prev.rest) } : known;
  const invariant = INVARIANT_NOUNS.get(w);
  if (invariant !== undefined) return { plural: agreementOfWordBefore(prev.rest)?.plural ?? false, masculine: invariant };
  if (SINGULAR_AFTER.has(w)) return { plural: false, masculine: genderBefore(prev.rest) };
  if (PLURAL_VERBS.has(w)) return { plural: true, masculine: genderBefore(prev.rest) };
  // Un nome o un aggettivo che non conosciamo: l'articolo o il nome prima, altrimenti la desinenza.
  const context = agreementOfWordBefore(prev.rest);
  const feminineEnding = /(?:zion|sion)[ei]$|tà$|a$/.test(w);
  return {
    plural: context?.plural ?? /i$/.test(w),
    masculine: context?.masculine ?? (feminineEnding ? false : /(?:[oi]|ore)$/.test(w) ? true : null),
  };
}

/**
 * «must», «should» e «could» in un testo dello schema per chi non è di
 * Lateral Space (DESIGN §2.6, controllo dei testi §6.2): «indispensabile»,
 * «utile», «facoltativo», accordati al nome a cui si riferiscono:
 * - dopo un nome, un aggettivo o un articolo, con il suo genere e numero
 *   («le voci «must»» → «le voci indispensabili», «il dato could» → «il dato
 *   facoltativo», «i campi could» → «i campi facoltativi»);
 * - dopo un verbo al plurale al plurale, dopo una preposizione o un verbo al
 *   singolare al singolare, con il genere del nome più vicino nella frase
 *   («sono must» → «sono indispensabili», «di must» → «di indispensabile»);
 * - una priorità coordinata a un'altra ne prende l'accordo («must e should» →
 *   «indispensabili e utili»).
 * Nel dubbio vale il femminile di «domanda». Le virgolette intorno alla parola
 * se ne vanno; la maiuscola resta.
 */
export function plainPriorityWords(text: string): string {
  if (!/\b(?:must|should|could)\b/i.test(text)) return text;
  let last: { end: number; agreement: Agreement } | null = null;
  return text.replace(/[«"“]?\b(must|should|could)\b[»"”]?/gi, (match: string, word: string, offset: number) => {
    const agreement: Agreement = last && COORDINATION.test(text.slice(last.end, offset)) ? last.agreement : priorityAgreement(text.slice(0, offset));
    last = { end: offset + match.length, agreement };
    const forms = PRIORITY_FORMS[word.toLowerCase()];
    const out = agreement.plural ? (agreement.masculine ? forms.mp : forms.fp) : agreement.masculine ? forms.ms : forms.fs;
    return /^\p{Lu}/u.test(word) ? out.charAt(0).toUpperCase() + out.slice(1) : out;
  });
}

/**
 * «gate» in un testo dello schema per chi non è di Lateral Space (gergo del
 * controllo dei testi, DESIGN §6.2): «controllo», al plurale «controlli». È
 * maschile come «gate» e comincia per consonante, quindi articoli e preposizioni
 * restano («al gate di fattibilità» → «al controllo di fattibilità»); la
 * maiuscola resta dov'era.
 */
export function plainGateWord(text: string): string {
  if (!/\bgates?\b/i.test(text)) return text;
  return text.replace(/\b(g)ate(s?)\b/gi, (_all, g: string, plural: string) => `${g === "G" ? "C" : "c"}ontroll${plural ? "i" : "o"}`);
}

// ── Numeri (un solo formattatore `it-IT`) ─────────────────────────────

/** Il formattatore dei conteggi: interi, con il punto delle migliaia anche a 4 cifre («2.812»). */
export const NUMBER_IT = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0, useGrouping: "always" });

/** «2.812»; un valore non finito vale 0. */
export function formatCountIt(n: number): string {
  return NUMBER_IT.format(Number.isFinite(n) ? Math.round(n) : 0);
}

const EURO = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0, useGrouping: "always" });
const NUMBER = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1, useGrouping: "always" });

export function formatEuro(n: number | null | undefined): string | null {
  return typeof n === "number" && Number.isFinite(n) ? EURO.format(n) : null;
}

export function formatNumberIt(n: number | null | undefined): string | null {
  return typeof n === "number" && Number.isFinite(n) ? NUMBER.format(n) : null;
}

/** «12 KB», «3,4 MB». */
export function formatBytes(n: number | null | undefined): string | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${NUMBER.format(n / 1024)} KB`;
  return `${NUMBER.format(n / (1024 * 1024))} MB`;
}

/** Testo di un campo `spec` (stringa, numero, booleano o elenco), oppure null. */
export function specText(spec: Readonly<Record<string, Json>>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = spec[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    if (typeof v === "boolean") return v ? "sì" : "no";
    if (Array.isArray(v)) {
      const parts = v.map((x) => (typeof x === "string" || typeof x === "number" ? String(x) : displayJsonValue(x))).filter((x) => x.trim() !== "");
      if (parts.length) return parts.join(", ");
    }
  }
  return null;
}
