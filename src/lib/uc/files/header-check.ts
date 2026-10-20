/**
 * Controllo delle intestazioni di colonna e dei valori dei file tabellari
 * (PIANO §6.3, passo 4; spec privacy 1, 3, 4).
 *
 * Le intestazioni si dividono in token: minuscolo, senza accenti, divisione su
 * tutto ciò che non è lettera o cifra, sul camelCase e tra lettere e cifre
 * (`dataNascita` → `data nascita`, `e-mail` → `email`). Le regole guardano i
 * token, mai sottostringhe: così `nome_aeroporto` non è un nome di persona e
 * `ETA` (orario stimato d'arrivo) non è un'età.
 *
 * Categorie:
 * - **sanitario**: rifiuta sempre il file (`visita medica`, `medic*`,
 *   `sanitar*`, `malatt*`, `diagnos*`, …). Vale anche sul testo libero
 *   (`findHealthTerms`), perché un file con parole come «visita medica» si
 *   rifiuta comunque.
 * - **particolare**: altre categorie dell'art. 9 GDPR come colonne (religione,
 *   origine etnica, orientamento sessuale, iscrizione a un sindacato, dati
 *   genetici o biometrici): rifiuta sempre [D]. Solo sulle intestazioni: nel
 *   testo «accordo sindacale» è normale.
 * - **personale**: cognome, nominativo, passaporto, nascita, codice fiscale,
 *   email, telefono, indirizzo, IBAN, sesso. Rifiuta prima della scheda A.8 e
 *   in ogni voce della zona standard. Il token `nome` conta solo da solo o con
 *   un qualificatore di persona (passeggero, pilota, cliente, referente,
 *   equipaggio, cognome…).
 * - **vietata**: colonne vietate dalla voce (`spec.forbidden_columns`) o dal
 *   template (`forbidden_columns_patterns`): rifiuta sempre.
 *
 * I valori (prime 200 righe): email, codice fiscale (con carattere di
 * controllo), IBAN (con controllo mod 97) e telefono (almeno metà delle celle
 * piene della colonna).
 *
 * Gli esiti riportano solo l'etichetta del lessico, la colonna e i conteggi:
 * mai il testo del file.
 *
 * I termini sanitari si cercano anche con il lessico delle risposte
 * (`text/health-terms.ts`), su intestazioni e testo: un file non passa mai con
 * una parola che nella risposta di un referente sarebbe bloccata.
 *
 * Modulo puro.
 */
import { findHealthTerms as findAnswerHealthTerms } from "../text/health-terms.ts";
import { prepareText } from "../text/words.ts";

// ── Token ─────────────────────────────────────────────────────────────

const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Token di un'intestazione o di un testo: minuscolo, senza accenti, diviso su
 * non-alfanumerici, camelCase e confini lettera/cifra. `e` + `mail` diventa
 * `email`.
 */
export function textTokens(text: string): string[] {
  if (!text) return [];
  const raw = text
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  const out: string[] = [];
  for (const token of raw) {
    if (!token) continue;
    if (token === "mail" && out[out.length - 1] === "e") out[out.length - 1] = "email";
    else out.push(token);
  }
  return out;
}

/** Parole che non contano nelle regole (articoli, preposizioni, «numero»). */
const STOPWORDS = new Set([
  "a", "ad", "agli", "ai", "al", "alla", "alle", "allo", "and", "c", "con", "d", "da", "dai", "dal", "dalla", "dalle",
  "dallo", "degli", "dei", "del", "dell", "della", "delle", "dello", "di", "e", "ed", "gli", "i", "il", "in", "l",
  "la", "le", "lo", "n", "nr", "nro", "num", "number", "numero", "o", "od", "of", "or", "per", "su", "the", "un",
  "una", "uno",
]);

