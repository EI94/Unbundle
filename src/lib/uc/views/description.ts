/**
 * Descrizione del caso a blocchi (PIANO §5.1, D17; DESIGN §3.7.1): i blocchi
 * della specifica, quelli del seed e «Uso previsto».
 *
 * `uc_cases.description` è un oggetto JSON con una chiave per blocco. Qui:
 * - l'elenco dei blocchi noti con titolo, tipo e campi; le 8 chiavi della
 *   specifica (`problema`, `cosa_fa`, `cosa_non_fa`, `chi_lo_usa`, `esempio`,
 *   `decisioni`, `evoluzioni`, `riferimenti`) valgono come i blocchi del seed:
 *   `cosa_fa` → «La soluzione», `chi_lo_usa` → «Per chi cambia qualcosa»,
 *   `evoluzioni` → la colonna «Fuori contratto» del perimetro;
 * - la pagina di lettura (`descriptionView`): sei blocchi in vista, gli altri
 *   in «Altro» (chiuso), le leve in Valore e le fasi nelle Tappe della
 *   Panoramica; i blocchi vuoti solo a chi modifica; testi senza codici dei
 *   fatti né chiavi dei KPI e, per il cliente, senza articoli di contratto;
 * - la lettura tollerante di ogni blocco (un blocco malformato non rompe la
 *   pagina: si mostra quello che si legge);
 * - la normalizzazione di un blocco modificato (limiti di lunghezza, righe vuote
 *   tolte); la scansione dei testi la fa il comando sul server;
 * - le versioni da `description_history` (le più recenti per prime).
 *
 * Modulo puro e senza dipendenze di Node: si usa anche nell'editor client.
 */
import { fail, ok, type Json, type Result } from "../types.ts";
import { FORBIDDEN_RULES } from "./copy-guard.ts";
import { plainGateWord, plainPriorityWords, stripFactCodes, stripLegalRefs } from "./format.ts";
import type { Audience } from "./status-groups.ts";

export type DescriptionBlockKind = "testo" | "elenco" | "schede" | "perimetro";

export interface DescriptionField {
  key: string;
  label: string;
  multiline?: boolean;
}

export interface DescriptionBlockDef {
  key: string;
  title: string;
  kind: DescriptionBlockKind;
  /** Campi di ogni scheda (`schede`). */
  fields?: readonly DescriptionField[];
  /** Testo d'aiuto per chi scrive. */
  hint?: string;
  /** Il pulsante di un blocco vuoto, per chi modifica («Aggiungi un esempio concreto»). */
  add?: string;
  /** Elenco numerato come passi («Passo 1»). */
  steps?: boolean;
  /** Chiavi della specifica lette quando la chiave del blocco manca o è vuota. */
  aliases?: readonly string[];
}

