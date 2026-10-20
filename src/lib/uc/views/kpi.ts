/**
 * KPI del caso (DESIGN §3.8, `/valore/kpi`): come si misura il successo,
 * legato al conto.
 *
 * Due letture:
 * - la riga leggera di ogni KPI (`KpiRow`, `rowToKpiRow`): titolo, frase, leve
 *   e un puntino solo, calcolati nel database senza mandare al client i
 *   collegamenti (oggi 2.350 nel caso seedato). La lista si cerca e si
 *   raggruppa per leva sul server;
 * - la scheda completa di un KPI (`buildKpis`), per il pannello `?apri=<id>`:
 *   in vista cos'è, formula, unità, valore di partenza, obiettivo e misure; il
 *   resto in «Dettagli tecnici».
 *
 * Il puntino (`KpiReadiness`) dice a che punto è il KPI:
 * - «Pronto» (verde): definizione confermata e dati disponibili. La definizione
 *   è confermata se il KPI è validato oppure se una domanda `conferma_formula`
 *   collegata con `precisa` è validata; i dati sono disponibili se una fonte
 *   collegata (`alimentato_da`) ha disponibilità `oggi_export`;
 * - «Da confermare» (giallo): c'è una formula o metà del lavoro, manca il resto;
 * - «Da definire» (grigio): né formula né conferme.
 *
 * «Collegato al conto»: il KPI ha una riga del conto economico oppure lo usa una
 * riga del conto del caso (righe di beneficio, voce di costo). Avviso
 * anti-vanità: KPI indispensabile che non è collegato al conto e non è un KPI di
 * controllo.
 *
 * Misure: il valore sotto la soglia minima non arriva mai (arriva `NULL`).
 *
 * Modulo puro.
 */
import { rowBool, rowIsoDate, rowJson, rowNumber, rowObject, rowString, rowStringArray, rowVocab, type Row } from "../sql/readiness.ts";
import { ITEM_STATUSES, KPI_PHASES, LEVERS, PRIORITIES, isVocab, type CaseRole, type ItemStatus, type Lever, type Priority, type SemaforoColor } from "../vocab.ts";
import type { LinkedItem } from "./item-detail.ts";
import { formatDateIt, formatNumberIt, specText } from "./format.ts";
import { WORDS } from "./labels.ts";
import { buildModelItems, linkedItems, parseLinkRows, type ModelItemView } from "./model.ts";
import { UUID } from "../ids.ts";

export const DEFAULT_BASELINE = "da misurare";
export const DEFAULT_TARGET = "dopo il valore di partenza";

export type PnlView = { kind: "riga"; text: string } | { kind: "controllo" } | { kind: "da_indicare" };

export interface KpiMeasurementView {
  phase: string;
  period: string;
  value: string | null;
  suppressed: boolean;
  provisional: boolean;
}

// ── Puntino del KPI ───────────────────────────────────────────────────

export const KPI_READINESS = ["pronto", "da_confermare", "da_definire"] as const;
export type KpiReadiness = (typeof KPI_READINESS)[number];

export const KPI_READINESS_VIEW: Readonly<Record<KpiReadiness, { label: string; tone: SemaforoColor }>> = {
  pronto: { label: "Pronto", tone: "verde" },
  da_confermare: { label: "Da confermare", tone: "giallo" },
  da_definire: { label: "Da definire", tone: "grigio" },
};

/** «Pronto» con definizione e dati; «Da definire» senza formula né conferme; altrimenti «Da confermare». */
export function kpiReadiness(i: { definitionOk: boolean; dataOk: boolean; hasFormula: boolean }): KpiReadiness {
  if (i.definitionOk && i.dataOk) return "pronto";
  if (i.definitionOk || i.dataOk || i.hasFormula) return "da_confermare";
  return "da_definire";
}

export interface KpiView {
  item: ModelItemView;
  formula: string | null;
  formulaTech: string | null;
  unit: string | null;
  direction: string | null;
  granularity: string | null;
  dimensions: string | null;
  frequency: string | null;
  baseline: string;
  target: string;
  pnl: PnlView;
  definition: { ok: boolean; label: string };
  data: { ok: boolean; label: string };
  readiness: KpiReadiness;
  /** Indispensabile, senza riga del conto economico e non di controllo. */
  vanity: boolean;
  dataNeeded: LinkedItem[];
  sources: LinkedItem[];
  confirmQuestions: LinkedItem[];
  measurements: KpiMeasurementView[];
}