function significant(tokens: readonly string[]): string[] {
  return tokens.filter((t) => !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

// ── Lessico ───────────────────────────────────────────────────────────

export const HEADER_CATEGORIES = ["sanitario", "particolare", "personale", "vietata"] as const;
export type HeaderCategory = (typeof HEADER_CATEGORIES)[number];

interface LexiconRule {
  /** Etichetta del lessico: l'unico testo che finisce negli esiti. */
  readonly term: string;
  readonly category: Exclude<HeaderCategory, "vietata">;
  /** Radici: `medic*` = prefisso, altrimenti parola esatta. Devono esserci tutte. */
  readonly all: readonly string[];
  /** Distanza massima, in token significativi, tra le radici (predefinita: adiacenti). */
  readonly window?: number;
  /** La regola conta solo se l'intestazione è fatta solo delle radici, o se c'è un qualificatore vicino. */
  readonly context?: { readonly alone?: boolean; readonly qualifiers: readonly string[] };
  /** Radici vicine che annullano la regola (es. `indirizzo ip`). */
  readonly unless?: readonly string[];
  /** Solo intestazioni: nel testo libero la regola non vale. */
  readonly headerOnly?: boolean;
}

/** Qualificatori di persona per `nome`, `cf`, `tel`, `invalido`. */
const PERSON_QUALIFIERS = [
  "passegger*", "passenger*", "pilot*", "copilot*", "comandant*", "client*", "customer*", "referent*", "equipaggi*",
  "crew", "cognom*", "surname*", "dipendent*", "employee*", "persona", "persone", "person", "people", "utent*",
  "user*", "assistent*", "hostess", "steward*", "contatt*", "contact*", "titolar*", "complet*", "proprio", "first",
  "last", "full", "given", "family", "istruttor*", "allievo", "allievi", "student*", "staff", "lavorator*", "worker*",
  "paziente", "pazienti", "patient*", "membro", "membri", "civil*",
] as const;

const HEALTH: readonly LexiconRule[] = [
  { term: "visita medica", category: "sanitario", all: ["visita", "medic*"], window: 4 },
  { term: "visita di idoneità", category: "sanitario", all: ["visit*", "idoneit*"], window: 4 },
  { term: "medico", category: "sanitario", all: ["medic*"] },
  { term: "sanitario", category: "sanitario", all: ["sanitar*"] },
  { term: "malattia", category: "sanitario", all: ["malatt*"] },
  ...["malato", "malata", "malati", "malate"].map((word): LexiconRule => ({ term: "malattia", category: "sanitario", all: [word] })),
  { term: "gruppo sanguigno", category: "sanitario", all: ["sanguign*"] },
  { term: "covid", category: "sanitario", all: ["covid*"] },
  // «ricovero» del mezzo (hangar, aereo…) non è un dato sanitario.
  {
    term: "ricovero",
    category: "sanitario",
    all: ["ricover*"],
    unless: ["hangar", "aere*", "aeromobil*", "velivol*", "elicotter*", "veicol*", "mezz*", "aviogett*", "jet", "flotta", "parcheggi*", "deposit*"],
  },
  ...["stat*", "condizion*", "problem*", "motiv*"].map((stem): LexiconRule => ({ term: "stato di salute", category: "sanitario", all: [stem, "salute"] })),
  { term: "diagnosi", category: "sanitario", all: ["diagnos*"] },
  { term: "patologia", category: "sanitario", all: ["patolog*"] },
  { term: "terapia", category: "sanitario", all: ["terapi*"] },
  { term: "terapia", category: "sanitario", all: ["terapeut*"] },
  { term: "terapia", category: "sanitario", all: ["therap*"] },
  { term: "farmaco", category: "sanitario", all: ["farmac*"] },
  { term: "invalidità", category: "sanitario", all: ["invalidit*"] },
  // «invalido» da solo o riferito a una persona; «data invalida» o l'inglese «invalid» no.
  ...["invalido", "invalida", "invalidi", "invalide"].map(
    (word): LexiconRule => ({ term: "invalidità", category: "sanitario", all: [word], context: { alone: true, qualifiers: PERSON_QUALIFIERS } }),
  ),
  // «disabilità» sì, «disabilitato» (funzione spenta) no.
  ...["disabilita", "disabile", "disabili", "disability", "disabilities"].map(
    (word): LexiconRule => ({ term: "disabilità", category: "sanitario", all: [word] }),
  ),
  { term: "handicap", category: "sanitario", all: ["handicap*"] },
  { term: "allergia", category: "sanitario", all: ["allerg*"] },
  { term: "idoneità psicofisica", category: "sanitario", all: ["psicofisic*"] },
  { term: "ospedale", category: "sanitario", all: ["ospedal*"] },
  { term: "ospedale", category: "sanitario", all: ["hospital*"] },
  { term: "clinico", category: "sanitario", all: ["clinic*"] },
  { term: "sintomi", category: "sanitario", all: ["sintom*"] },
  { term: "sintomi", category: "sanitario", all: ["symptom*"] },
  { term: "vaccino", category: "sanitario", all: ["vaccin*"] },
  { term: "psicologo", category: "sanitario", all: ["psicolog*"] },
  { term: "psichiatra", category: "sanitario", all: ["psichiatr*"] },
  { term: "psicologo", category: "sanitario", all: ["psych*"] },
  { term: "gravidanza", category: "sanitario", all: ["gravidanz*"] },
  { term: "gravidanza", category: "sanitario", all: ["incinta"] },
  { term: "gravidanza", category: "sanitario", all: ["pregnan*"] },
  { term: "maternità", category: "sanitario", all: ["maternita"] },
  { term: "infortunio", category: "sanitario", all: ["infortun*"] },
  { term: "infortunio", category: "sanitario", all: ["injur*"] },
  { term: "malattia", category: "sanitario", all: ["disease*"] },
  { term: "malattia", category: "sanitario", all: ["illness*"] },
  { term: "malattia", category: "sanitario", all: ["sick*"] },
];

const SPECIAL: readonly LexiconRule[] = [
  { term: "religione", category: "particolare", all: ["relig*"], headerOnly: true },
  { term: "origine etnica", category: "particolare", all: ["etni*"], headerOnly: true },
  { term: "origine etnica", category: "particolare", all: ["ethnic*"], headerOnly: true },
  { term: "origine etnica", category: "particolare", all: ["razza"], headerOnly: true },
  { term: "orientamento sessuale", category: "particolare", all: ["orientament*", "sessual*"], window: 3, headerOnly: true },
  { term: "orientamento sessuale", category: "particolare", all: ["sexual*"], headerOnly: true },
  { term: "opinioni politiche", category: "particolare", all: ["orientament*", "politic*"], window: 3, headerOnly: true },
  { term: "opinioni politiche", category: "particolare", all: ["opinion*", "politic*"], window: 3, headerOnly: true },
  { term: "iscrizione sindacale", category: "particolare", all: ["sindacat*"], headerOnly: true },
  { term: "iscrizione sindacale", category: "particolare", all: ["union"], context: { qualifiers: ["trade", "member*"] }, headerOnly: true },
  { term: "dati genetici", category: "particolare", all: ["genetic*"], headerOnly: true },
  { term: "dati biometrici", category: "particolare", all: ["biometri*"], headerOnly: true },
];

const PERSONAL: readonly LexiconRule[] = [
  { term: "cognome", category: "personale", all: ["cognom*"] },
  { term: "cognome", category: "personale", all: ["surname*"] },
  { term: "cognome", category: "personale", all: ["last", "name"] },
  { term: "cognome", category: "personale", all: ["family", "name"] },
  { term: "nominativo", category: "personale", all: ["nominativ*"] },
  { term: "nome", category: "personale", all: ["nome"], context: { alone: true, qualifiers: PERSON_QUALIFIERS } },
  { term: "nome", category: "personale", all: ["nomi"], context: { alone: true, qualifiers: PERSON_QUALIFIERS } },
  { term: "nome", category: "personale", all: ["name"], context: { alone: true, qualifiers: PERSON_QUALIFIERS } },
  { term: "nome", category: "personale", all: ["names"], context: { alone: true, qualifiers: PERSON_QUALIFIERS } },
  { term: "nome", category: "personale", all: ["firstname*"] },
  { term: "nome", category: "personale", all: ["fullname*"] },
  { term: "passaporto", category: "personale", all: ["passaport*"] },
  { term: "passaporto", category: "personale", all: ["passport*"] },
  { term: "documento d'identità", category: "personale", all: ["document*", "identit*"], window: 3 },
  { term: "documento d'identità", category: "personale", all: ["carta", "identit*"], window: 3 },
  { term: "data di nascita", category: "personale", all: ["nascit*"] },
  { term: "data di nascita", category: "personale", all: ["birth*"] },
  { term: "data di nascita", category: "personale", all: ["dob"] },
  { term: "data di nascita", category: "personale", all: ["compleanno"] },
  { term: "codice fiscale", category: "personale", all: ["codice", "fiscal*"] },
  { term: "codice fiscale", category: "personale", all: ["codicefiscale"] },
  { term: "codice fiscale", category: "personale", all: ["cf"], context: { alone: true, qualifiers: PERSON_QUALIFIERS } },
  { term: "codice fiscale", category: "personale", all: ["ssn"] },
  { term: "email", category: "personale", all: ["email*"] },
  { term: "email", category: "personale", all: ["mail"] },
  { term: "email", category: "personale", all: ["pec"] },
  { term: "telefono", category: "personale", all: ["telefon*"] },
  { term: "telefono", category: "personale", all: ["cellular*"] },
  { term: "telefono", category: "personale", all: ["phone*"] },
  { term: "telefono", category: "personale", all: ["smartphone*"] },
  { term: "telefono", category: "personale", all: ["tel"], context: { alone: true, qualifiers: PERSON_QUALIFIERS } },
  { term: "telefono", category: "personale", all: ["cell"], context: { alone: true, qualifiers: PERSON_QUALIFIERS } },
  { term: "indirizzo", category: "personale", all: ["indirizz*"], unless: ["ip", "web", "url", "sito", "server", "mac", "memoria", "rete"] },
  { term: "indirizzo", category: "personale", all: ["address*"], unless: ["ip", "web", "url", "server", "mac", "memory", "network"] },
  { term: "indirizzo", category: "personale", all: ["residenz*"] },
  { term: "indirizzo", category: "personale", all: ["domicili*"] },
  { term: "iban", category: "personale", all: ["iban"] },
  { term: "sesso", category: "personale", all: ["sesso"] },
  { term: "sesso", category: "personale", all: ["gender"] },
];

const ALL_RULES: readonly LexiconRule[] = [...HEALTH, ...SPECIAL, ...PERSONAL];

function stemMatches(stem: string, token: string): boolean {
  return stem.endsWith("*") ? token.startsWith(stem.slice(0, -1)) : token === stem;
}

function anyNear(tokens: readonly string[], stems: readonly string[], from: number, to: number): boolean {
  const start = Math.max(0, from);
  const end = Math.min(tokens.length - 1, to);
  for (let i = start; i <= end; i++) if (stems.some((s) => stemMatches(s, tokens[i]))) return true;
  return false;
}

const QUALIFIER_WINDOW = 4;
const UNLESS_WINDOW = 2;

/**
 * Posizioni (indice del primo token) in cui la regola vale.
 * - `header`: i qualificatori valgono ovunque nell'intestazione; `alone` vale.
 * - `text`: i qualificatori valgono entro 4 token; `alone` non vale.
 */
/**
 * La regola vale con la prima radice al token `i`? Restituisce l'indice del
 * primo token coinvolto, oppure -1.
 * - `header`: i qualificatori valgono ovunque nell'intestazione; `alone` vale.
 * - `text`: i qualificatori valgono entro 4 token; `alone` non vale.
 */
function matchAt(rule: LexiconRule, tokens: readonly string[], i: number, mode: "header" | "text"): number {
  const window = rule.window ?? rule.all.length;
  if (!stemMatches(rule.all[0], tokens[i])) return -1;
  let lo = i;
  let hi = i;
  for (let s = 1; s < rule.all.length; s++) {
    const stem = rule.all[s];
    let found = -1;
    for (let j = Math.max(0, i - window + 1); j <= Math.min(tokens.length - 1, i + window - 1); j++) {
      if (j !== i && stemMatches(stem, tokens[j])) {
        found = j;
        break;
      }
    }
    if (found < 0) return -1;
    lo = Math.min(lo, found);
    hi = Math.max(hi, found);
  }
  if (hi - lo >= window) return -1;
  if (rule.unless && anyNear(tokens, rule.unless, lo - UNLESS_WINDOW, hi + UNLESS_WINDOW)) return -1;
  if (rule.context) {
    const qualifiers = rule.context.qualifiers;
    const alone = mode === "header" && rule.context.alone === true && tokens.length === rule.all.length;
    const qualified =
      mode === "header"
        ? tokens.some((t, k) => (k < lo || k > hi) && qualifiers.some((q) => stemMatches(q, t)))
        : anyNear(tokens, qualifiers, lo - QUALIFIER_WINDOW, lo - 1) || anyNear(tokens, qualifiers, hi + 1, hi + QUALIFIER_WINDOW);
    if (!alone && !qualified) return -1;
  }
  return lo;
}

function ruleMatches(rule: LexiconRule, tokens: readonly string[], mode: "header" | "text"): number {
  let hits = 0;
  for (let i = 0; i < tokens.length; i++) if (matchAt(rule, tokens, i, mode) >= 0) hits++;
  return hits;
}

/** Regole sanitarie per il testo, indicizzate sulle prime tre lettere della prima radice. */
const HEALTH_TEXT_INDEX: ReadonlyMap<string, readonly LexiconRule[]> = (() => {
  const index = new Map<string, LexiconRule[]>();
  for (const rule of HEALTH) {
    if (rule.headerOnly) continue;
    const key = rule.all[0].replace(/\*$/, "").slice(0, 3);
    index.set(key, [...(index.get(key) ?? []), rule]);
  }
  return index;
})();

export interface LexiconMatch {
  category: Exclude<HeaderCategory, "vietata">;
  term: string;
}

/** Etichette per le voci del lessico delle risposte (mai il testo trovato). */
const ANSWER_HEALTH_LABEL: Readonly<Record<string, string>> = {
  medic: "medico",
  sanitar: "sanitario",
  malatti: "malattia",
  malat: "malattia",
  diagnos: "diagnosi",
  patolog: "patologia",
  terapi: "terapia",
  terapeut: "terapia",
  farmac: "farmaco",
  invalidit: "invalidità",
  disabilit: "disabilità",
  handicap: "handicap",
  gravidanz: "gravidanza",
  allergi: "allergia",
  ricover: "ricovero",
  sintom: "sintomi",
  vaccin: "vaccino",
  psicolog: "psicologo",
  psichiatr: "psichiatra",
  psicofisic: "idoneità psicofisica",
  infortun: "infortunio",
  clinic: "clinico",
  sanguign: "gruppo sanguigno",
  covid: "covid",
};

/** Termini sanitari del lessico delle risposte, come etichette con conteggio. */
function answerHealthLabels(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const match of findAnswerHealthTerms(prepareText(text))) {
    const label = ANSWER_HEALTH_LABEL[match.id] ?? match.id;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return counts;
}

/**
 * Categorie e termini di un'intestazione di colonna (o di una cella delle
 * prime righe). Al più un termine per categoria e termine.
 */
export function classifyHeader(header: string): LexiconMatch[] {
  if (typeof header !== "string" || !header.trim() || header.length > MAX_HEADER_CHARS) return [];
  const tokens = significant(textTokens(header));
  if (tokens.length === 0) return [];
  const out: LexiconMatch[] = [];
  const seen = new Set<string>();
  for (const rule of ALL_RULES) {
    const key = `${rule.category}:${rule.term}`;
    if (seen.has(key)) continue;
    if (ruleMatches(rule, tokens, "header") > 0) {
      seen.add(key);
      out.push({ category: rule.category, term: rule.term });
    }
  }
  for (const term of answerHealthLabels(header).keys()) {
    if (seen.has(`sanitario:${term}`)) continue;
    seen.add(`sanitario:${term}`);
    out.push({ category: "sanitario", term });
  }
  return out;
}

export interface TextHealthFinding {
  term: string;
  count: number;
}

/** Oltre questa lunghezza il testo si controlla a blocchi (stessa regola, nessun limite di contenuto). */
const TEXT_CHUNK_CHARS = 1_000_000;

/**
 * Termini sanitari nel testo libero (celle, paragrafi, PDF). Solo etichette e
 * conteggi, mai il testo intorno. I blocchi si sovrappongono di 200 caratteri
 * per non perdere un termine a cavallo.
 */
export function findHealthTerms(text: string): TextHealthFinding[] {
  if (typeof text !== "string" || !text) return [];
  const counts = new Map<string, number>();
  for (let start = 0; start < text.length; start += TEXT_CHUNK_CHARS) {
    const chunk = text.slice(Math.max(0, start - 200), start + TEXT_CHUNK_CHARS);
    const tokens = significant(textTokens(chunk));
    const own = new Map<string, number>();
    for (let i = 0; i < tokens.length; i++) {
      const rules = HEALTH_TEXT_INDEX.get(tokens[i].slice(0, 3));
      if (!rules) continue;
      for (const rule of rules) if (matchAt(rule, tokens, i, "text") >= 0) own.set(rule.term, (own.get(rule.term) ?? 0) + 1);
    }
    // The answer lexicon too: the same occurrence counts once per label (the larger count wins).
    for (const [term, n] of answerHealthLabels(chunk)) own.set(term, Math.max(own.get(term) ?? 0, n));
    for (const [term, n] of own) counts.set(term, (counts.get(term) ?? 0) + n);
  }
  return [...counts.entries()].map(([term, count]) => ({ term, count })).sort((a, b) => a.term.localeCompare(b.term));
}

// ── Colonne vietate ───────────────────────────────────────────────────

/** Voci di `forbidden_columns` che indicano una categoria intera. */
const CATEGORY_ALIASES: Readonly<Record<string, HeaderCategory>> = {
  sanitari: "sanitario",
  sanitario: "sanitario",
  sanitaria: "sanitario",
  personali: "personale",
  personale: "personale",
  identificativi: "personale",
  particolari: "particolare",
};

const MAX_FORBIDDEN_PATTERNS = 200;
const MAX_HEADER_CHARS = 200;

interface ForbiddenPattern {
  label: string;
  stems: string[];
}

export interface CompiledForbidden {
  /** Categorie intere vietate (es. `personale` anche dopo A.8). */
  categories: ReadonlySet<HeaderCategory>;
  patterns: readonly ForbiddenPattern[];
}

/**
 * Compila `spec.forbidden_columns` e `forbidden_columns_patterns`. Una voce è
 * una categoria (`sanitari`, `personali`) oppure una sequenza di parole, con
 * `*` per un prefisso (`data_nascita`, `passaport*`). Nessuna espressione
 * regolare dal template: niente rischio di ReDoS.
 */
export function compileForbiddenColumns(entries: readonly string[] | null | undefined): CompiledForbidden {
  const categories = new Set<HeaderCategory>();
  const patterns: ForbiddenPattern[] = [];
  for (const entry of (entries ?? []).slice(0, MAX_FORBIDDEN_PATTERNS)) {
    if (typeof entry !== "string") continue;
    const label = entry.trim().slice(0, 120);
    if (!label) continue;
    const lower = label.toLowerCase();
    if (Object.hasOwn(CATEGORY_ALIASES, lower)) {
      categories.add(CATEGORY_ALIASES[lower]);
      continue;
    }
    const stems = label
      .split(/[\s_\-./]+/)
      .map((part) => {
        const wildcard = part.endsWith("*");
        const tokens = textTokens(wildcard ? part.slice(0, -1) : part);
        return tokens.length === 0 ? [] : [...tokens.slice(0, -1), wildcard ? `${tokens[tokens.length - 1]}*` : tokens[tokens.length - 1]];
      })
      .flat()
      .filter((t) => !STOPWORDS.has(t.replace(/\*$/, "")));
    if (stems.length > 0 && stems.length <= 8) patterns.push({ label, stems });
  }
  return { categories, patterns };
}

/**
 * Parole che da sole sono ambigue: un modello vietato fatto solo di una di
 * queste segue la stessa regola del lessico (da sola o con un qualificatore
 * di persona), così il modello `nome` non scarta `nome_aeroporto`.
 */
const AMBIGUOUS_SINGLE = new Set(["nome", "nomi", "name", "names", "cf", "tel", "cell"]);

function matchesPattern(pattern: ForbiddenPattern, tokens: readonly string[]): boolean {
  if (pattern.stems.length === 1 && AMBIGUOUS_SINGLE.has(pattern.stems[0])) {
    if (!tokens.includes(pattern.stems[0])) return false;
    return tokens.length === 1 || tokens.some((t) => t !== pattern.stems[0] && PERSON_QUALIFIERS.some((q) => stemMatches(q, t)));
  }
  outer: for (let i = 0; i + pattern.stems.length <= tokens.length; i++) {
    for (let k = 0; k < pattern.stems.length; k++) if (!stemMatches(pattern.stems[k], tokens[i + k])) continue outer;
    return true;
  }
  return false;
}

/** Etichette dei modelli vietati che corrispondono all'intestazione. */
export function forbiddenMatches(header: string, compiled: CompiledForbidden): string[] {
  if (compiled.patterns.length === 0 || typeof header !== "string" || header.length > MAX_HEADER_CHARS) return [];
  const tokens = significant(textTokens(header));
  if (tokens.length === 0) return [];
  return compiled.patterns.filter((p) => matchesPattern(p, tokens)).map((p) => p.label);
}

// ── Valori ────────────────────────────────────────────────────────────

export const PERSONAL_VALUE_KINDS = ["email", "codice_fiscale", "iban", "telefono"] as const;
export type PersonalValueKind = (typeof PERSONAL_VALUE_KINDS)[number];

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}/;
const CF_CANDIDATE = /(?:^|[^A-Za-z0-9])([A-Za-z]{6}[0-9LMNPQRSTUVlmnpqrstuv]{2}[ABCDEHLMPRSTabcdehlmprst][0-9LMNPQRSTUVlmnpqrstuv]{2}[A-Za-z][0-9LMNPQRSTUVlmnpqrstuv]{3}[A-Za-z])(?![A-Za-z0-9])/g;
const IBAN_CANDIDATE = /(?:^|[^A-Za-z0-9])([A-Za-z]{2}\d{2}[A-Za-z0-9 ]{11,44})/g;
const PHONE_INTERNATIONAL = /^(?:\+|00)\d{1,3}(?:[\s./-]?\(?\d{1,5}\)?){2,6}$/;
const PHONE_IT_MOBILE = /^(?:3\d{2}[\s./-]?\d{6,7}|3\d{2}[\s./-]\d{3}[\s./-]?\d{3,4})$/;
const PHONE_IT_LANDLINE = /^0\d{1,3}[\s./-]\d{3,4}[\s./-]?\d{0,4}$/;

/** Valori dei caratteri in posizione dispari (1ª, 3ª, …) per il carattere di controllo del codice fiscale. */
const CF_ODD: Readonly<Record<string, number>> = {
  "0": 1, "1": 0, "2": 5, "3": 7, "4": 9, "5": 13, "6": 15, "7": 17, "8": 19, "9": 21,
  A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18, N: 20, O: 11, P: 3, Q: 6,
  R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
};

/** Codice fiscale di persona fisica valido (forma e carattere di controllo, omocodie comprese). */
export function isValidCodiceFiscale(value: string): boolean {
  const cf = value.toUpperCase();
  if (!/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(cf)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const ch = cf[i];
    if (i % 2 === 0) sum += CF_ODD[ch];
    else sum += /\d/.test(ch) ? Number(ch) : ch.charCodeAt(0) - 65;
  }
  return String.fromCharCode(65 + (sum % 26)) === cf[15];
}

/** IBAN valido (lunghezza 15–34, controllo mod 97). */
export function isValidIban(value: string): boolean {
  const iban = value.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const digits = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}

function looksLikePhone(value: string): boolean {
  const v = value.trim();
  if (v.length < 8 || v.length > 24) return false;
  const digits = v.replace(/\D/g, "").length;
  if (digits < 8 || digits > 15) return false;
  // «00…» senza altro è spesso un codice: serve la lunghezza di un numero internazionale.
  if (v.startsWith("00") && digits < 11) return false;
  return PHONE_INTERNATIONAL.test(v) || PHONE_IT_MOBILE.test(v) || PHONE_IT_LANDLINE.test(v);
}

/** Un IBAN valido all'inizio del candidato (gli IBAN hanno lunghezze diverse per Paese). */
function ibanPrefix(candidate: string): boolean {
  const compact = candidate.replace(/ /g, "").toUpperCase();
  for (let length = Math.min(34, compact.length); length >= 15; length--) {
    if (!isValidIban(compact.slice(0, length))) continue;
    // The IBAN must end where a word ends: the next character, if any, is a space.
    const next = candidate.charAt(consumedLength(candidate, length));
    if (next === "" || next === " ") return true;
  }
  return false;
}

/** Caratteri del candidato (spazi compresi) che contengono i primi `compactLength` caratteri senza spazi. */
function consumedLength(candidate: string, compactLength: number): number {
  let seen = 0;
  for (let i = 0; i < candidate.length; i++) {
    if (candidate[i] !== " ") seen++;
    if (seen === compactLength) return i + 1;
  }
  return candidate.length;
}

/** Tipo di dato personale riconosciuto nel valore di una cella, oppure null. */
export function personalValueKind(value: string): PersonalValueKind | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (v.length < 6 || v.length > 2000) return null;
  if (v.includes("@") && EMAIL.test(v)) return "email";
  for (const m of v.matchAll(CF_CANDIDATE)) if (isValidCodiceFiscale(m[1])) return "codice_fiscale";
  for (const m of v.matchAll(IBAN_CANDIDATE)) if (ibanPrefix(m[1])) return "iban";
  if (looksLikePhone(v)) return "telefono";
  return null;
}