export const DESCRIPTION_BLOCKS: readonly DescriptionBlockDef[] = [
  { key: "sottotitolo", title: "Sottotitolo", kind: "testo", hint: "Una riga sotto il nome del caso." },
  { key: "in_breve", title: "In breve", kind: "testo", hint: "Cosa fa il caso, in due o tre frasi.", add: "Scrivi «In breve»" },
  { key: "problema", title: "Il problema di oggi", kind: "testo", hint: "Come si lavora oggi e cosa non funziona, con i fatti.", add: "Aggiungi il problema di oggi" },
  { key: "come_funziona", title: "Come funziona", kind: "elenco", steps: true, hint: "Un passo per riga.", add: "Aggiungi i passi" },
  { key: "soluzione", title: "La soluzione", kind: "testo", hint: "Cosa fa la soluzione e cosa resta alla persona.", add: "Aggiungi la soluzione", aliases: ["cosa_fa"] },
  { key: "cosa_non_fa", title: "Cosa non fa", kind: "elenco", hint: "Una cosa per riga: i limiti chiari evitano attese sbagliate.", add: "Aggiungi cosa non fa" },
  {
    key: "per_chi",
    title: "Per chi cambia qualcosa",
    kind: "schede",
    aliases: ["chi_lo_usa"],
    fields: [
      { key: "ruolo", label: "Ruolo" },
      { key: "cosa_cambia", label: "Cosa cambia", multiline: true },
    ],
    add: "Aggiungi per chi cambia qualcosa",
  },
  {
    key: "leve",
    title: "Leve di valore",
    kind: "schede",
    fields: [
      { key: "leva", label: "Leva" },
      { key: "come", label: "Come", multiline: true },
      { key: "kpi", label: "Si misura con" },
    ],
  },
  { key: "esempio", title: "Un esempio concreto", kind: "testo", hint: "Con dati inventati, mai del cliente.", add: "Aggiungi un esempio concreto" },
  { key: "perimetro", title: "Perimetro", kind: "perimetro", hint: "Un punto per riga.", add: "Aggiungi il perimetro", aliases: ["evoluzioni"] },
  {
    key: "fasi",
    title: "Fasi",
    kind: "schede",
    fields: [
      { key: "fase", label: "Fase" },
      { key: "quando", label: "Quando" },
      { key: "cosa", label: "Cosa si fa", multiline: true },
      { key: "uscita", label: "Si chiude con", multiline: true },
    ],
  },
  { key: "prerequisiti", title: "Prima di partire", kind: "elenco", hint: "Una condizione per riga.", add: "Aggiungi cosa serve prima di partire" },
  {
    key: "rischi",
    title: "Rischi",
    kind: "schede",
    fields: [
      { key: "rischio", label: "Rischio" },
      { key: "mitigazione", label: "Come lo riduciamo", multiline: true },
    ],
    add: "Aggiungi un rischio",
  },
  {
    key: "uso_previsto",
    title: "Uso previsto e supervisione umana",
    kind: "testo",
    hint: "Chi usa la soluzione, per cosa, con quali limiti e chi controlla. Va scritto prima di mettere in uso la soluzione.",
    add: "Aggiungi uso previsto e supervisione umana",
  },
  {
    key: "decisioni",
    title: "Decisioni prese",
    kind: "schede",
    fields: [
      { key: "decisione", label: "Decisione", multiline: true },
      { key: "data", label: "Data" },
      { key: "chi", label: "Chi ha deciso (ruolo)" },
    ],
    add: "Aggiungi una decisione",
  },
  { key: "domande_aperte", title: "Domande aperte", kind: "elenco", hint: "Una domanda per riga.", add: "Aggiungi una domanda aperta" },
  { key: "riferimenti", title: "Riferimenti", kind: "elenco", hint: "Documenti, verbali, parti del contratto. Uno per riga.", add: "Aggiungi un riferimento" },
];

const BY_KEY = new Map(DESCRIPTION_BLOCKS.map((b) => [b.key, b]));
const ALIAS_KEYS = new Set(DESCRIPTION_BLOCKS.flatMap((b) => b.aliases ?? []));

/** Chiavi tecniche, mai mostrate come blocchi. Il titolo del caso sta nella testata. */
export const HIDDEN_DESCRIPTION_KEYS: readonly string[] = ["version", "titolo"];

/** I blocchi in vista, nell'ordine di DESIGN §3.7.1. */
export const DESCRIPTION_MAIN: readonly string[] = ["in_breve", "problema", "soluzione", "come_funziona", "cosa_non_fa", "esempio"];

/** I blocchi dentro «Altro» (chiuso), nell'ordine di DESIGN §3.7.1. */
export const DESCRIPTION_MORE: readonly string[] = ["per_chi", "perimetro", "prerequisiti", "rischi", "uso_previsto", "decisioni", "domande_aperte", "riferimenti"];

/** Quante righe si vedono prima di «Mostra tutti i 7 passi» e «Mostra tutto». */
export const DESCRIPTION_PREVIEW: Readonly<Record<string, number>> = { come_funziona: 5, cosa_non_fa: 3 };

export function descriptionBlockDef(key: string): DescriptionBlockDef | null {
  return BY_KEY.get(key) ?? null;
}

export type DescriptionRecord = Record<string, string>;

