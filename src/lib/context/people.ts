/**
 * «Cerca una persona» (rilascio 9b, docs/contesto/RILASCIO-9b-COSTRUZIONE.md §2.13, §5.9): il nome o l'e-mail che
 * Lateral Space cerca nel contesto di un workspace quando una persona chiede di vedere, correggere o cancellare i suoi
 * dati, e come quel nome sparisce dai testi che restano.
 *
 * - `personTerm`: da 3 a 80 caratteri, con almeno 3 lettere. Un'e-mail o un nome, mai solo parole comuni («del», «il
 *   cliente»: `COMMON_WORDS`).
 * - `termInClientName`: per «Togli … da tutto», una parola sola che sta anche nel nome del cliente («Alfa» per «Alfa
 *   Ricambi»): si chiede nome e cognome, oppure l'e-mail.
 * - `personPattern`: l'espressione regolare, la stessa per Postgres (`~`, `regexp_replace`, `regexp_instr`) e per
 *   JavaScript, senza flag. Un nome si cerca come parola intera, senza badare a maiuscole e accenti: «Rossi» non prende
 *   «Rossini», «rossì» prende «Rossi», «De Luca» prende «de  luca» e «De Luca» a capo. Un'e-mail come testo esatto, senza
 *   badare alle maiuscole, mai dentro un indirizzo più lungo («anna@x.it» non prende «joanna@x.it»). Ogni carattere
 *   speciale di un'espressione regolare è protetto: quello che si scrive non è mai un'espressione. Maiuscole, accenti e
 *   confini di parola sono scritti per esteso nell'espressione: non dipendono dalla lingua del database.
 * - `replacePerson`: il nome diventa «una persona», come nel pacchetto (`redact`, src/lib/use-cases/factory/package.ts).
 * - `personSnippet`: il pezzo di testo intorno al nome trovato, con il nome a parte per evidenziarlo.
 * - `purgedNoteText`: la frase al posto del testo di un appunto cancellato, «dopo 12 mesi» solo se l'ha cancellato la
 *   conservazione e non «Togli … da tutto».
 *
 * Nel database l'espressione passa sempre come parametro, mai dentro l'SQL. Mai il termine nei log o nella storia.
 * Modulo puro: nessun modulo del server, lo usa anche il browser.
 */
import { CONTEXT_TEXT } from "./text.ts";
import { CONTEXT_LIMITS } from "./vocab.ts";

// ─── I testi che restano nel database ────────────────────────────────

/** Il nome tolto, nei testi che restano: come nel pacchetto. */
export const PERSON_PLACEHOLDER = "una persona";

/** Il titolo generico degli appunti tolti con «Togli … da tutto». `{data}`: il giorno della call, «14/11/2026». */
export const ERASED_NOTE_TITLE = "Appunti del {data}";

/** Il titolo generico di un appunto del giorno `occurredOn` (AAAA-MM-GG): «Appunti del 14/11/2026». */
export function erasedNoteTitle(occurredOn: string): string {
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(occurredOn ?? ""));
  return ERASED_NOTE_TITLE.replace("{data}", day ? `${day[3]}/${day[2]}/${day[1]}` : String(occurredOn ?? ""));
}

/**
 * La frase al posto del testo di un appunto cancellato (`textPurgedAt`), nel pannello della fonte. «Il testo è stato
 * cancellato dopo 12 mesi.» solo se l'ha fatto la conservazione (`purgeExpiredNoteText`: un appunto con più di 12 mesi
 * da `createdAt`, il titolo com'era). Dopo «Togli … da tutto» la frase neutra. Basta uno di due segni: il titolo
 * generico, che «Togli» scrive sempre (e il titolo di un appunto senza testo non cambia più), o il testo sparito prima
 * dei 12 mesi, che la conservazione non fa mai. Nel dubbio, o con una data che non si legge, la frase neutra: è sempre
 * vera.
 */