// ── Controllo delle tabelle ───────────────────────────────────────────

/** Una tabella estratta da CSV, XLSX, DOCX o PPTX. */
export interface CheckedTable {
  name?: string | null;
  rows: readonly (readonly string[])[];
}

export interface ColumnFinding {
  category: HeaderCategory;
  /** Etichetta del lessico o del modello vietato: mai il testo del file. */
  term: string;
  table: number;
  column: number;
  /** `intestazione` = parola nell'intestazione; `valori` = valori riconosciuti nella colonna. */
  source: "intestazione" | "valori";
  /** Per i valori: celle riconosciute. */
  count?: number;
}

export interface HeaderCheckOptions {
  /** Dati personali ammessi: scheda A.8 approvata e voce della zona personale. */
  personalAllowed: boolean;
  /** `spec.forbidden_columns` della voce più `forbidden_columns_patterns` del template. */
  forbiddenColumns?: readonly string[] | null;
  /** Righe in cima a ogni tabella in cui cercare intestazioni (righe di titolo prima dell'intestazione). */
  headerRows?: number;
  /** Righe in cui cercare valori personali. */
  valueRows?: number;
}

export interface HeaderCheckResult {
  /** Tutti gli esiti. */
  findings: ColumnFinding[];
  /** Gli esiti che fanno rifiutare il file con queste opzioni. */
  blocking: ColumnFinding[];
}

