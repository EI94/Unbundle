/**
 * I tre comandi del contesto del cliente nella CLI (rilascio 9b, docs/contesto/RILASCIO-9b-COSTRUZIONE.md §2.5):
 * `unbundle contesto <ID> "domanda"`, `unbundle nota <file>` e `unbundle impara <ID> "…" --si`. Qui le regole che non
 * toccano il database: i corpi delle richieste, i testi delle risposte (le frasi sono quelle di `AGENT_CONTEXT_TEXT`) e gli
 * esiti delle funzioni di «Contesto» tradotti in risposte della CLI (stato HTTP, codice, messaggio, `Retry-After`).
 *
 * - **Solo «Per tutti» (D1).** La domanda la fa la rotta come chi non è di Lateral Space (`AGENT_VIEWER`): tra le fonti
 *   niente appunti, risposte dei referenti o decisioni. I testi che escono passano dai nomi da nascondere (`hide`).
 * - **`nota`:** il limite di 600 KB vale sui byte di `testo`, non sul corpo JSON, che pesa di più (gli a capo e le
 *   virgolette si scrivono con due caratteri). Un PDF, o un testo con caratteri nulli, non è testo.
 * - **`impara`:** solo con `confermato: true` (il sì della persona); una sezione che non c'è risponde con l'elenco.
 *
 * Modulo puro: import relativi `.ts`.
 */
import { CONTEXT_ASK_TIMEOUT_MS } from "../../ai/models.ts";
import { CONTEXT_TEXT } from "../../context/text.ts";
import { CONTEXT_LIMITS, CONTEXT_SECTIONS, type ContextSection } from "../../context/vocab.ts";
import { AGENT_CONTEXT_TEXT, slashDay } from "../../context/work/agent-text.ts";
import type { AskAnswer, AskSource } from "../../db/queries/context-ask.ts";
import type { LearningOutcome } from "../../db/queries/context-learning.ts";
import { CLI_CASE_NOT_FOUND, CLI_CONTEXT_UNAVAILABLE } from "./case-errors.ts";

/** I testi della CLI che il piano non scrive: dicono «caso», come gli altri testi della CLI. */
export const CLI_CONTEXT_TEXT = Object.freeze({
  /** `impara` con una sezione che non c'è. */
  unknownSection: (sections: readonly string[]) => `Sezione sconosciuta: una tra ${sections.join(", ")}.`,
});

// ─── Risposte d'errore ───────────────────────────────────────────────

/** Una risposta d'errore della CLI, ancora da scrivere: stato, codice, messaggio e intestazioni. */
export interface CliFailureSpec {
  status: number;
  code: string;
  message: string;
  headers: Readonly<Record<string, string>>;
}

/** `Retry-After` in secondi interi, almeno 1; un valore che non è un numero vale un minuto. */
export function retryAfterHeader(seconds: number): string {
  return String(Math.max(1, Math.ceil(Number.isFinite(seconds) ? seconds : 60)));
}

/** I messaggi per campo, uno dopo l'altro e senza ripetizioni; senza campi il messaggio dell'esito. */
function fieldMessages(failure: { message: string; fieldErrors?: Record<string, string> }): string {
  const messages = [...new Set(Object.values(failure.fieldErrors ?? {}).filter((m) => typeof m === "string" && m.trim() !== ""))];
  return messages.length > 0 ? messages.join(" ") : failure.message;
}

/**
 * Un no delle funzioni di «Contesto» (`ServiceResult`) per la CLI. `dati_non_validi` è 422 con i messaggi dei campi (un
 * nome in una frase, una frase troppo lunga, dati sanitari negli appunti); l'archivio spento è 503 con «Unbundle non
 * risponde»; un guasto è 503 da riprovare (`retryMessage`, se la rotta ne ha uno suo).
 */