const PHASE_LABEL: Readonly<Record<(typeof KPI_PHASES)[number], string>> = { baseline: WORDS.valoreDiPartenza, backtest: WORDS.provaSulPassato, esercizio: "In uso" };

function truthy(v: string | undefined | null): boolean {
  return v !== undefined && v !== null && v !== "" && v !== "no" && v !== "false";
}

// ── Vocabolario: «baseline» e «backtest» (DESIGN §2.6) ────────────────

type Gender = "f" | "m";
type GNumber = "s" | "p";
/** Come comincia la parola che segue: consonante, «s» impura e simili, vocale («il valore», «lo stesso», «l'ultimo»). */
type Sound = "c" | "z" | "v";
type Forms = Readonly<Record<Sound, string>>;
type Slot = `${Gender}${GNumber}`;
/** Una parola che concorda con il nome: le sue forme per genere e numero. */
interface Agreeing {
  kind: "det" | "adj" | "pre";
  forms: Readonly<Partial<Record<Slot, Forms>>>;
}

const same = (w: string): Forms => ({ c: w, z: w, v: w });
const byForm = (c: string, z: string, v: string): Forms => ({ c, z, v });
const four = (kind: Agreeing["kind"], fs: string, ms: string, fp: string, mp: string): Agreeing => ({
  kind,
  forms: { fs: same(fs), ms: same(ms), fp: same(fp), mp: same(mp) },
});
/** Aggettivi regolari: radice + a, o, e, i. */
const regular = (kind: Agreeing["kind"], stems: readonly string[]) => stems.map((s) => four(kind, `${s}a`, `${s}o`, `${s}e`, `${s}i`));

/** Articoli, preposizioni articolate, dimostrativi, quantità e numeri. */
const DETERMINERS: readonly Agreeing[] = [
  ...(
    [
      ["la", "il", "lo", "l'", "le", "i", "gli"],
      ["della", "del", "dello", "dell'", "delle", "dei", "degli"],
      ["alla", "al", "allo", "all'", "alle", "ai", "agli"],
      ["dalla", "dal", "dallo", "dall'", "dalle", "dai", "dagli"],
      ["nella", "nel", "nello", "nell'", "nelle", "nei", "negli"],
      ["sulla", "sul", "sullo", "sull'", "sulle", "sui", "sugli"],
    ] as const
  ).map(
    ([fs, ms, msz, elided, fp, mp, mpz]): Agreeing => ({
      kind: "det",
      forms: { fs: byForm(fs, fs, elided), ms: byForm(ms, msz, elided), fp: same(fp), mp: byForm(mp, mpz, mpz) },
    }),
  ),
  { kind: "det", forms: { fs: byForm("una", "una", "un'"), ms: byForm("un", "uno", "un") } },
  // «col backtest» → «con la prova sul passato».
  { kind: "det", forms: { fs: same("con la"), ms: same("col"), fp: same("con le"), mp: same("coi") } },
  { kind: "det", forms: { fs: byForm("quella", "quella", "quell'"), ms: byForm("quel", "quello", "quell'"), fp: same("quelle"), mp: byForm("quei", "quegli", "quegli") } },
  four("det", "questa", "questo", "queste", "questi"),
  ...(["nessun", "ciascun"] as const).map((w): Agreeing => ({ kind: "det", forms: { fs: byForm(`${w}a`, `${w}a`, `${w}'`), ms: byForm(w, `${w}o`, w) } })),
  { kind: "det", forms: { fs: byForm("alcuna", "alcuna", "alcun'"), ms: byForm("alcun", "alcuno", "alcun"), fp: same("alcune"), mp: same("alcuni") } },
  ...(
    [
      ["molte", "molti"],
      ["poche", "pochi"],
      ["diverse", "diversi"],
      ["varie", "vari"],
      ["tante", "tanti"],
    ] as const
  ).map(([fp, mp]): Agreeing => ({ kind: "det", forms: { fp: same(fp), mp: same(mp) } })),
  // Numeri e «più» non cambiano, ma dicono che il nome va al plurale.
  ...["due", "tre", "quattro", "cinque", "sei", "sette", "otto", "nove", "dieci", "più"].map((w): Agreeing => ({ kind: "det", forms: { fp: same(w), mp: same(w) } })),
];