export type DescriptionContent =
  | { kind: "testo"; text: string | null }
  | { kind: "elenco"; items: string[] }
  | { kind: "schede"; records: DescriptionRecord[] }
  | { kind: "perimetro"; inside: string[]; evolution: string[] };

function str(v: unknown): string | null {
  if (typeof v === "string") return v.trim() ? v.trim() : null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function strings(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(str).filter((s): s is string => s !== null);
  const one = str(v);
  return one ? [one] : [];
}

/** Legge il blocco così com'è salvato; i valori che non si capiscono si saltano. */
export function readBlock(def: DescriptionBlockDef, raw: unknown): DescriptionContent {
  switch (def.kind) {
    case "testo":
      return { kind: "testo", text: Array.isArray(raw) ? strings(raw).join("\n") || null : str(raw) };
    case "elenco":
      return { kind: "elenco", items: strings(raw) };
    case "schede": {
      const fields = def.fields ?? [];
      const list = Array.isArray(raw) ? raw : (raw && typeof raw === "object") || typeof raw === "string" ? [raw] : [];
      const records: DescriptionRecord[] = [];
      for (const entry of list) {
        const rec: DescriptionRecord = {};
        if (typeof entry === "string") {
          if (entry.trim() && fields[0]) rec[fields[0].key] = entry.trim();
        } else if (entry && typeof entry === "object" && !Array.isArray(entry)) {
          for (const f of fields) {
            const v = str((entry as Record<string, unknown>)[f.key]);
            if (v) rec[f.key] = v;
          }
        }
        if (Object.keys(rec).length > 0) records.push(rec);
      }
      return { kind: "schede", records };
    }
    case "perimetro": {
      const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
      return { kind: "perimetro", inside: strings(o.caso_commerciale ?? o.dentro), evolution: strings(o.evoluzione) };
    }
  }
}

export function isEmptyContent(c: DescriptionContent): boolean {
  switch (c.kind) {
    case "testo":
      return !c.text;
    case "elenco":
      return c.items.length === 0;
    case "schede":
      return c.records.length === 0;
    case "perimetro":
      return c.inside.length === 0 && c.evolution.length === 0;
  }
}

export interface DescriptionBlockView {
  def: DescriptionBlockDef;
  content: DescriptionContent;
  empty: boolean;
}

/** Blocchi noti della descrizione, letti così come sono salvati. */
export function knownBlocks(description: Readonly<Record<string, unknown>>): Map<string, DescriptionBlockView> {
  const out = new Map<string, DescriptionBlockView>();
  for (const def of DESCRIPTION_BLOCKS) {
    const content = readBlock(def, blockRaw(def, description));
    out.set(def.key, { def, content, empty: isEmptyContent(content) });
  }
  return out;
}

/**
 * Valore salvato di un blocco: la sua chiave; se manca o è vuota, la chiave
 * della specifica (`aliases`). Per il perimetro `evoluzioni` riempie solo la
 * colonna «Fuori contratto» quando è vuota.
 */
export function blockRaw(def: DescriptionBlockDef, description: Readonly<Record<string, unknown>>): unknown {
  const own = description[def.key];
  const aliases = def.aliases ?? [];
  if (def.kind === "perimetro") {
    const content = readBlock(def, own);
    if (content.kind !== "perimetro" || content.evolution.length > 0) return own;
    const extra = aliases.map((a) => readBlock({ ...def, kind: "elenco" }, description[a])).find((c) => c.kind === "elenco" && c.items.length > 0);
    if (!extra || extra.kind !== "elenco") return own;
    return { caso_commerciale: content.inside, evoluzione: extra.items };
  }
  if (!isEmptyContent(readBlock(def, own))) return own;
  for (const a of aliases) if (!isEmptyContent(readBlock(def, description[a]))) return description[a];
  return own;
}

/** Blocchi che non conosciamo (es. aggiunti da un seed futuro): titolo dalla chiave e righe di testo. */
export function extraBlocks(description: Readonly<Record<string, unknown>>): { key: string; title: string; lines: string[] }[] {
  const out: { key: string; title: string; lines: string[] }[] = [];
  for (const [key, raw] of Object.entries(description)) {
    if (BY_KEY.has(key) || ALIAS_KEYS.has(key) || HIDDEN_DESCRIPTION_KEYS.includes(key)) continue;
    const lines: string[] = [];
    if (Array.isArray(raw)) {
      for (const entry of raw) {
        if (entry && typeof entry === "object" && !Array.isArray(entry)) {
          lines.push(
            Object.values(entry as Record<string, unknown>)
              .map(str)
              .filter((s): s is string => s !== null)
              .join(" · "),
          );
        } else {
          const s = str(entry);
          if (s) lines.push(s);
        }
      }
    } else if (raw && typeof raw === "object") {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        const values = strings(v);
        if (values.length) lines.push(`${humanKey(k)}: ${values.join("; ")}`);
      }
    } else {
      const s = str(raw);
      if (s) lines.push(s);
    }
    const shown = lines.filter((l) => l.trim());
    if (shown.length) out.push({ key, title: humanKey(key), lines: shown });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

function humanKey(key: string): string {
  const t = key.replace(/_/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : key;
}

// ── Pagina di lettura (DESIGN §3.7.1) ─────────────────────────────────

/** Chiave di un KPI (`kpi.servizio.tempo`), anche tra parentesi. */
const KPI_KEY = /\s*\(\s*kpi\.[a-z0-9_]+(?:\.[a-z0-9_]+)*\s*\)|\bkpi\.[a-z0-9_]+(?:\.[a-z0-9_]+)*/gi;

/** La regola delle chiavi del controllo dei testi (DESIGN §6.2): stessi prefissi, stesse eccezioni. */
const KEY_RULE = FORBIDDEN_RULES.find((r) => r.id === "chiave")!;
const KEY_SOURCE = KEY_RULE.pattern.source;
/**
 * Una chiave o un elenco di chiavi («src.a e src.b»), con lo spazio, il
 * separatore o il «vedi» che le precede sulla stessa riga: gli a capo restano.
 */
const KEY_LIST = new RegExp(String.raw`(?:[ \t]*[,;·/]?[ \t]*\b(?:[Vv]edi|[Cc]fr\.?)[ \t]+|[ \t]*[,;·/][ \t]*|[ \t]+)?(?:${KEY_SOURCE})(?:[ \t]*(?:,|;|\/|\be\b|\bo\b)[ \t]*(?:${KEY_SOURCE}))*`, "g");

function isItemKey(match: string): boolean {
  return KEY_RULE.accept ? KEY_RULE.accept(match) : true;
}

function hasItemKey(text: string): boolean {
  for (const m of text.matchAll(new RegExp(KEY_SOURCE, "g"))) if (isItemKey(m[0])) return true;
  return false;
}

/**
 * Toglie le chiavi delle voci da un testo per il cliente (DESIGN §1, principio
 * 3): una parentesi che ne contiene una se ne va tutta («(da compilare,
 * q.fonti.28)»); le altre si tolgono con il separatore che le precede. Nomi
 * di file e abbreviazioni restano, come nel controllo dei testi.
 */
export function stripItemKeys(text: string): string {
  if (!hasItemKey(text)) return text;
  const out = text
    .replace(/[ \t]*\([^()]*\)/g, (group) => (hasItemKey(group) ? "" : group))
    .replace(KEY_LIST, (list) => {
      const keys = [...list.matchAll(new RegExp(KEY_SOURCE, "g"))].map((m) => m[0]);
      if (keys.length > 0 && keys.every(isItemKey)) return "";
      return keys.filter(isItemKey).reduce((acc, k) => acc.replace(k, ""), list);
    });
  return out
    .replace(/\(\s*\)/g, "")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,;:!?)])/g, "$1")
    .replace(/\(\s*[,;]\s*/g, "(")
    .replace(/([,;:])\s*([.,;:)])/g, "$2")
    .replace(/(?:\s*·\s*){2,}/g, " · ")
    .replace(/^[\s·,;:]+|[\s·,;:]+$/g, "")
    .trim();
}