export function cliContextFailure(failure: { error: string; message: string; fieldErrors?: Record<string, string> }, opts: { retryMessage?: string } = {}): CliFailureSpec {
  switch (failure.error) {
    case "permesso_mancante":
      return { status: 403, code: "permesso_negato", message: failure.message, headers: {} };
    case "non_trovato":
      return { status: 404, code: "non_trovato", message: CLI_CASE_NOT_FOUND, headers: {} };
    case "dati_non_validi":
      return { status: 422, code: "dati_non_validi", message: fieldMessages(failure), headers: {} };
    case "area_spenta":
      return CLI_CONTEXT_UNAVAILABLE;
    case "riprova":
      return { status: 503, code: "riprova", message: opts.retryMessage ?? failure.message, headers: { "Retry-After": "30" } };
    case "versione_superata":
    case "transizione_non_ammessa":
      return { status: 409, code: "conflitto", message: failure.message, headers: {} };
    default:
      return { status: 400, code: failure.error, message: failure.message, headers: {} };
  }
}

// ─── `unbundle contesto <ID> "domanda"` ──────────────────────────────

/**
 * Il tempo della CLI per una domanda (60 secondi, senza nuovi tentativi) e quello della rotta: al modello resta al più il
 * tempo di «Chiedi al contesto», e mai oltre i 50 secondi dall'arrivo della richiesta, così la risposta parte prima dei 60.
 */
export const CLI_ASK_BUDGET_MS = 50_000;
const ASK_MIN_MS = 5_000;

/** Il tempo per il modello, dato quanto è già passato dall'arrivo della richiesta. */
export function askTimeoutMs(elapsedMs: number): number {
  const left = CLI_ASK_BUDGET_MS - Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0);
  return Math.max(ASK_MIN_MS, Math.min(CONTEXT_ASK_TIMEOUT_MS, left));
}

/** Una fonte nella risposta della CLI, con i testi già coperti. */
export interface CliAskSource {
  n: number;
  tipo: AskSource["kind"];
  etichetta: string;
  data: string | null;
  brano: string;
}

/** Il risultato di una domanda per la CLI: il testo da stampare e i dati per gli script. */
export interface CliAskResponse {
  testo: string;
  dati: { stato: Exclude<AskAnswer["status"], "limite">; risposta: string | null; fonti: CliAskSource[] };
}

/** Dove sta una fonte: l'etichetta di Unbundle («Call 14 nov»), con il giorno per chi non lo porta già nell'etichetta. */
function sourceWhere(source: AskSource, label: string): string {
  const day = slashDay(source.date);
  if (source.kind === "fatto" || source.kind === "discovery" || !day) return label;
  return `${label} del ${day}`;
}

function cliSources(sources: readonly AskSource[], hide: (text: string) => string): CliAskSource[] {
  return sources.map((source) => ({ n: source.n, tipo: source.kind, etichetta: hide(source.label), data: source.date, brano: hide(source.excerpt) }));
}

/** Le righe delle fonti: «[1] Fatto · Call 14 nov · Il gestionale è SAP Business One.». */
function sourceLines(sources: readonly AskSource[], hide: (text: string) => string): string[] {
  return sources.map((source) => AGENT_CONTEXT_TEXT.ask.source(source.n, CONTEXT_TEXT.ask.kind[source.kind], sourceWhere(source, hide(source.label)), hide(source.excerpt)));
}

/**
 * La risposta di `unbundle contesto` (§2.5): «Risposta:», il testo, «Fonti:» con una riga per fonte; «Non lo sappiamo
 * ancora.»; senza l'ok ai fornitori di AI la frase dell'ok e i brani trovati; «Non ho trovato niente su questo.». Il
 * troppe-domande (`limite`) è un 429 della rotta, non passa da qui.
 */
export function askResponse(answer: Exclude<AskAnswer, { status: "limite" }>, hide: (text: string) => string): CliAskResponse {
  const A = AGENT_CONTEXT_TEXT.ask;
  switch (answer.status) {
    case "risposta": {
      const risposta = hide(answer.answer);
      return {
        testo: [A.answer, risposta, A.sources, ...sourceLines(answer.sources, hide)].join("\n"),
        dati: { stato: "risposta", risposta, fonti: cliSources(answer.sources, hide) },
      };
    }
    case "non_so":
      return { testo: A.unknown, dati: { stato: "non_so", risposta: null, fonti: cliSources(answer.sources, hide) } };
    case "solo_ricerca":
      return { testo: [A.searchOnly, ...sourceLines(answer.sources, hide)].join("\n"), dati: { stato: "solo_ricerca", risposta: null, fonti: cliSources(answer.sources, hide) } };
    default:
      return { testo: A.nothing, dati: { stato: "niente", risposta: null, fonti: [] } };
  }
}

