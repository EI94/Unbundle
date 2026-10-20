/**
 * Scansione dei testi liberi (PIANO §3.10), prima di ogni salvataggio.
 *
 * Categorie:
 * - `sanitario` (blocca sempre): lessico di `health-terms.ts`, «visita medica» compresa;
 * - `discriminatorio` (blocca sempre): preferenze su genere, età, origine,
 *   religione, orientamento (`discrimination.ts`);
 * - `nome_persona`: nome e cognome, titolo e cognome, nomi del file privato
 *   bloccano; un nome isolato dà solo un avviso;
 * - `data_nascita`, `codice_fiscale` (bloccano sempre);
 * - `contatto` (email, telefono): bloccano nelle risposte e nei casi di prova,
 *   altrove sono un avviso.
 *
 * Nessuna esenzione generica. Solo per le voci con `spec.health_rule_question`
 * (le domande che chiedono la regola di esclusione dei dati sanitari) i termini
 * sanitari già presenti nel testo della domanda danno un avviso invece di
 * bloccare; restano bloccanti se stanno a non più di 6 parole da un nome o da
 * una persona (pilota, passeggero, equipaggio, comandante, primo ufficiale,
 * cliente…).
 *
 * Un risultato riporta solo la categoria e il termine (mai il testo intorno, mai
 * il nome o il numero trovato), più la posizione nel testo in NFC per
 * l'evidenziazione: si può registrare nei log.
 *
 * Modulo puro.
 */
import type { Json } from "../types.ts";
import { DISCRIMINATION_MESSAGE, PERSON_WORD, findDiscrimination } from "./discrimination.ts";
import { findHealthTerms, healthIds } from "./health-terms.ts";
import { findBirthDates, findEmails, findPersonNames, findPhones, findTaxCodes, type NameKind } from "./personal-data.ts";
import { prepareText, type PreparedText } from "./words.ts";

export const SCAN_CATEGORIES = ["sanitario", "discriminatorio", "nome_persona", "data_nascita", "codice_fiscale", "contatto"] as const;
export type ScanCategory = (typeof SCAN_CATEGORIES)[number];

export const SCAN_CONTEXTS = ["risposta", "commento", "caso_prova", "seed", "testo_ls"] as const;
export type ScanContext = (typeof SCAN_CONTEXTS)[number];

/** Categorie che nella bozza impediscono il salvataggio sul server (§3.10). */
export const HARD_BLOCK_CATEGORIES: readonly ScanCategory[] = ["sanitario", "discriminatorio"];

/** Distanza massima tra un termine sanitario e un nome o una persona (§3.10). */
export const HEALTH_PERSON_DISTANCE = 6;

/** Massimo di risultati per elenco: basta per l'interfaccia e per i file grandi. */
export const MAX_FINDINGS = 200;

export interface Finding {
  category: ScanCategory;
  /** Termine o tipo di dato trovato («visita medica», «donne», «email»): mai il dato personale. */
  term: string;
  /** Sottocategoria, per il discriminatorio («genere», «eta»…). */
  detail?: string;
  /** Posizione nel testo in NFC, per evidenziare. */
  start: number;
  end: number;
}

export interface ScanOptions {
  context: ScanContext;
  /** Solo per le voci con `spec.health_rule_question`. */
  healthRuleQuestion?: { questionText: string };
  /** Nomi da riconoscere sempre (file privato di redazione del seed). */
  names?: readonly string[];
}

export interface ScanResult {
  blocking: Finding[];
  warnings: Finding[];
}

const NAME_TERMS: Readonly<Record<NameKind, string>> = {
  nome_cognome: "nome e cognome",
  titolo_cognome: "titolo e cognome",
  nome_noto: "nome di persona",
  nome: "nome proprio",
};

const CONTACT_BLOCKING_CONTEXTS: ReadonlySet<ScanContext> = new Set(["risposta", "caso_prova"]);

/** Messaggio in italiano semplice per una categoria, da mostrare accanto al campo. */
export function findingMessage(category: ScanCategory): string {
  switch (category) {
    case "sanitario":
      return "Qui non raccogliamo dati sanitari (per esempio visite mediche, malattie, terapie). Riformula senza indicarli.";
    case "discriminatorio":
      return DISCRIMINATION_MESSAGE;
    case "nome_persona":
      return "Non scrivere nomi di persone: indica il ruolo, per esempio «il responsabile commerciale».";
    case "data_nascita":
      return "Non scrivere date di nascita.";
    case "codice_fiscale":
      return "Non scrivere codici fiscali.";
    case "contatto":
      return "Non scrivere email o numeri di telefono: indica il ruolo della persona.";
  }
}

function span(t: PreparedText, first: number, last: number): { start: number; end: number } {
  return { start: t.starts[first], end: t.ends[last] };
}