/**
 * Un testo della descrizione come lo legge chi guarda: mai codici dei fatti
 * («(F014)») né chiavi dei KPI; per il cliente nemmeno articoli di contratto,
 * la sigla della scheda privacy, chiavi delle voci o priorità in inglese
 * («must» → «indispensabile»). Gli spazi rimasti si sistemano.
 */
export function readableText(text: string, audience: Audience): string {
  let out = stripFactCodes(text);
  if (/\bkpi\./i.test(out)) {
    out = out
      .replace(KPI_KEY, "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/[ \t]+([.,;:!?)])/g, "$1")
      .replace(/:\s*$/g, "")
      .trim();
  }
  return audience === "cliente" ? stripItemKeys(plainGateWord(plainPriorityWords(stripLegalRefs(out)))) : out;
}

/**
 * Il titolo di una voce come lo legge chi guarda (`readableText`); se non
 * resta nulla, `fallback` (es. «Regola»), mai la chiave.
 */
export function readableTitle(title: string | null | undefined, audience: Audience, fallback: string): string {
  const t = title ? readableText(title, audience).trim() : "";
  return t || fallback;
}

function readableList(items: readonly string[], audience: Audience): string[] {
  return items.map((t) => readableText(t, audience)).filter((t) => t.trim() !== "");
}

/** Il contenuto di un blocco ripulito per chi guarda (le righe rimaste vuote si tolgono). */
export function readableContent(c: DescriptionContent, audience: Audience): DescriptionContent {
  switch (c.kind) {
    case "testo": {
      const text = c.text ? readableText(c.text, audience) : "";
      return { kind: "testo", text: text || null };
    }
    case "elenco":
      return { kind: "elenco", items: readableList(c.items, audience) };
    case "schede":
      return {
        kind: "schede",
        records: c.records
          .map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, readableText(v, audience)]).filter(([, v]) => v !== "")) as DescriptionRecord)
          .filter((r) => Object.keys(r).length > 0),
      };
    case "perimetro":
      return { kind: "perimetro", inside: readableList(c.inside, audience), evolution: readableList(c.evolution, audience) };
  }
}