// ─── `unbundle nota <file>` ──────────────────────────────────────────

/**
 * Quanto può pesare il corpo JSON di `nota`: due volte il testo (gli a capo, le tabulazioni, le virgolette e le barre si
 * scrivono con due caratteri), più titolo e campi. Il limite vero, sui byte del testo, lo controlla `parseNoteBody`.
 */
export const CLI_NOTE_BODY_BYTES = 2 * CONTEXT_LIMITS.cliNoteMaxBytes + 64 * 1024;

/** Gli appunti di `nota`, nella forma di `addContextNote` (che rifà la validazione e il controllo dei testi). */
export interface NoteRequest {
  title: string;
  occurredOn: string;
  body: string;
  participants: string | null;
  link: string | null;
}

/** I byte UTF-8 di un testo. */
function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/**
 * Il corpo di `nota`: `{ titolo, data?, testo, conChi?, link? }` (i facoltativi mancano, mai null). Senza `data` vale
 * `today`. Il testo oltre 600 KB è 413; un PDF, o un testo con caratteri nulli, 422: per tutti e due la frase di §2.5 («Il
 * file è troppo grande per la CLI, o non è testo…»). Il resto (titolo, data, lunghezze, link, dati sanitari) lo controlla
 * `addContextNote`.
 */
export function parseNoteBody(
  body: Record<string, unknown>,
  today: string,
): { ok: true; value: NoteRequest } | { ok: false; failure: CliFailureSpec } {
  const text = typeof body.testo === "string" ? body.testo : "";
  if (utf8Bytes(text) > CONTEXT_LIMITS.cliNoteMaxBytes) return { ok: false, failure: { status: 413, code: "troppo_grande", message: AGENT_CONTEXT_TEXT.note.tooBig, headers: {} } };
  if (/^﻿?\s*%PDF-/.test(text) || text.includes("\u0000")) return { ok: false, failure: { status: 422, code: "non_testo", message: AGENT_CONTEXT_TEXT.note.tooBig, headers: {} } };
  const optional = (value: unknown) => (typeof value === "string" ? value : null);
  return {
    ok: true,
    value: {
      title: typeof body.titolo === "string" ? body.titolo : "",
      occurredOn: body.data === undefined || body.data === null ? today : typeof body.data === "string" ? body.data : "",
      body: text,
      participants: optional(body.conChi),
      link: optional(body.link),
    },
  };
}

/** Quello che resta nel registro dell'idempotenza dopo `nota`: solo l'id della fonte e se è nata adesso. */
export interface NoteRecord extends Record<string, unknown> {
  fonte: string;
  nuova: boolean;
}

/** Dove la persona trova gli appunti: «Da confermare» di quella fonte, o il pannello della fonte in «Appunti». */
export function noteLinks(origin: string, workspaceId: string, sourceId: string): { proposals: string; source: string } {
  const base = `${origin.replace(/\/+$/, "")}/dashboard/${encodeURIComponent(workspaceId)}/contesto`;
  const id = encodeURIComponent(sourceId);
  return { proposals: `${base}/conferma?fonte=${id}`, source: `${base}?vista=appunti&fonte=${id}` };
}

/**
 * La risposta di `nota` (§2.5): «Appunti salvati: li leggo adesso…» con il link a «Da confermare»; gli stessi appunti già
 * salvati, «Questi appunti ci sono già» con il link alla fonte; senza l'ok ai fornitori di AI, «Appunti salvati. Per
 * leggerli con l'AI serve l'ok…». `consent`: l'ok c'è adesso.
 */