/** Voci del lessico sanitario presenti nel testo della domanda, se è una domanda sulla regola sanitaria. */
function questionHealthIds(opts: ScanOptions): Set<string> | null {
  const question = opts.healthRuleQuestion?.questionText;
  return typeof question === "string" ? healthIds(prepareText(question)) : opts.healthRuleQuestion ? new Set() : null;
}

/** Scansione di un testo (vedi l'intestazione del modulo). */
export function scanText(text: string, opts: ScanOptions): ScanResult {
  return scanWith(text, opts, questionHealthIds(opts));
}

function scanWith(text: string, opts: ScanOptions, questionIds: Set<string> | null): ScanResult {
  const blocking: Finding[] = [];
  const warnings: Finding[] = [];
  if (typeof text !== "string" || text.trim() === "") return { blocking, warnings };
  const t = prepareText(text);
  const push = (list: Finding[], f: Finding) => {
    if (list.length < MAX_FINDINGS) list.push(f);
  };

  // Nomi di persona (servono anche alla vicinanza dei termini sanitari).
  const names = findPersonNames(t, opts.names ?? []);
  const nameWords = new Set<number>();
  for (const m of names) {
    for (let i = m.first; i <= m.last; i++) nameWords.add(i);
    const f: Finding = { category: "nome_persona", term: NAME_TERMS[m.kind], ...span(t, m.first, m.last) };
    push(m.kind === "nome" ? warnings : blocking, f);
  }

  // Sanitario.
  const healthMatches = findHealthTerms(t);
  if (healthMatches.length > 0) {
    const nearPerson = (first: number, last: number) => {
      const from = Math.max(0, first - HEALTH_PERSON_DISTANCE);
      const to = Math.min(t.norms.length - 1, last + HEALTH_PERSON_DISTANCE);
      for (let j = from; j <= to; j++) {
        if (j >= first && j <= last) continue;
        if (nameWords.has(j) || PERSON_WORD.test(t.norms[j])) return true;
      }
      return false;
    };
    for (const m of healthMatches) {
      const f: Finding = { category: "sanitario", term: m.term, ...span(t, m.first, m.last) };
      const fromQuestion = questionIds !== null && m.ids.some((id) => questionIds.has(id));
      push(fromQuestion && !nearPerson(m.first, m.last) ? warnings : blocking, f);
    }
  }

  // Discriminatorio.
  for (const m of findDiscrimination(t)) {
    push(blocking, { category: "discriminatorio", term: m.term, detail: m.category, ...span(t, m.index, m.index) });
  }

  // Date di nascita e codici fiscali.
  for (const s of findBirthDates(t)) push(blocking, { category: "data_nascita", term: "data di nascita", ...s });
  for (const s of findTaxCodes(t.text)) push(blocking, { category: "codice_fiscale", term: "codice fiscale", ...s });

  // Contatti.
  const contactList = CONTACT_BLOCKING_CONTEXTS.has(opts.context) ? blocking : warnings;
  const emails = findEmails(t.text);
  for (const s of emails) push(contactList, { category: "contatto", term: "email", ...s });
  for (const s of findPhones(t.text)) {
    if (emails.some((e) => s.start < e.end && e.start < s.end)) continue;
    push(contactList, { category: "contatto", term: "telefono", ...s });
  }

  const byPosition = (a: Finding, b: Finding) => a.start - b.start || a.end - b.end;
  return { blocking: blocking.sort(byPosition), warnings: warnings.sort(byPosition) };
}

// ── Payload ──────────────────────────────────────────────────────────────

export type PathFinding = Finding & { path: string };

export interface PayloadScanOptions extends ScanOptions {
  /**
   * Categorie ammesse su un percorso preciso: per esempio il nome del collega in
   * una delega (`{ nome: ["nome_persona"] }`), che è un dato di contatto voluto.
   */
  exempt?: Readonly<Record<string, readonly ScanCategory[]>>;
}

export interface PayloadScanResult {
  blocking: PathFinding[];
  warnings: PathFinding[];
  /**
   * Il payload era troppo profondo o aveva troppe foglie e non è stato letto
   * tutto: chi salva deve rifiutarlo (nessuna parte resta senza controllo).
   */
  truncated: boolean;
}

/** Oltre ogni payload di risposta ammesso (§3.9: JSON ≤ 400.000 caratteri). */
export const MAX_DEPTH = 16;
export const MAX_LEAVES = 200_000;

function childPath(parent: string, key: string | number): string {
  if (typeof key === "number") return `${parent}[${key}]`;
  return parent === "" ? key : `${parent}.${key}`;
}