export interface DescriptionView {
  /** I sei blocchi in vista: solo quelli con un contenuto (con `includeEmpty`, tutti). */
  main: DescriptionBlockView[];
  /** I blocchi di «Altro», con la stessa regola. */
  more: DescriptionBlockView[];
  /** Blocchi che non conosciamo: solo dentro «Altro». */
  extras: { key: string; title: string; lines: string[] }[];
  /** Non c'è niente da leggere: «La descrizione non c'è ancora.» */
  empty: boolean;
}

/**
 * La Descrizione da leggere (DESIGN §3.7.1): «In breve», il problema, la
 * soluzione, come funziona, cosa non fa e l'esempio in vista; il resto in
 * «Altro», blocchi ignoti compresi. Un blocco vuoto non si mostra; con
 * `includeEmpty` (chi sta modificando) sì, per riempirlo. I testi passano da
 * `readableText` per il pubblico di chi guarda.
 */
export function descriptionView(description: Readonly<Record<string, unknown>>, opts: { audience: Audience; includeEmpty?: boolean }): DescriptionView {
  const blocks = knownBlocks(description);
  const pick = (keys: readonly string[]) =>
    keys
      .map((k) => blocks.get(k)!)
      .map((b) => {
        const content = readableContent(b.content, opts.audience);
        return { def: b.def, content, empty: isEmptyContent(content) };
      })
      .filter((b) => opts.includeEmpty || !b.empty);
  const main = pick(DESCRIPTION_MAIN);
  const more = pick(DESCRIPTION_MORE);
  const extras = extraBlocks(description)
    .map((x) => ({ ...x, lines: readableList(x.lines, opts.audience) }))
    .filter((x) => x.lines.length > 0);
  const filled = (list: DescriptionBlockView[]) => list.some((b) => !b.empty);
  return { main, more, extras, empty: !filled(main) && !filled(more) && extras.length === 0 };
}