export const HEADER_CHECK_DEFAULTS = Object.freeze({ headerRows: 10, valueRows: 200 });

/** Una cella sembra un'intestazione: testo breve, non un numero. */
function headerLike(cell: string): boolean {
  const v = cell.trim();
  return v.length > 0 && v.length <= 80 && /[A-Za-zÀ-ÿ]/.test(v);
}

/** Celle con valori personali riconosciuti per colonna (prime `valueRows` righe di dati). */
function valueFindings(rows: readonly (readonly string[])[], table: number, valueRows: number): ColumnFinding[] {
  const perColumn = new Map<number, { nonEmpty: number; kinds: Map<PersonalValueKind, number> }>();
  const limit = Math.min(rows.length, valueRows + 1);
  for (let r = 0; r < limit; r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (typeof cell !== "string" || !cell.trim()) continue;
      let stats = perColumn.get(c);
      if (!stats) {
        stats = { nonEmpty: 0, kinds: new Map() };
        perColumn.set(c, stats);
      }
      stats.nonEmpty++;
      const kind = personalValueKind(cell);
      if (kind) stats.kinds.set(kind, (stats.kinds.get(kind) ?? 0) + 1);
    }
  }
  const out: ColumnFinding[] = [];
  for (const [column, stats] of perColumn) {
    for (const [kind, count] of stats.kinds) {
      // Un telefono si riconosce solo come colonna: almeno metà delle celle piene.
      if (kind === "telefono" && count * 2 < stats.nonEmpty) continue;
      out.push({ category: "personale", term: kind === "codice_fiscale" ? "codice fiscale" : kind, table, column, source: "valori", count });
    }
  }
  return out;
}