export function purgedNoteText(note: { title: string; occurredOn: string; createdAt: string | Date; textPurgedAt: string | Date | null }): string {
  const created = new Date(note.createdAt ?? Number.NaN).getTime();
  // La regola della conservazione, sul giorno in cui il testo è sparito: `created_at` prima di 12 mesi fa.
  const limit = new Date(note.textPurgedAt ?? Number.NaN);
  limit.setUTCMonth(limit.getUTCMonth() - CONTEXT_LIMITS.retentionMonths);
  const byRetention = note.title !== erasedNoteTitle(note.occurredOn) && created < limit.getTime();
  return byRetention ? CONTEXT_TEXT.notes.purged : CONTEXT_TEXT.notes.textErased;
}

// ─── Il termine ──────────────────────────────────────────────────────

export type PersonTerm = { ok: true; term: string; isEmail: boolean } | { ok: false; message: string };

/** Caratteri che non si vedono: di controllo, a larghezza zero, di direzione del testo, il trattino facoltativo. */
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f­​-‏‪-‮⁠-⁤]/g;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const LETTER = /\p{L}/gu;

/** Il termine come si cerca: composto (NFC), gli spazi ridotti a uno, senza caratteri invisibili. */
function cleanTerm(raw: string): string {
  return String(raw ?? "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .replace(INVISIBLE, "")
    .trim();
}

/**
 * Il nome o l'e-mail da cercare: da 3 a 80 caratteri, con almeno 3 lettere («Scrivi almeno 3 lettere.»). Un'e-mail
 * è un indirizzo intero (`nome@dominio.it`); tutto il resto è un nome, che non può essere fatto solo di parole comuni
 * («Questa parola è troppo comune: …»).
 */
export function personTerm(raw: string): PersonTerm {
  const term = cleanTerm(typeof raw === "string" ? raw : "");
  if ((term.match(LETTER)?.length ?? 0) < CONTEXT_LIMITS.personTermMin) return { ok: false, message: CONTEXT_TEXT.people.tooShort };
  if (term.length > CONTEXT_LIMITS.personTermMax) return { ok: false, message: CONTEXT_TEXT.errors.tooLong(CONTEXT_LIMITS.personTermMax) };
  const isEmail = EMAIL.test(term);
  if (!isEmail && nameWords(term).length === 0) return { ok: false, message: CONTEXT_TEXT.people.tooCommon };
  return { ok: true, term, isEmail };
}

// ─── L'espressione ───────────────────────────────────────────────────

/** I segni diacritici che si combinano con la lettera prima (un testo scomposto, NFD). */
const MARKS = "̀-ͯ";
/**
 * Che cosa conta come parte di una parola: cifre, lettere latine (anche accentate), greche e cirilliche, il trattino
 * basso, i segni che si combinano. Un nome comincia e finisce dove non c'è una di queste.
 */
const WORD = `0-9A-Za-z_ªµºÀ-ÖØ-öø-ɏͰ-ϿЀ-ӿḀ-῿${MARKS}`;
/** Gli spazi tra le parole di un nome: uno o più, anche un ritorno a capo o uno spazio che non va a capo. */
const SPACES = "[ \t\n\r\f\v   -     　]+";
/** Gli apostrofi, dritti e tipografici: «D'Angelo» prende «D’Angelo». */
const APOSTROPHES = "['‘’‚‛′´`ʼ]";
/** I trattini: «Rossi-Bianchi» prende «Rossi–Bianchi». Il trattino corto per primo: dentro le parentesi quadre è sé stesso. */
const HYPHENS = "[-‐‑‒–—―−]";
/** I caratteri speciali delle espressioni regolari, protetti con la barra rovesciata (in Postgres e in JavaScript). */
const SYNTAX = /[\\^$.|?*+()[\]{}]/;
const APOSTROPHE_CHARS = new Set(["'", "‘", "’", "‚", "‛", "′", "´", "`", "ʼ"]);
const HYPHEN_CHARS = new Set(["-", "‐", "‑", "‒", "–", "—", "―", "−"]);

/** Una lettera senza accenti e in minuscolo: «È» → «e». */
const fold = (ch: string) => ch.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Un carattere solo (una lettera può diventare due in maiuscolo: «ß» → «SS»). */
const single = (text: string) => Array.from(text).length === 1;

/**
 * Per ogni lettera senza accenti, le sue forme: maiuscola, minuscola, con gli accenti («e» → «eEèéêëÈÉÊË…»). Si
 * cercano tra le lettere latine, greche e cirilliche.
 */
const FORMS: ReadonlyMap<string, readonly string[]> = (() => {
  const forms = new Map<string, Set<string>>();
  const ranges: ReadonlyArray<readonly [number, number]> = [
    [0x41, 0x5a],
    [0x61, 0x7a],
    [0xc0, 0x24f],
    [0x370, 0x3ff],
    [0x400, 0x4ff],
    [0x1e00, 0x1fff],
  ];
  for (const [from, to] of ranges) {
    for (let code = from; code <= to; code++) {
      const ch = String.fromCharCode(code);
      if (!/\p{L}/u.test(ch)) continue;
      const key = fold(ch);
      if (!single(key)) continue;
      const set = forms.get(key) ?? new Set<string>();
      set.add(ch);
      forms.set(key, set);
    }
  }
  return new Map([...forms].map(([key, set]) => [key, [...set].sort()]));
})();

/** Le forme di una lettera del nome, tra parentesi quadre, e i segni che possono seguirla in un testo scomposto. */
function letterClass(ch: string): string {
  const key = fold(ch);
  const variants = new Set<string>(single(key) ? (FORMS.get(key) ?? []) : []);
  for (const form of [ch, ch.toLowerCase(), ch.toUpperCase(), key, key.toUpperCase()]) if (single(form)) variants.add(form);
  return `[${[...variants].sort().join("")}][${MARKS}]*`;
}

/** Un carattere del nome, nell'espressione. */
function namePart(ch: string): string {
  if (ch === " ") return SPACES;
  if (APOSTROPHE_CHARS.has(ch)) return APOSTROPHES;
  if (HYPHEN_CHARS.has(ch)) return HYPHENS;
  if (/\p{L}/u.test(ch)) return letterClass(ch);
  return SYNTAX.test(ch) ? `\\${ch}` : ch;
}

/** Un carattere dell'e-mail: le lettere senza badare alle maiuscole, il resto com'è (protetto se serve). */
function emailPart(ch: string): string {
  if (/^[A-Za-z]$/.test(ch)) return `[${ch.toLowerCase()}${ch.toUpperCase()}]`;
  if (/\p{L}/u.test(ch)) {
    const variants = new Set([ch, ch.toLowerCase(), ch.toUpperCase()].filter(single));
    return `[${[...variants].sort().join("")}]`;
  }
  return SYNTAX.test(ch) ? `\\${ch}` : ch;
}

/**
 * L'espressione di `term` per Postgres e JavaScript, senza flag. Un nome: parola intera, senza maiuscole e accenti. Un
 * indirizzo: testo esatto senza maiuscole, non preceduto da un carattere che può stare prima della chiocciola e non
 * seguito da uno che allunga il dominio («anna@x.it.» sì, «anna@x.it.com» no).
 */
export function personPattern(term: string): string {
  const clean = cleanTerm(term);
  const chars = Array.from(clean);
  if (EMAIL.test(clean)) {
    return `(?<![-0-9A-Za-z._%+'À-ɏ])${chars.map(emailPart).join("")}(?![-0-9A-Za-z_À-ɏ]|\\.[0-9A-Za-z])`;
  }
  return `(?<![${WORD}])${chars.map(namePart).join("")}(?![${WORD}])`;
}

/**
 * Il testo con il nome (o l'e-mail) sostituito da «una persona», ovunque compaia: come `regexp_replace(testo,
 * personPattern(term), 'una persona', 'g')` in Postgres. Un termine non valido non cambia niente.
 */
export function replacePerson(text: string, term: string): string {
  if (typeof text !== "string" || !text || !personTerm(term).ok) return text;
  return text.replace(new RegExp(personPattern(term), "g"), PERSON_PLACEHOLDER);
}

// ─── Le parole che non dicono chi è ──────────────────────────────────

/**
 * Le parole che da sole non indicano mai una persona: articoli, preposizioni (anche articolate ed elise: «dell'»,
 * «all'»), pronomi, congiunzioni, i titoli e le parole più comuni del lavoro con un cliente, «persona» compresa (il nome
 * tolto diventa «una persona»). Un termine fatto solo di queste, e di numeri, non si cerca: «Togli «del» da tutto»
 * svuoterebbe ogni appunto. Senza accenti e in minuscolo, come le confronta `nameWords`.
 */
const COMMON_WORDS: ReadonlySet<string> = new Set(
  [
    "il lo la i gli le l un uno una d di a ad da in con su per tra fra",
    "del dello della dei degli delle dell al allo alla ai agli alle all dal dallo dalla dai dagli dalle dall",
    "nel nello nella nei negli nelle nell sul sullo sulla sui sugli sulle sull col coi",
    "io tu lui lei noi voi loro me te se si ci vi mi ti ne li chi che cui quale quali",
    "mio mia miei mie tuo tua tuoi tue suo sua suoi sue nostro nostra nostri nostre vostro vostra vostri vostre",
    "questo questa questi queste quello quella quelli quelle e ed o od ma non come anche",
    "signor signore signora dott dottor dottore dottoressa ing avv",
    "cliente clienti azienda aziende societa ufficio uffici ditta gruppo persona persone referente responsabile",
  ]
    .join(" ")
    .split(" "),
);

/** Le parole di un nome che dicono chi è: le lettere tra spazi, apostrofi e trattini, senza le parole comuni e i numeri. */
function nameWords(term: string): string[] {
  return (cleanTerm(term).match(/[\p{L}\p{M}]+/gu) ?? []).filter((word) => !COMMON_WORDS.has(fold(word)));
}

/**
 * Vero se il termine, tolte le parole comuni, è una parola sola che sta anche nel nome del cliente (del workspace o
 * dell'organizzazione), come parola intera e senza badare a maiuscole e accenti: «Togli «Alfa» da tutto» per il cliente
 * «Alfa Ricambi» cancellerebbe il cliente ovunque. Vale solo per «Togli»: la ricerca resta larga. Un'e-mail mai.
 */
export function termInClientName(term: string, names: ReadonlyArray<string | null | undefined>): boolean {
  const checked = personTerm(term);
  if (!checked.ok || checked.isEmail) return false;
  const words = nameWords(checked.term);
  if (words.length !== 1) return false;
  const word = new RegExp(personPattern(words[0]));
  return names.some((name) => typeof name === "string" && word.test(name));
}

// ─── Il pezzo di testo trovato ───────────────────────────────────────

/** Un pezzo di testo intorno al nome: il nome sta in `match`, da evidenziare. */
export interface PersonSnippet {
  before: string;
  match: string;
  after: string;
}

/**
 * Il pezzo di testo intorno al nome, da quello che dà Postgres: la finestra, dove comincia il nome (`at`, da 0) e
 * quanti caratteri è lungo (`length`), contati come Postgres (punti di codice, non unità UTF-16); `head` e `tail`: il
 * testo continua prima o dopo la finestra. Gli spazi e i ritorni a capo diventano uno spazio; una parola tagliata ai
 * bordi si toglie e al suo posto c'è «…». null se le posizioni non tornano.
 */
export function personSnippet(part: { window: string | null; at: number; length: number; head: boolean; tail: boolean } | null | undefined): PersonSnippet | null {
  if (!part || typeof part.window !== "string") return null;
  const chars = Array.from(part.window);
  const at = Number(part.at);
  const length = Number(part.length);
  if (!Number.isInteger(at) || !Number.isInteger(length) || at < 0 || length < 1 || at + length > chars.length) return null;
  const flat = (text: string) => text.replace(/\s+/g, " ");
  let before = flat(chars.slice(0, at).join("")).trimStart();
  let after = flat(chars.slice(at + length).join("")).trimEnd();
  // Ai bordi della finestra la parola è quasi sempre tagliata a metà: si toglie.
  if (part.head) before = `…${before.replace(/^\S+/, "").trimStart()}`;
  if (part.tail) after = `${after.replace(/\S+$/, "").trimEnd()}…`;
  return { before, match: flat(chars.slice(at, at + length).join("")), after };
}