/** Davanti al nome, tra l'articolo e il nome: «la sua baseline», «una nuova baseline», «l'ultimo backtest». */
const BEFORE_NOUN: readonly Agreeing[] = [
  ...regular("adj", ["nuov", "prim", "second", "ultim", "stess", "altr", "ver", "vecchi", "nostr", "vostr", "relativ"]).map((a) =>
    // «vecchi» al maschile plurale, non «vecchii».
    a.forms.mp?.c === "vecchii" ? { ...a, forms: { ...a.forms, mp: same("vecchi") } } : a,
  ),
  four("adj", "sua", "suo", "sue", "suoi"),
  four("adj", "mia", "mio", "mie", "miei"),
  four("adj", "tua", "tuo", "tue", "tuoi"),
  four("adj", "propria", "proprio", "proprie", "propri"),
  four("adj", "loro", "loro", "loro", "loro"),
  { kind: "adj", forms: { fs: same("buona"), ms: byForm("buon", "buono", "buon"), fp: same("buone"), mp: same("buoni") } },
];

/** Dopo il nome: participi e aggettivi che concordano («la baseline misurata», «il backtest eseguito»). Mai «prima» o «secondo», che lì vogliono dire altro. */
const AFTER_NOUN: readonly Agreeing[] = [
  ...regular("adj", [
    "misurat", "calcolat", "stimat", "confermat", "rilevat", "definit", "validat", "aggiornat", "registrat", "osservat", "concordat", "fissat",
    "approvat", "previst", "raccolt", "corrett", "attes", "ottenut", "eseguit", "completat", "superat", "conclus", "fatt", "chius", "riuscit",
    "effettuat", "svolt", "positiv", "negativ", "nuov", "stess", "relativ", "consolidat", "certificat", "documentat", "condivis", "futur",
    "onest", "complet", "simulat", "successiv", "retrospettiv", "ricostruit", "ripetut", "separat", "dedicat", "aggiuntiv",
  ]),
  four("adj", "media", "medio", "medie", "medi"),
  four("adj", "propria", "proprio", "proprie", "propri"),
  four("adj", "provvisoria", "provvisorio", "provvisorie", "provvisori"),
  four("adj", "storica", "storico", "storiche", "storici"),
  four("adj", "specifica", "specifico", "specifiche", "specifici"),
];

/** «Tutta la», «tutti i»: davanti all'articolo. */
const PREDETERMINERS: readonly Agreeing[] = [four("pre", "tutta", "tutto", "tutte", "tutti")];

interface Found {
  word: Agreeing;
  number: GNumber;
}

/** Forma scritta (minuscola, apostrofo dritto) → parola e numero, per il genere che ha nel testo dello schema. */
function surfaceIndex(gender: Gender, words: readonly Agreeing[]): ReadonlyMap<string, Found> {
  const out = new Map<string, Found>();
  for (const word of words) {
    for (const number of ["s", "p"] as const) {
      const forms = word.forms[`${gender}${number}`];
      if (forms) for (const f of Object.values(forms)) if (!out.has(f)) out.set(f, { word, number });
    }
  }
  return out;
}

/** Le due parole dello schema: il genere che hanno nel testo e quello delle parole che le sostituiscono. */
const TERMS = {
  baseline: { from: "f", to: "m", s: "valore di partenza", p: "valori di partenza" },
  backtest: { from: "m", to: "f", s: "prova sul passato", p: "prove sul passato" },
} as const satisfies Record<string, { from: Gender; to: Gender; s: string; p: string }>;

const INDEX: Readonly<Record<Gender, { before: ReadonlyMap<string, Found>; after: ReadonlyMap<string, Found> }>> = {
  f: { before: surfaceIndex("f", [...DETERMINERS, ...BEFORE_NOUN, ...PREDETERMINERS]), after: surfaceIndex("f", AFTER_NOUN) },
  m: { before: surfaceIndex("m", [...DETERMINERS, ...BEFORE_NOUN, ...PREDETERMINERS]), after: surfaceIndex("m", AFTER_NOUN) },
};
/** Un numero scritto in cifre più grande di 1 («3 backtest»): il nome va al plurale. */
const PLURAL_NUMBER: Found = { word: { kind: "det", forms: {} }, number: "p" };