/**
 * Controlla intestazioni e valori delle tabelle. Sanitario, particolare e
 * vietato bloccano sempre; personale blocca se `personalAllowed` è falso o se
 * la voce vieta i dati personali.
 */
export function checkTables(tables: readonly CheckedTable[], options: HeaderCheckOptions): HeaderCheckResult {
  const headerRows = options.headerRows ?? HEADER_CHECK_DEFAULTS.headerRows;
  const valueRows = options.valueRows ?? HEADER_CHECK_DEFAULTS.valueRows;
  const forbidden = compileForbiddenColumns(options.forbiddenColumns);
  const findings: ColumnFinding[] = [];
  const seen = new Set<string>();
  const add = (finding: ColumnFinding) => {
    const key = `${finding.category}|${finding.term}|${finding.table}|${finding.column}|${finding.source}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(finding);
  };
  tables.forEach((table, t) => {
    let checked = 0;
    for (const row of table.rows) {
      if (checked >= headerRows) break;
      if (!row.some((cell) => typeof cell === "string" && cell.trim())) continue;
      checked++;
      row.forEach((cell, column) => {
        if (typeof cell !== "string" || !headerLike(cell)) return;
        for (const match of classifyHeader(cell)) add({ category: match.category, term: match.term, table: t, column, source: "intestazione" });
        for (const label of forbiddenMatches(cell, forbidden)) add({ category: "vietata", term: label, table: t, column, source: "intestazione" });
      });
    }
    for (const finding of valueFindings(table.rows, t, valueRows)) add(finding);
  });
  const blocking = findings.filter((f) => {
    if (f.category === "personale") return !options.personalAllowed || forbidden.categories.has("personale");
    return true;
  });
  return { findings, blocking };
}

/** Colonne da mascherare in una tabella: personali, sanitarie, particolari o vietate dall'intestazione. */
export function sensitiveColumns(header: readonly string[], forbiddenColumns?: readonly string[] | null): Set<number> {
  const forbidden = compileForbiddenColumns(forbiddenColumns);
  const out = new Set<number>();
  header.forEach((cell, column) => {
    if (typeof cell !== "string" || !cell.trim()) return;
    if (classifyHeader(cell).length > 0 || forbiddenMatches(cell, forbidden).length > 0) out.add(column);
  });
  return out;
}