/** «Mostra tutti i 7 passi», «Mostra tutto»: il testo del pulsante che apre il resto di un elenco. */
export function showAllLabel(blockKey: string, total: number): string {
  return blockKey === "come_funziona" ? `Mostra tutti i ${total} passi` : "Mostra tutto";
}

// ── Modifica ──────────────────────────────────────────────────────────

export const DESCRIPTION_LIMITS = { text: 4000, itemsPerList: 100, item: 1000, records: 50, field: 1000 } as const;

function clipText(v: unknown, max: number, label: string): Result<string | null> {
  if (v === null || v === undefined) return ok(null);
  if (typeof v !== "string") return fail("dati_non_validi", `${label}: serve un testo.`);
  const t = v.replace(/\r\n?/g, "\n").trim();
  if (t.length > max) return fail("testo_troppo_lungo", `${label}: al massimo ${max} caratteri.`);
  return ok(t || null);
}

function cleanList(v: unknown, label: string): Result<string[]> {
  const raw = typeof v === "string" ? v.split("\n") : Array.isArray(v) ? v : v === null || v === undefined ? [] : null;
  if (!raw) return fail("dati_non_validi", `${label}: serve un elenco.`);
  const items: string[] = [];
  for (const entry of raw) {
    const t = clipText(typeof entry === "string" ? entry : entry === null || entry === undefined ? null : String(entry), DESCRIPTION_LIMITS.item, label);
    if (!t.ok) return t;
    if (t.value) items.push(t.value);
  }
  if (items.length > DESCRIPTION_LIMITS.itemsPerList) return fail("troppe_voci", `${label}: al massimo ${DESCRIPTION_LIMITS.itemsPerList} righe.`);
  return ok(items);
}

/**
 * Valore da salvare per un blocco noto, dall'editor: testo (o null), elenco di
 * righe non vuote, schede con i soli campi del blocco, perimetro con le due
 * colonne. Un blocco vuoto resta come chiave vuota (null o []).
 */
export function normalizeBlockInput(key: string, input: unknown): Result<Json> {
  const def = BY_KEY.get(key);
  if (!def) return fail("blocco_sconosciuto", "Questo blocco della descrizione non si modifica da qui.");
  switch (def.kind) {
    case "testo":
      return clipText(input, DESCRIPTION_LIMITS.text, def.title);
    case "elenco":
      return cleanList(input, def.title);
    case "schede": {
      if (input !== null && input !== undefined && !Array.isArray(input)) return fail("dati_non_validi", `${def.title}: servono le schede.`);
      const records: Json[] = [];
      for (const entry of (input as unknown[] | null | undefined) ?? []) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return fail("dati_non_validi", `${def.title}: scheda non valida.`);
        const rec: Record<string, Json> = {};
        for (const f of def.fields ?? []) {
          const t = clipText((entry as Record<string, unknown>)[f.key], DESCRIPTION_LIMITS.field, `${def.title} · ${f.label}`);
          if (!t.ok) return t;
          if (t.value) rec[f.key] = t.value;
        }
        if (Object.keys(rec).length > 0) records.push(rec);
      }
      if (records.length > DESCRIPTION_LIMITS.records) return fail("troppe_voci", `${def.title}: al massimo ${DESCRIPTION_LIMITS.records} schede.`);
      return ok(records);
    }
    case "perimetro": {
      const o = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
      const inside = cleanList(o.caso_commerciale ?? o.inside, "Dentro il perimetro");
      if (!inside.ok) return inside;
      const evolution = cleanList(o.evoluzione ?? o.evolution, "Fuori contratto");
      if (!evolution.ok) return evolution;
      return ok({ caso_commerciale: inside.value, evoluzione: evolution.value });
    }
  }
}