function soundOf(word: string): Sound {
  const w = word.toLowerCase();
  if (/^(?:[aeiouàèéìòù]|h[aeiou])/.test(w)) return "v";
  if (/^(?:s[^aeiouàèéìòù]|z|gn|ps|pn|x)/.test(w)) return "z";
  return "c";
}

const capFirst = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const startsUpper = (s: string) => s.length > 0 && s[0] !== s[0].toLowerCase();
const AFTER_WORDS = [...new Set([...INDEX.f.after.keys(), ...INDEX.m.after.keys()])].sort((a, b) => b.length - a.length).join("|");
const TERM_RE = new RegExp(
  // Non dentro una chiave («kpi.baseline.x», «baseline_mesi»).
  `(?<![\\p{L}\\p{N}_'’.])((?:(?!(?:baseline|backtest)(?!\\p{L}))[\\p{L}\\p{N}]+(?:\\s+|['’])){0,3})(baseline|backtest)(?![\\p{L}\\p{N}_]|[.-][\\p{L}\\p{N}])(?:(\\s+)(${AFTER_WORDS})(?!\\p{L}))?`,
  "giu",
);
const TOKEN_RE = /([\p{L}\p{N}]+)(\s+|['’])/gu;

/**
 * Le parole di §2.6 nei testi dello schema: «baseline» → «valore di partenza»,
 * «backtest» → «prova sul passato». Articoli, preposizioni, dimostrativi,
 * possessivi, l'aggettivo davanti e il participio dopo si accordano al nuovo
 * genere e numero: «nella baseline» → «nel valore di partenza», «una sua
 * baseline» → «un suo valore di partenza», «le baseline» → «i valori di
 * partenza», «del backtest» → «della prova sul passato», «i backtest eseguiti»
 * → «le prove sul passato eseguite». Le parole che non riconosce restano come
 * sono; il participio dopo il nome cambia solo se ha lo stesso numero del nome.
 */
export function kpiWords(text: string): string {
  return text.replace(TERM_RE, (match: string, pre: string, term: string, gap: string | undefined, after: string | undefined) => {
    const t = TERMS[term.toLowerCase() as keyof typeof TERMS];
    const index = INDEX[t.from];
    const tokens = [...pre.matchAll(TOKEN_RE)].map((m) => ({ word: m[1], sep: m[2] }));
    const elided = (k: number) => tokens[k].sep.trim() !== "";
    const lookup = (k: number): Found | undefined => {
      const w = tokens[k].word.toLowerCase();
      if (/^\d+$/.test(w)) return Number(w) > 1 && !elided(k) ? PLURAL_NUMBER : undefined;
      return index.before.get(elided(k) ? `${w}'` : w);
    };
    // Da destra verso sinistra: un aggettivo, poi un articolo, poi «tutto»; ci si ferma alla prima parola che non concorda.
    const plan: { at: number; found: Found }[] = [];
    let k = tokens.length - 1;
    const take = (kind: Agreeing["kind"]) => {
      const found = k >= 0 ? lookup(k) : undefined;
      if (!found || found.word.kind !== kind) return false;
      plan.push({ at: k, found });
      k -= 1;
      return true;
    };
    take("adj");
    if (take("det")) take("pre");
    const afterFound = after ? index.after.get(after.toLowerCase()) : undefined;
    const number: GNumber = plan.find((p) => p.found.word.kind === "det")?.found.number ?? plan[0]?.found.number ?? afterFound?.number ?? "s";
    // Si ricompone da destra: la forma di ogni parola dipende da quella che la segue.
    const rebuilt = new Map<number, string>();
    let next: string = t[number];
    for (const { at, found } of plan) {
      const form = found === PLURAL_NUMBER ? tokens[at].word : found.word.forms[`${t.to}${found.number}`]?.[soundOf(next)];
      if (form === undefined) return match;
      rebuilt.set(at, form);
      next = form;
    }
    const first = plan.length ? plan[plan.length - 1].at : tokens.length;
    let out = "";
    tokens.forEach((tk, i) => {
      const form = rebuilt.get(i);
      if (form === undefined) {
        out += tk.word + tk.sep;
        return;
      }
      const shown = i === first && startsUpper(tk.word) ? capFirst(form) : form;
      out += shown.endsWith("'") ? shown.slice(0, -1) + (elided(i) ? tk.sep : "'") : shown + (elided(i) ? " " : tk.sep);
    });
    out += plan.length === 0 && startsUpper(term) ? capFirst(t[number]) : t[number];
    if (gap !== undefined && after !== undefined) {
      const forms = afterFound && afterFound.number === number ? afterFound.word.forms[`${t.to}${number}`] : undefined;
      out += gap + (forms ? (startsUpper(after) ? capFirst(forms.c) : forms.c) : after);
    }
    return out;
  });
}

export function pnlOf(fields: Readonly<Record<string, string>>): PnlView {
  const line = fields.pnl_line;
  if (line && line.trim()) return { kind: "riga", text: line.trim() };
  if (truthy(fields.kpi_controllo)) return { kind: "controllo" };
  return { kind: "da_indicare" };
}

/** «Riga del conto economico», «KPI di controllo» o «Da indicare». */
export function pnlText(pnl: PnlView): string {
  return pnl.kind === "riga" ? pnl.text : pnl.kind === "controllo" ? "KPI di controllo" : "Da indicare";
}

export function rowsToMeasurements(rows: readonly Row[]): Map<string, KpiMeasurementView[]> {
  const out = new Map<string, KpiMeasurementView[]>();
  for (const r of rows) {
    const id = String(r.item_id);
    const phase = rowVocab(KPI_PHASES, r.phase) ?? "baseline";
    const suppressed = rowBool(r.suppressed);
    const value = suppressed ? null : rowNumber(r.value);
    const unit = rowString(r.unit);
    const from = formatDateIt(rowIsoDate(r.period_start));
    const to = formatDateIt(rowIsoDate(r.period_end));
    const list = out.get(id) ?? [];
    list.push({
      phase: PHASE_LABEL[phase],
      period: from && to ? `${from} – ${to}` : (from ?? to ?? ""),
      value: value === null ? null : [formatNumberIt(value), unit].filter(Boolean).join(" "),
      suppressed,
      provisional: rowString(r.status) !== "confermato",
    });
    out.set(id, list);
  }
  return out;
}

/** Scheda completa dei KPI (pannello): testi, collegamenti e misure. */
export function buildKpis(i: {
  itemRows: readonly Row[];
  linkRows: readonly Row[];
  measurementRows: readonly Row[];
  roles: readonly CaseRole[];
  roleLabels: Readonly<Record<string, string>>;
}): KpiView[] {
  const items = buildModelItems(i.itemRows, i.linkRows, { roles: i.roles, roleLabels: i.roleLabels });
  const links = parseLinkRows(i.linkRows);
  const measurements = rowsToMeasurements(i.measurementRows);
  return items
    .filter((it) => it.kind === "kpi")
    .map((item) => {
      const f = item.fields;
      const pnl = pnlOf(f);
      const confirmers = links.filter((l) => l.toId === item.id && l.relation === "precisa" && l.from.kind === "domanda");
      const formulaQuestionOk = confirmers.some((l) => l.from.responseType === "conferma_formula" && l.from.status === "validata");
      const definitionOk = item.status === "validata" || formulaQuestionOk;
      const sourceLinks = links.filter((l) => l.fromId === item.id && l.relation === "alimentato_da");
      const dataOk = sourceLinks.some((l) => l.to.availability.includes("oggi_export"));
      return {
        // Il titolo con le parole di §2.6, come nella riga della lista.
        item: { ...item, title: kpiWords(item.title) },
        formula: f.formula ?? null,
        formulaTech: f.formula_tecnica ?? null,
        unit: f.unit ?? f.unita ?? null,
        direction: f.direzione ?? null,
        granularity: f.granularita ?? null,
        dimensions: f.dimensioni ?? null,
        frequency: f.frequenza ?? null,
        baseline: f.baseline ? kpiWords(f.baseline) : DEFAULT_BASELINE,
        target: f.target ? kpiWords(f.target) : DEFAULT_TARGET,
        pnl,
        definition: {
          ok: definitionOk,
          label: definitionOk ? "Definizione confermata" : confirmers.length ? "Formula da confermare" : "Formula da confermare con il referente",
        },
        data: {
          ok: dataOk,
          label: dataOk ? "Dati disponibili oggi" : sourceLinks.length ? "Fonte da verificare" : "Fonte da indicare",
        },
        readiness: kpiReadiness({ definitionOk, dataOk, hasFormula: Boolean(f.formula) }),
        vanity: item.priority === "must" && pnl.kind === "da_indicare",
        dataNeeded: linkedItems(item, "usa", "out"),
        sources: linkedItems(item, "alimentato_da", "out"),
        confirmQuestions: linkedItems(item, "precisa", "in"),
        measurements: measurements.get(item.id) ?? [],
      };
    });
}

// ── Riga leggera della lista ──────────────────────────────────────────

export interface KpiRow {
  id: string;
  key: string;
  title: string;
  explanation: string | null;
  status: ItemStatus;
  priority: Priority | null;
  levers: Lever[];
  readiness: KpiReadiness;
  pnl: PnlView;
  /** Ha una riga del conto economico oppure lo usa una riga del conto del caso. */
  linked: boolean;
  /** Indispensabile, non collegato al conto e non di controllo. */
  vanity: boolean;
}

/**
 * Riga di `kpiRowsSql` (`uc-value.ts`): voce con `spec` e i quattro segni dei
 * collegamenti già calcolati nel database. `roiKeys` sono le chiavi che usano
 * le righe del conto (`roiKpiKeys`).
 */
export function rowToKpiRow(r: Row, roiKeys: ReadonlySet<string>): KpiRow {
  const spec = rowObject(r.spec);
  const key = String(r.key);
  const status = rowVocab(ITEM_STATUSES, r.status) ?? "da_chiedere";
  const priority = rowVocab(PRIORITIES, r.priority);
  const pnl = pnlOf({ pnl_line: specText(spec, "pnl_line") ?? "", kpi_controllo: specText(spec, "kpi_controllo") ?? "" });
  const definitionOk = status === "validata" || rowBool(r.formula_confirmed);
  const linked = pnl.kind === "riga" || roiKeys.has(key);
  return {
    id: String(r.id),
    key,
    title: kpiWords(rowString(r.title)?.trim() || key),
    explanation: rowString(r.explanation)?.trim() || null,
    status,
    priority,
    levers: rowStringArray(rowJson(r.levers)).filter((l): l is Lever => isVocab(LEVERS, l)),
    readiness: kpiReadiness({ definitionOk, dataOk: rowBool(r.data_ready), hasFormula: Boolean(specText(spec, "formula")) }),
    pnl,
    linked,
    vanity: priority === "must" && pnl.kind !== "controllo" && !linked,
  };
}

// ── Lista: viste, ricerca e gruppi ────────────────────────────────────

export const KPI_VIEWS = ["conto", "tutti", "da-sistemare"] as const;
export type KpiViewKey = (typeof KPI_VIEWS)[number];

export const KPI_VIEW_LABEL: Readonly<Record<KpiViewKey, { label: string; short?: string }>> = {
  conto: { label: "Collegati al conto", short: "Nel conto" },
  tutti: { label: "Tutti" },
  "da-sistemare": { label: "Da sistemare" },
};

const MAX_Q = 100;

export interface KpiParams {
  /** Vista chiesta dall'URL; `null` = quella predefinita (`kpiView`). */
  vista: KpiViewKey | null;
  q: string | null;
  /** KPI del pannello. */
  apri: string | null;
  /** Gruppo aperto (`gruppi=tempo`): la chiave della leva, `altri` per i KPI senza leva. Al più uno (`toggleGroup`). */
  gruppi: string[];
  /** Pagina di un gruppo aperto oltre la prima (`pagine=ricavi-2,costi-3`). */
  pagine: Record<string, number>;
}

/** Chiave di un gruppo nell'URL: la leva, oppure `altri`. */
export const OTHER_GROUP = "altri";

export function groupKey(lever: Lever | null): string {
  return lever ?? OTHER_GROUP;
}

function first(sp: Readonly<Record<string, string | string[] | undefined>>, key: string): string | null {
  const v = sp[key];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" ? s : null;
}

const MAX_PAGE = 1000;

/** Parametri di `/valore/kpi`: `vista`, `q` (ricerca), `apri` (pannello), `gruppi` (aperti) e `pagine` (dei gruppi aperti). Gli altri si ignorano. */
export function parseKpiParams(sp: Readonly<Record<string, string | string[] | undefined>>): KpiParams {
  const vista = first(sp, "vista");
  const q = first(sp, "q")?.replace(/\s+/g, " ").trim().slice(0, MAX_Q) ?? "";
  const apri = first(sp, "apri");
  const known = new Set<string>([...LEVERS, OTHER_GROUP]);
  // Un gruppo aperto alla volta: un indirizzo con più gruppi apre il primo che esiste.
  const gruppi = (first(sp, "gruppi") ?? "")
    .split(",")
    .map((g) => g.trim())
    .filter((g) => known.has(g))
    .slice(0, 1);
  const pagine: Record<string, number> = {};
  for (const part of (first(sp, "pagine") ?? "").split(",").slice(0, known.size)) {
    const m = /^([a-z_]+)-(\d{1,4})$/.exec(part.trim());
    const n = m ? Number(m[2]) : 0;
    if (m && known.has(m[1]) && n >= 2 && n <= MAX_PAGE) pagine[m[1]] = n;
  }
  return { vista: isVocab(KPI_VIEWS, vista) ? vista : null, q: q || null, apri: apri && UUID.test(apri) ? apri : null, gruppi, pagine };
}

/** Pagine dopo aver chiesto la pagina `page` del gruppo `key` (la prima non si scrive). */
export function withGroupPage(pagine: Readonly<Record<string, number>>, key: string, page: number): Record<string, number> {
  const out = { ...pagine };
  if (page >= 2) out[key] = page;
  else delete out[key];
  return out;
}

/**
 * Gruppi aperti dopo un tocco sull'intestazione di `key`: si apre se era
 * chiuso e chiude gli altri, si chiude se era aperto. Con un gruppo aperto
 * alla volta, al più `KPI_GROUP_PAGE` righe: con 184 KPI `/valore/kpi` resta
 * sotto i 3.000 px a 1440 e nei budget di HTML e RSC (DESIGN §7.1, P0-5).
 */
export function toggleGroup(open: readonly string[], key: string): string[] {
  return open.includes(key) ? [] : [key];
}

/** Le pagine dei soli gruppi aperti: un gruppo che si chiude riparte dalla prima. */
export function pagesOfOpen(pagine: Readonly<Record<string, number>>, open: readonly string[]): Record<string, number> {
  return Object.fromEntries(Object.entries(pagine).filter(([k]) => open.includes(k)));
}

/**
 * Con pochi KPI tutti i gruppi sono aperti, e così con una ricerca che ne trova
 * pochi; altrimenti solo quelli dell'URL. Le righe dei gruppi chiusi non si
 * mandano: con 184 KPI la pagina resta corta e leggera.
 */
export const OPEN_ALL_UP_TO = 12;
export const OPEN_SEARCH_UP_TO = 40;

export function groupsOpen(i: { shown: number; searching: boolean; requested: readonly string[] }): "tutti" | string[] {
  return i.shown <= (i.searching ? OPEN_SEARCH_UP_TO : OPEN_ALL_UP_TO) ? "tutti" : [...i.requested];
}

/**
 * La vista da mostrare: «Collegati al conto» se ce n'è almeno uno, altrimenti
 * «Tutti». «Da sistemare» è solo per Lateral Space (la riga anti-vanità).
 */
export function kpiView(requested: KpiViewKey | null, i: { linked: number; ls: boolean }): KpiViewKey {
  if (requested === "da-sistemare") return i.ls ? requested : "tutti";
  if (requested) return requested;
  return i.linked > 0 ? "conto" : "tutti";
}

export function kpisInView(rows: readonly KpiRow[], view: KpiViewKey): KpiRow[] {
  if (view === "conto") return rows.filter((k) => k.linked);
  if (view === "da-sistemare") return rows.filter((k) => k.vanity);
  return [...rows];
}

/** Indirizzo di `/valore/kpi` con i parametri dati (quelli vuoti si tolgono). */
export function kpiQuery(p: {
  vista?: KpiViewKey | null;
  q?: string | null;
  apri?: string | null;
  gruppi?: readonly string[] | null;
  pagine?: Readonly<Record<string, number>> | null;
}): string {
  const sp = new URLSearchParams();
  if (p.vista) sp.set("vista", p.vista);
  if (p.q) sp.set("q", p.q);
  if (p.gruppi?.length) sp.set("gruppi", p.gruppi.join(","));
  const pages = Object.entries(p.pagine ?? {})
    .filter(([, n]) => n >= 2)
    .sort(([a], [b]) => a.localeCompare(b));
  if (pages.length) sp.set("pagine", pages.map(([k, n]) => `${k}-${n}`).join(","));
  if (p.apri) sp.set("apri", p.apri);
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export interface KpiGroup {
  /** Leva del gruppo; `null` per i KPI senza leva. */
  lever: Lever | null;
  items: KpiRow[];
}

/**
 * KPI raggruppati per leva (la prima leva del KPI, quella principale), nell'ordine
 * delle leve; i KPI senza leva in fondo. Dentro il gruppo per titolo. Un gruppo
 * vuoto non c'è.
 */
export function groupKpisByLever(rows: readonly KpiRow[]): KpiGroup[] {
  const byLever = new Map<Lever | null, KpiRow[]>();
  for (const k of rows) {
    const lever = k.levers[0] ?? null;
    const list = byLever.get(lever) ?? [];
    list.push(k);
    byLever.set(lever, list);
  }
  const order: (Lever | null)[] = [...LEVERS, null];
  return order
    .filter((l) => byLever.has(l))
    .map((lever) => ({ lever, items: (byLever.get(lever) ?? []).sort((a, b) => a.title.localeCompare(b.title, "it") || a.key.localeCompare(b.key)) }));
}

/**
 * Righe per pagina di un gruppo aperto (DESIGN §7.1, P0-5 d). Una leva può
 * avere 50 KPI e più: aperta tutta insieme la pagina supererebbe i 3.000 px a
 * 1440 e i budget di HTML e RSC. Le altre righe si leggono con «Successivi».
 */
export const KPI_GROUP_PAGE = 20;

export interface KpiGroupView {
  lever: Lever | null;
  /** Chiave del gruppo nell'URL (`groupKey`). */
  key: string;
  /** KPI del gruppo: il numero dell'intestazione. */
  total: number;
  /** Righe della pagina mostrata; null per un gruppo chiuso, che non manda righe. */
  rows: KpiRow[] | null;
  page: number;
  pages: number;
  /** Prima e ultima riga mostrate, contando da 1 (0 per un gruppo chiuso). */
  from: number;
  to: number;
}

/**
 * I gruppi come li mostra la pagina: quelli chiusi solo con il numero, quelli
 * aperti con al massimo `KPI_GROUP_PAGE` righe, della pagina chiesta
 * nell'indirizzo (`pagine`). Una pagina oltre l'ultima diventa l'ultima.
 */
export function groupViews(groups: readonly KpiGroup[], open: "tutti" | readonly string[], pagine: Readonly<Record<string, number>>): KpiGroupView[] {
  return groups.map((g) => {
    const key = groupKey(g.lever);
    const total = g.items.length;
    const pages = Math.max(1, Math.ceil(total / KPI_GROUP_PAGE));
    if (open !== "tutti" && !open.includes(key)) return { lever: g.lever, key, total, rows: null, page: 1, pages, from: 0, to: 0 };
    const page = Math.min(Math.max(1, Math.trunc(pagine[key] ?? 1)), pages);
    const start = (page - 1) * KPI_GROUP_PAGE;
    const rows = g.items.slice(start, start + KPI_GROUP_PAGE);
    return { lever: g.lever, key, total, rows, page, pages, from: rows.length ? start + 1 : 0, to: start + rows.length };
  });
}

/** «12 KPI indispensabili senza una voce del conto» (riga grigia per Lateral Space). */
export function vanityText(n: number): string {
  return n === 1 ? "1 KPI indispensabile senza una voce del conto" : `${formatNumberIt(n)} KPI indispensabili senza una voce del conto`;
}