/** Nomi di campo che possono stare in un percorso (`other_text`, `rows`): il resto è testo dell'utente. */
const PATH_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/**
 * Segmento di percorso per una chiave d'oggetto. Una chiave che non è un nome di
 * campo (spazi, accenti, punteggiatura) è testo scritto dall'utente: nel percorso
 * diventa `{n}` (posizione della chiave), perché i percorsi finiscono negli
 * `Issue` e nei log, che non contengono mai il testo.
 */
function keySegment(key: string, index: number): string {
  return PATH_KEY.test(key) ? key : `{${index}}`;
}

/** Suffisso del percorso di una chiave d'oggetto letta come testo (`rows[0].visita#chiave`). */
export const KEY_PATH_SUFFIX = "#chiave";

/**
 * Ogni foglia stringa di un payload, con il suo percorso (`rows[2].prezzo`,
 * `text`). Con `keys` anche ogni chiave d'oggetto è una foglia (percorso con
 * `KEY_PATH_SUFFIX`): una bozza illeggibile si salva così com'è, chiavi
 * comprese, quindi anche le chiavi passano dalla scansione. `truncated` dice
 * che una parte non è stata visitata.
 */
export function walkStrings(payload: Json | unknown, options: { keys?: boolean } = {}): { leaves: { path: string; text: string }[]; truncated: boolean } {
  const out: { path: string; text: string }[] = [];
  let truncated = false;
  const seen = new Set<object>();
  const walk = (value: unknown, path: string, depth: number) => {
    if (out.length >= MAX_LEAVES || depth > MAX_DEPTH) {
      if (typeof value === "string" || (value !== null && typeof value === "object")) truncated = true;
      return;
    }
    if (typeof value === "string") {
      out.push({ path, text: value });
    } else if (value !== null && typeof value === "object") {
      if (seen.has(value)) return;
      seen.add(value);
      if (Array.isArray(value)) value.forEach((v, i) => walk(v, childPath(path, i), depth + 1));
      else {
        Object.entries(value as Record<string, unknown>).forEach(([k, v], index) => {
          const segment = childPath(path, keySegment(k, index));
          if (options.keys) {
            if (out.length >= MAX_LEAVES) {
              truncated = true;
              return;
            }
            out.push({ path: `${segment}${KEY_PATH_SUFFIX}`, text: k });
          }
          walk(v, segment, depth + 1);
        });
      }
    }
  };
  walk(payload, "", 0);
  return { leaves: out, truncated };
}

/** Le foglie stringa di un payload (vedi `walkStrings`). */
export function stringLeaves(payload: Json | unknown): { path: string; text: string }[] {
  return walkStrings(payload).leaves;
}

/**
 * Scansione di ogni foglia stringa del payload (celle delle tabelle, testo ed
 * eccezioni delle regole, `other_text`, note, motivo NA, `who_might_know`, nome
 * e messaggio della delega…) e di ogni chiave d'oggetto (intestazioni delle
 * tabelle, bozze illeggibili salvate così come sono).
 */
export function scanPayload(payload: Json | unknown, opts: PayloadScanOptions): PayloadScanResult {
  const blocking: PathFinding[] = [];
  const warnings: PathFinding[] = [];
  const questionIds = questionHealthIds(opts);
  const { leaves, truncated } = walkStrings(payload, { keys: true });
  for (const leaf of leaves) {
    const exempt = opts.exempt?.[leaf.path] ?? [];
    const r = scanWith(leaf.text, opts, questionIds);
    for (const f of r.blocking) if (!exempt.includes(f.category) && blocking.length < MAX_FINDINGS) blocking.push({ ...f, path: leaf.path });
    for (const f of r.warnings) if (!exempt.includes(f.category) && warnings.length < MAX_FINDINGS) warnings.push({ ...f, path: leaf.path });
  }
  return { blocking, warnings, truncated };
}

/** Vero se c'è un esito che nella bozza impedisce il salvataggio (sanitario o discriminatorio). */
export function hasHardBlock(findings: readonly Finding[]): boolean {
  return findings.some((f) => HARD_BLOCK_CATEGORIES.includes(f.category));
}

/** Conteggi per categoria, per gli eventi di audit (`{categoria: n}`), senza testo. */
export function summarizeFindings(findings: readonly Finding[]): Partial<Record<ScanCategory, number>> {
  const out: Partial<Record<ScanCategory, number>> = {};
  for (const f of findings) out[f.category] = (out[f.category] ?? 0) + 1;
  return out;
}

/** Risultati pronti per i log: solo categoria, termine e percorso. */
export function findingsForLog(findings: readonly (Finding & { path?: string })[]): { category: ScanCategory; term: string; path?: string }[] {
  return findings.map((f) => (f.path === undefined ? { category: f.category, term: f.term } : { category: f.category, term: f.term, path: f.path }));
}