/** Valore salvato di un blocco, per l'editor (stessa forma di `normalizeBlockInput`). */
export function blockValueForEditor(def: DescriptionBlockDef, raw: unknown): Json {
  const c = readBlock(def, raw);
  switch (c.kind) {
    case "testo":
      return c.text;
    case "elenco":
      return c.items;
    case "schede":
      return c.records;
    case "perimetro":
      return { caso_commerciale: c.inside, evoluzione: c.evolution };
  }
}

/** JSON con le chiavi ordinate: due valori uguali danno lo stesso testo. */
export function stableJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
    .join(",")}}`;
}

/** Nuova descrizione con un blocco sostituito (le altre chiavi restano com'erano). */
export function withBlock(description: Readonly<Record<string, Json>>, key: string, value: Json): Record<string, Json> {
  return { ...description, [key]: value };
}

/** Chiavi dei blocchi che differiscono tra due versioni, in ordine alfabetico. */
export function changedBlocks(a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => !HIDDEN_DESCRIPTION_KEYS.includes(k) && stableJson(a[k]) !== stableJson(b[k])).sort();
}

/** Titolo di un blocco per l'elenco delle versioni. */
export function blockTitle(key: string): string {
  return BY_KEY.get(key)?.title ?? humanKey(key);
}

// ── Versioni ──────────────────────────────────────────────────────────

export interface DescriptionHistoryEntry {
  /** Quando questa versione è stata sostituita dalla successiva. */
  at: string | null;
  byUserId: string | null;
  description: Record<string, unknown>;
}

/** Righe di `description_history` (le più recenti per prime); le voci malformate si saltano. */
export function parseDescriptionHistory(raw: unknown): DescriptionHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: DescriptionHistoryEntry[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object" || Array.isArray(e)) continue;
    const r = e as Record<string, unknown>;
    const d = r.description;
    out.push({
      at: typeof r.at === "string" ? r.at : null,
      byUserId: typeof r.by_user_id === "string" ? r.by_user_id : null,
      description: d && typeof d === "object" && !Array.isArray(d) ? (d as Record<string, unknown>) : {},
    });
  }
  return out;
}

export interface DescriptionVersion {
  /** 1 = la più vecchia conservata; la più alta è quella attuale. */
  version: number;
  current: boolean;
  /** Quando è nata (null per la prima conservata: nasce con il caso o è la più vecchia rimasta). */
  createdAt: string | null;
  createdByUserId: string | null;
  /** Blocchi cambiati rispetto alla versione precedente. */
  changed: string[];
}

/**
 * Versioni della descrizione, dalla più recente. `history[i]` è la versione
 * `N-1-i` e porta data e autore del cambio che ha creato la versione `N-i`.
 */
export function descriptionVersions(current: Readonly<Record<string, unknown>>, history: readonly DescriptionHistoryEntry[]): DescriptionVersion[] {
  const n = history.length + 1;
  const descOf = (v: number): Readonly<Record<string, unknown>> => (v === n ? current : history[n - 1 - v].description);
  const out: DescriptionVersion[] = [];
  for (let v = n; v >= 1; v--) {
    const created = v > 1 ? history[n - v] : null;
    out.push({
      version: v,
      current: v === n,
      createdAt: created?.at ?? null,
      createdByUserId: created?.byUserId ?? null,
      changed: v > 1 ? changedBlocks(descOf(v), descOf(v - 1)) : [],
    });
  }
  return out;
}

/** Descrizione di una versione (`null` se il numero non esiste). */
export function descriptionAtVersion(current: Readonly<Record<string, unknown>>, history: readonly DescriptionHistoryEntry[], version: number): Readonly<Record<string, unknown>> | null {
  const n = history.length + 1;
  if (!Number.isInteger(version) || version < 1 || version > n) return null;
  return version === n ? current : history[n - 1 - version].description;
}

/**
 * La versione da leggere da `?versione=N`: null per quella attuale (anche se
 * il numero è quello attuale, oppure non è un numero).
 */
export function askedVersion(raw: string | string[] | undefined, currentVersion: number): number | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || !/^\d{1,3}$/.test(v)) return null;
  const n = Number(v);
  return n === currentVersion ? null : n;
}