export function noteResponse(record: NoteRecord, i: { consent: boolean; origin: string; workspaceId: string }): { testo: string; dati: { fonte: string; nuova: boolean; link: string } } {
  const N = AGENT_CONTEXT_TEXT.note;
  const links = noteLinks(i.origin, i.workspaceId, record.fonte);
  if (!record.nuova) return { testo: N.duplicate(links.source), dati: { fonte: record.fonte, nuova: false, link: links.source } };
  if (!i.consent) return { testo: N.savedNoConsent, dati: { fonte: record.fonte, nuova: true, link: links.source } };
  return { testo: N.saved(links.proposals), dati: { fonte: record.fonte, nuova: true, link: links.proposals } };
}

// ─── `unbundle impara <ID> "…" --si` ─────────────────────────────────

/** La cosa imparata, nella forma di `addLearning` (che rifà lunghezze e controllo dei testi). */
export interface LearnRequest {
  text: string;
  section: ContextSection | undefined;
}

/**
 * Il corpo di `impara`: `{ caso, testo, sezione?, confermato: true }`. Senza `confermato: true` 400 `conferma` (la CLI non
 * chiama senza `--si`); una sezione che non c'è 400 `sezione`, con l'elenco di quelle che ci sono. Senza sezione,
 * `addLearning` usa «sistemi».
 */
export function parseLearnBody(body: Record<string, unknown>): { ok: true; value: LearnRequest } | { ok: false; failure: CliFailureSpec } {
  if (body.confermato !== true) return { ok: false, failure: { status: 400, code: "conferma", message: AGENT_CONTEXT_TEXT.learn.needYes, headers: {} } };
  let section: ContextSection | undefined;
  if (body.sezione !== undefined && body.sezione !== null) {
    const raw = typeof body.sezione === "string" ? body.sezione.trim().toLowerCase() : "";
    if (!(CONTEXT_SECTIONS as readonly string[]).includes(raw)) {
      return { ok: false, failure: { status: 400, code: "sezione", message: CLI_CONTEXT_TEXT.unknownSection(CONTEXT_SECTIONS), headers: {} } };
    }
    section = raw as ContextSection;
  }
  return { ok: true, value: { text: typeof body.testo === "string" ? body.testo : "", section } };
}

/** Quello che resta nel registro dell'idempotenza dopo `impara`: l'esito e l'id della proposta. */
export interface LearnRecord extends Record<string, unknown> {
  esito: "proposta" | "riconferma" | "gia_proposta";
  proposta: string | null;
}

/** L'esito di `addLearning` da tenere nel registro; il tetto del giorno non ci entra (è un 429, la chiave si libera). */
export function learnRecord(outcome: Exclude<LearningOutcome, { esito: "limite" }>): LearnRecord {
  return outcome.esito === "gia_proposta" ? { esito: "gia_proposta", proposta: null } : { esito: outcome.esito, proposta: outcome.proposalId };
}

/** La risposta di `impara` (§2.5): salvato come proposta, già in memoria (riconferma), già tra le proposte. */
export function learnResponse(record: LearnRecord): { testo: string; dati: { esito: LearnRecord["esito"]; proposta: string | null } } {
  const L = AGENT_CONTEXT_TEXT.learn;
  const testo = record.esito === "riconferma" ? L.known : record.esito === "gia_proposta" ? L.alreadyProposed : L.saved;
  return { testo, dati: { esito: record.esito, proposta: record.proposta } };
}

/** Il tetto del giorno di `impara`: 429 con il messaggio di §2.5 e `Retry-After`. */
export function learnLimitFailure(retryAfterSeconds: number): CliFailureSpec {
  return { status: 429, code: "limite", message: AGENT_CONTEXT_TEXT.learn.limit, headers: { "Retry-After": retryAfterHeader(retryAfterSeconds) } };
}

/** Troppe domande: 429 con il messaggio di §2.5 e `Retry-After`. */
export function askLimitFailure(retryAfterSeconds: number): CliFailureSpec {
  return { status: 429, code: "limite", message: AGENT_CONTEXT_TEXT.ask.limit, headers: { "Retry-After": retryAfterHeader(retryAfterSeconds) } };
}
