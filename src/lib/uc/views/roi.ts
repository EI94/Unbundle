/**
 * Il conto del caso (DESIGN §3.8, Valore): stato «stima», righe di beneficio per
 * leva (formula, KPI collegati, come diventa euro), righe di costo (tipo, come si
 * stima, fonte, approvata dal cliente: sì / no / da chiedere), pareggio e valore
 * nel tempo, esempio illustrativo e «cosa serve».
 *
 * Fonte: il modello più recente dello scenario base (`uc_roi_models`); se il
 * caso non ne ha ancora uno, il conto dello schema di partenza (due forme
 * ammesse: quella del seed, con `leve`/`costi`, e quella dello schema d'esempio,
 * con `benefits`/`costs`), da salvare con la prima modifica.
 *
 * `buildValueView` prepara la pagina Valore: i tre numeri principali, le sole
 * leve attive, i costi, i «Dati che mancano» e «Come si calcola». I testi
 * passano da `plainText`: niente chiavi, codici dei fatti o articoli fuori da
 * «Dettagli tecnici».
 *
 * Modulo puro.
 */
import { rowDate, rowJson, rowNumber, rowObject, rowString, rowStringArray, type Row } from "../sql/readiness.ts";
import type { Json } from "../types.ts";
import { LEVERS, isVocab, type ItemStatus, type Lever, type SemaforoColor } from "../vocab.ts";
import { FORBIDDEN_RULES } from "./copy-guard.ts";
import { formatDateIt, formatEuro, formatNumberIt, stripFactCodes, stripLegalRefs } from "./format.ts";
import { KPI_READINESS_VIEW, kpiWords, type KpiReadiness, type KpiRow } from "./kpi.ts";
import {
  COST_KIND_LABEL,
  LEVER_LABEL,
  LINE_STATUSES,
  LINE_STATUS_LABEL,
  ROI_GAP_LABEL,
  VALUE_PANEL,
  benefitLabel,
  computeRoi,
  costKindFromText,
  leverFromLabel,
  type BenefitLine,
  type CostKind,
  type CostLine,
  type LineStatus,
  type RoiComputation,
} from "./roi-edit.ts";

export interface RoiView {
  source: "modello" | "template" | "vuoto";
  version: number | null;
  /** «stima», «baseline», «backtest», «misurato». */
  status: string;
  currency: string;
  explanation: string | null;
  formula: { explanation: string | null; breakEven: string | null; value5y: string | null };
  example: { note: string | null; rows: { label: string; value: string }[] };
  whatNeeded: string[];
  notes: string | null;
  costLines: CostLine[];
  benefitLines: BenefitLine[];
  computed: RoiComputation;
  discountRate: number | null;
  adoptionRate: number | null;
  humanReviewHours: number | null;
  attributionMethod: string | null;
  assumptions: string[];
  updatedAt: string | null;
  /**
   * `updated_at` del modello come lo scrive il database (testo), per il
   * controllo di `saveCaseRoi`; null per il conto dello schema di partenza.
   */
  seen: string | null;
  /** `content` così com'è, per il salvataggio (che toglie il vecchio `benefit_extras`). */
  content: Record<string, Json>;
}

const BLOCK_KEY = /^[a-z0-9_]{1,60}$/;

function str(v: Json | undefined): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function strings(v: Json | undefined): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : typeof v === "string" && v.trim() ? [v.trim()] : [];
}

function num(v: Json | undefined): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function status(v: Json | undefined): LineStatus {
  return typeof v === "string" && (LINE_STATUSES as readonly string[]).includes(v) ? (v as LineStatus) : "da_raccogliere";
}

function objects(v: Json | undefined): Record<string, Json>[] {
  return Array.isArray(v) ? v.filter((x): x is Record<string, Json> => !!x && typeof x === "object" && !Array.isArray(x)) : [];
}

function lineKey(raw: Json | undefined, prefix: string, index: number, used: Set<string>): string {
  let key = typeof raw === "string" && BLOCK_KEY.test(raw) ? raw : `${prefix}_${String(index + 1).padStart(2, "0")}`;
  if (used.has(key)) key = `${key}_${index + 1}`.slice(0, 60);
  used.add(key);
  return key;
}

/** Righe di costo salvate (`cost_lines`) o del template (`costi` / `costs`). */
export function parseCostLines(raw: Json | undefined): CostLine[] {
  const used = new Set<string>();
  return objects(raw).map((c, i) => {
    const kind = isCostKind(c.kind) ? c.kind : costKindFromText(str(c.tipo) ?? str(c.tipo_testo) ?? str(c.kind));
    const authorized = c.authorized_art_8_4;
    return {
      key: lineKey(c.key, "costo", i, used),
      label: str(c.label) ?? str(c.voce) ?? `Costo ${i + 1}`,
      kind,
      tipoTesto: str(c.tipo_testo) ?? str(c.tipo),
      howEstimated: str(c.how_estimated) ?? str(c.come_si_stima),
      value: num(c.value),
      status: status(c.status),
      source: str(c.source) ?? str(c.fonte),
      authorized: authorized === true ? true : authorized === false ? false : null,
      itemKey: str(c.item_key),
    };
  });
}

function isCostKind(v: Json | undefined): v is CostKind {
  return v === "una_tantum" || v === "ricorrente" || v === "escluso";
}

/**
 * Righe di beneficio salvate (`benefit_lines`) o del template (`leve` /
 * `benefits`). I testi del caso stanno sulla riga; per i modelli salvati prima
 * della correzione del comando si rileggono da `content.benefit_extras`.
 */
export function parseBenefitLines(raw: Json | undefined, extras: Readonly<Record<string, Json>> = {}): BenefitLine[] {
  const used = new Set<string>();
  return objects(raw).map((b, i) => {
    const lever = isVocab(LEVERS, b.lever) ? (b.lever as Lever) : leverFromLabel(str(b.lever_label) ?? str(b.leva) ?? str(b.lever));
    const key = lineKey(b.key ?? lever ?? undefined, "leva", i, used);
    const extra = extras[key] && typeof extras[key] === "object" && !Array.isArray(extras[key]) ? (extras[key] as Record<string, Json>) : {};
    return {
      key,
      lever,
      leverLabel: str(b.lever_label) ?? str(b.leva) ?? str(extra.lever_label),
      formula: str(b.formula),
      inputs: [...strings(b.inputs), ...strings(b.kpi), ...strings(b.kpis)],
      value: num(b.value),
      status: status(b.status),
      source: str(b.source),
      howToEuro: str(b.how_to_euro) ?? str(b.come_diventa_euro),
      dataNeeded: strings(b.data_needed).length ? strings(b.data_needed) : strings(b.dati_necessari).length ? strings(b.dati_necessari) : strings(extra.data_needed),
      example: str(b.example) ?? str(b.esempio_illustrativo) ?? str(extra.example),
      unresolvedRefs: strings(b.unresolved_refs).length ? strings(b.unresolved_refs) : strings(extra.unresolved_refs),
    };
  });
}

function exampleRows(v: Json | undefined): { label: string; value: string }[] {
  return objects(v).flatMap((r) => {
    const label = str(r.voce) ?? str(r.label);
    const value = str(r.valore) ?? (typeof r.value === "number" ? String(r.value) : str(r.value));
    return label && value ? [{ label, value }] : [];
  });
}

function contentParts(content: Readonly<Record<string, Json>>) {
  const formula = rowObject(content.formula_roi);
  const example = rowObject(content.esempio);
  return {
    explanation: str(content.spiegazione),
    formula: { explanation: str(formula.spiegazione), breakEven: str(formula.break_even), value5y: str(formula.valore_5_anni) },
    example: { note: str(example.nota), rows: exampleRows(example.righe) },
    whatNeeded: strings(content.cosa_serve),
    notes: str(content.notes) ?? str(content.note),
  };
}

/** ROI dal modello salvato, oppure dal template, oppure vuoto. */
export function buildRoiView(modelRow: Row | undefined, templateRoi: unknown): RoiView {
  if (modelRow) {
    const content = rowObject(modelRow.content);
    const extras = rowObject(content.benefit_extras);
    const costLines = parseCostLines(rowJson(modelRow.cost_lines) ?? []);
    const benefitLines = parseBenefitLines(rowJson(modelRow.benefit_lines) ?? [], extras);
    const discountRate = rowNumber(modelRow.discount_rate);
    const adoptionRate = rowNumber(modelRow.adoption_rate);
    const horizon = rowNumber(modelRow.horizon_years) ?? 5;
    return {
      source: "modello",
      version: rowNumber(modelRow.version),
      status: rowString(modelRow.status) ?? "stima",
      currency: rowString(modelRow.currency) ?? "EUR",
      ...contentParts(content),
      costLines,
      benefitLines,
      computed: computeRoi({ costLines, benefitLines, horizonYears: horizon, discountRate, adoptionRate }),
      discountRate,
      adoptionRate,
      humanReviewHours: rowNumber(modelRow.human_review_hours),
      attributionMethod: rowString(modelRow.attribution_method),
      assumptions: rowStringArray(rowJson(modelRow.assumptions)).filter((x) => x.trim() !== ""),
      updatedAt: formatDateIt(rowDate(modelRow.updated_at)),
      seen: rowString(modelRow.seen),
      content,
    };
  }
  const t = rowJson<Record<string, Json>>(templateRoi);
  const tpl = t && typeof t === "object" && !Array.isArray(t) ? t : null;
  const costLines = parseCostLines(tpl?.cost_lines ?? tpl?.costi ?? tpl?.costs);
  const benefitLines = parseBenefitLines(tpl?.benefit_lines ?? tpl?.leve ?? tpl?.benefits);
  const horizon = num(tpl?.horizon_years ?? undefined) ?? 5;
  const content: Record<string, Json> = {};
  if (tpl) for (const k of ["spiegazione", "formula_roi", "esempio", "cosa_serve", "notes"]) if (tpl[k] !== undefined) content[k] = tpl[k];
  return {
    source: tpl ? "template" : "vuoto",
    version: null,
    status: "stima",
    currency: str(tpl?.currency ?? undefined) ?? "EUR",
    ...contentParts(content),
    costLines,
    benefitLines,
    computed: computeRoi({ costLines, benefitLines, horizonYears: horizon }),
    discountRate: null,
    adoptionRate: null,
    humanReviewHours: null,
    attributionMethod: null,
    assumptions: [],
    updatedAt: null,
    seen: null,
    content,
  };
}

/** Chiavi dei KPI citati dalle righe di beneficio, per i collegamenti. */
export function roiKpiKeys(view: Pick<RoiView, "benefitLines" | "costLines">): string[] {
  const keys = new Set<string>();
  for (const b of view.benefitLines) for (const k of b.inputs) keys.add(k);
  for (const c of view.costLines) if (c.itemKey) keys.add(c.itemKey);
  return [...keys].slice(0, 500);
}

// ── Testi senza codici ────────────────────────────────────────────────

const KEY_RULE = FORBIDDEN_RULES.find((r) => r.id === "chiave");

/** Spazi doppi, separatori e parentesi rimasti vuoti dopo aver tolto i codici. */
function tidy(text: string): string {
  return text
    .replace(/\(\s*[,;·]?\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,;:!?)])/g, "$1")
    .replace(/(?:[ \t]*[,;][ \t]*){2,}/g, ", ")
    .replace(/[,;][ \t]*(?=[.)]|$)/gm, "")
    .replace(/\(\s+/g, "(")
    .replace(/^[ \t]*[,;·][ \t]*/gm, "")
    .trim();
}

/**
 * Testo per la pagina (DESIGN §1, principio 3): ogni chiave di una voce diventa
 * il suo titolo, se lo conosciamo, altrimenti sparisce; codici dei fatti e
 * articoli spariscono; «baseline» e «backtest» diventano «valore di partenza» e
 * «prova sul passato» (§2.6, `kpiWords`). Vale per tutti: per Lateral Space
 * chiavi e articoli restano in «Dettagli tecnici». Un testo che resta vuoto è
 * null.
 */
export function plainText(text: string | null | undefined, keyTitles: ReadonlyMap<string, string> = new Map()): string | null {
  if (!text || !text.trim()) return null;
  let out = text;
  if (KEY_RULE) {
    out = out.replace(new RegExp(KEY_RULE.pattern.source, KEY_RULE.pattern.flags), (m) => (KEY_RULE.accept && !KEY_RULE.accept(m) ? m : (keyTitles.get(m) ?? "")));
  }
  out = kpiWords(tidy(stripLegalRefs(stripFactCodes(out))));
  return out || null;
}

// ── Pagina Valore (DESIGN §3.8) ───────────────────────────────────────

export const ROI_STATUS_LABEL: Readonly<Record<string, string>> = { stima: "Stima", baseline: "Valore di partenza", backtest: "Prova sul passato", misurato: "Misurato" };

/** Una domanda il cui titolo, senza codici, resta vuoto. */
const QUESTION_WITHOUT_TITLE = "Domanda senza titolo";

/**
 * Domande elencate in «Dati che mancano»: le prime, indispensabili prima; le
 * altre sono «E altre N» e si leggono in Domande. Un caso vero ne ha più di
 * cento: tutte insieme il pannello supererebbe i budget di HTML e RSC (DESIGN
 * §7.1, P0-5).
 */
export const MISSING_QUESTIONS_SHOWN = 20;

/** Domanda che serve al conto e non è ancora a posto (`roiQuestionsSql`). */
export interface RoiQuestion {
  id: string;
  key: string;
  title: string;
  status: ItemStatus;
}

/** KPI citato da una leva: titolo e puntino, mai la chiave. */
export interface KpiRef {
  id: string;
  title: string;
  readiness: KpiReadiness;
  /** Colore e parola del puntino («Pronto», «Da confermare», «Da definire»). */
  dot: { tone: SemaforoColor; label: string };
}

/** Una delle cifre del conto: il numero, oppure «—» con la nota («da calcolare», «non rientra»). */
export interface ValueFigure {
  label: string;
  value: string | null;
  note: string | null;
}

export interface LeverRowView {
  /** Valore di `?apri=` del pannello della leva. */
  id: string;
  lever: Lever | null;
  label: string;
  /** «40.000 € all'anno», oppure null («da stimare»). */
  value: string | null;
  kpis: KpiRef[];
  /** Descrizione della leva dalla Descrizione del caso, senza codici. */
  description: string | null;
  howToEuro: string | null;
  /** Riga di beneficio da modificare; null per una leva attiva che non ha ancora una riga. */
  line: BenefitLine | null;
}

export interface CostRowView {
  /** Valore di `?apri=` del pannello della riga. */
  id: string;
  line: CostLine;
  label: string;
  /** «12.000 €», «12.000 € all'anno», oppure null. */
  value: string | null;
  /** Al posto del valore: «da stimare», «fuori dal conto». */
  valueNote: string | null;
  /** «Sì», «No», oppure null (da chiedere). */
  approved: string | null;
  kind: string;
  howEstimated: string | null;
  source: string | null;
  status: string;
}

export interface MissingLineView {
  /** Pannello della riga, se c'è una riga. */
  id: string | null;
  label: string;
  /** Cosa manca alla riga; vuoto quando manca un intero lato del conto. */
  reason: string;
}

export interface MissingView {
  /** Domande e righe che mancano: il numero di «Mancano 12 dati». */
  total: number;
  /** Domande che servono al conto e non sono a posto (al massimo le prime 200). */
  questions: RoiQuestion[];
  questionTotal: number;
  lines: MissingLineView[];
  /** «Cosa serve per calcolarlo davvero» dello schema di partenza. */
  needs: string[];
}

export interface HowView {
  figures: ValueFigure[];
  note: string | null;
  method: string[];
  assumptions: string[];
  formula: string[];
  example: { note: string | null; rows: { label: string; value: string }[] };
}

export interface ValueView {
  source: RoiView["source"];
  statusLabel: string;
  computed: boolean;
  /** Costo di realizzazione, Beneficio all'anno, Pareggio. */
  figures: ValueFigure[];
  disclaimer: string;
  levers: LeverRowView[];
  /** Le leve che il caso non tocca, per «Leve non attive (3)». */
  inactiveLevers: { lever: Lever; label: string }[];
  costs: CostRowView[];
  missing: MissingView;
  how: HowView;
  /** Tutti i KPI del caso, per «Tutti i KPI (184)». */
  kpiTotal: number;
}

const DA_CALCOLARE = "da calcolare";

function figure(label: string, value: string | null, note: string | null): ValueFigure {
  return { label, value, note: value === null ? note : null };
}

function months(n: number): string {
  return `${formatNumberIt(n)} ${n === 1 ? "mese" : "mesi"}`;
}

/** I tre numeri del conto (DESIGN §3.8): mai un numero se il conto è «da calcolare». */
export function valueFigures(c: RoiComputation): ValueFigure[] {
  const done = c.gaps.length === 0;
  return [
    figure("Costo di realizzazione", done ? formatEuro(c.implementation) : null, DA_CALCOLARE),
    figure("Beneficio all'anno", done ? formatEuro(c.annualBenefit) : null, DA_CALCOLARE),
    figure("Pareggio", done && c.breakEvenMonths !== null ? months(c.breakEvenMonths) : null, done ? "non rientra" : DA_CALCOLARE),
  ];
}

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

/** Testi della leva dal blocco «Leve di valore» della Descrizione (`leva`, `come`). */
export function parseLeverTexts(raw: unknown): { leva: string | null; come: string | null }[] {
  const list = rowJson<unknown[]>(raw);
  if (!Array.isArray(list)) return [];
  return list.flatMap((r) => {
    if (!r || typeof r !== "object" || Array.isArray(r)) return [];
    const o = r as Record<string, unknown>;
    const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    return [{ leva: s(o.leva), come: s(o.come) }];
  });
}

function leverDescription(
  texts: readonly { leva: string | null; come: string | null }[],
  lever: Lever | null,
  label: string,
  keyTitles: ReadonlyMap<string, string>,
): string | null {
  const own = normalize(label);
  const parts = texts
    .filter((t) => t.leva && t.come && ((lever && leverFromLabel(t.leva) === lever) || normalize(t.leva) === own))
    .map((t) => plainText(t.come, keyTitles))
    .filter((t): t is string => t !== null);
  return parts.length ? parts.join("\n\n") : null;
}

function kpisFor(inputs: readonly string[], lever: Lever | null, kpis: readonly KpiRow[]): KpiRef[] {
  const byKey = new Map(kpis.map((k) => [k.key, k]));
  const out = new Map<string, KpiRow>();
  for (const key of inputs) {
    const k = byKey.get(key);
    if (k) out.set(k.id, k);
  }
  if (lever) for (const k of kpis) if (k.levers.includes(lever)) out.set(k.id, k);
  return [...out.values()].sort((a, b) => a.title.localeCompare(b.title, "it")).map((k) => ({ id: k.id, title: k.title, readiness: k.readiness, dot: KPI_READINESS_VIEW[k.readiness] }));
}

function costRow(c: CostLine, keyTitles: ReadonlyMap<string, string>): CostRowView {
  const amount = formatEuro(c.value);
  const excluded = c.kind === "escluso";
  return {
    id: `${VALUE_PANEL.cost}${c.key}`,
    line: c,
    label: plainText(c.label, keyTitles) ?? c.label,
    value: excluded || !amount ? null : c.kind === "ricorrente" ? `${amount} all'anno` : amount,
    valueNote: excluded ? "fuori dal conto" : amount ? null : "da stimare",
    approved: c.authorized === true ? "Sì" : c.authorized === false ? "No" : null,
    kind: c.kind ? COST_KIND_LABEL[c.kind] : "Tipo da indicare",
    howEstimated: plainText(c.howEstimated, keyTitles),
    source: plainText(c.source, keyTitles),
    status: LINE_STATUS_LABEL[c.status],
  };
}

function disclaimerFor(status: string): string {
  if (status === "misurato") return "Valori misurati sui dati veri: nessun beneficio è garantito per il futuro.";
  if (status === "backtest") return "Valori provati sul passato: nessun beneficio è garantito.";
  return "Sono stime: nessun beneficio è garantito. Diventano misure dopo la prova sul passato.";
}

function howView(roi: RoiView, keyTitles: ReadonlyMap<string, string>): HowView {
  const c = roi.computed;
  const done = c.gaps.length === 0;
  const clean = (t: string | null | undefined) => plainText(t, keyTitles);
  const method = [
    clean(roi.explanation),
    clean(roi.notes),
    roi.attributionMethod ? clean(`Metodo di attribuzione: ${roi.attributionMethod}`) : null,
    roi.adoptionRate !== null ? `Il beneficio conta solo il ${formatNumberIt(roi.adoptionRate * 100)}% delle proposte davvero usate.` : null,
    roi.discountRate !== null && roi.discountRate > 0 ? `I benefici degli anni dopo il primo sono scontati al ${formatNumberIt(roi.discountRate * 100)}% all'anno.` : null,
    "Nel conto entrano sempre il tempo di verifica umana delle proposte e i costi di esercizio.",
  ].filter((t): t is string => t !== null);
  return {
    figures: [
      figure("Esercizio all'anno", done ? formatEuro(c.annualRun) : null, DA_CALCOLARE),
      figure(`Valore a ${c.horizonYears} anni`, done ? formatEuro(c.value) : null, DA_CALCOLARE),
    ],
    note: done ? c.note : null,
    method,
    assumptions: roi.assumptions.map((a) => clean(a)).filter((t): t is string => t !== null),
    formula: [clean(roi.formula.explanation), clean(roi.formula.breakEven), clean(roi.formula.value5y)].filter((t): t is string => t !== null),
    example: {
      note: clean(roi.example.note),
      rows: roi.example.rows.flatMap((r) => {
        const label = clean(r.label);
        return label ? [{ label, value: r.value }] : [];
      }),
    },
  };
}

/**
 * La pagina Valore (DESIGN §3.8) dal conto, dalle leve del caso, dai testi
 * delle leve nella Descrizione, dai KPI (righe leggere) e dalle domande del
 * conto ancora aperte.
 *
 * - Leve: una riga per ogni riga di beneficio, nell'ordine del conto, poi le leve
 *   attive del caso che non hanno ancora una riga. Le altre stanno in «Leve non
 *   attive». «Si misura con»: i KPI citati dalla riga più quelli della leva.
 * - «Dati che mancano»: le domande del conto non a posto, poi le righe a cui
 *   manca il tipo o il valore, poi «cosa serve» dello schema di partenza.
 */
export function buildValueView(i: {
  roi: RoiView;
  caseLevers: readonly Lever[];
  leverTexts: readonly { leva: string | null; come: string | null }[];
  kpis: readonly KpiRow[];
  questions: readonly RoiQuestion[];
  questionTotal: number;
}): ValueView {
  const { roi } = i;
  const c = roi.computed;
  const kpiTitles = new Map<string, string>(i.kpis.map((k) => [k.key, k.title] as const));
  // Il titolo di una domanda dello schema può citare un articolo o la scheda privacy («(art. 8.4)», «A.8»): sulla pagina come gli altri testi.
  const questions = i.questions.map((q) => ({ ...q, title: plainText(q.title, kpiTitles) ?? QUESTION_WITHOUT_TITLE }));
  const keyTitles = new Map<string, string>([...kpiTitles, ...questions.map((q) => [q.key, q.title] as const)]);
  const levers: LeverRowView[] = roi.benefitLines.map((b) => {
    const label = plainText(benefitLabel(b), keyTitles) ?? benefitLabel(b);
    const amount = formatEuro(b.value);
    return {
      id: `${VALUE_PANEL.lever}${b.key}`,
      lever: b.lever,
      label,
      value: amount ? `${amount} all'anno` : null,
      kpis: kpisFor(b.inputs, b.lever, i.kpis),
      description: leverDescription(i.leverTexts, b.lever, b.leverLabel ?? label, keyTitles),
      howToEuro: plainText(b.howToEuro, keyTitles),
      line: b,
    };
  });
  const inLines = new Set(roi.benefitLines.map((b) => b.lever).filter((l): l is Lever => l !== null));
  const caseLevers = new Set(i.caseLevers);
  for (const lever of LEVERS) {
    if (!caseLevers.has(lever) || inLines.has(lever)) continue;
    levers.push({
      id: `${VALUE_PANEL.newLever}${lever}`,
      lever,
      label: LEVER_LABEL[lever],
      value: null,
      kpis: kpisFor([], lever, i.kpis),
      description: leverDescription(i.leverTexts, lever, LEVER_LABEL[lever], keyTitles),
      howToEuro: null,
      line: null,
    });
  }
  const active = new Set<Lever>([...inLines, ...caseLevers]);
  const lines: MissingLineView[] = c.gaps.map((g) =>
    "label" in g
      ? {
          id: g.kind === "valore_beneficio" ? `${VALUE_PANEL.lever}${g.key}` : `${VALUE_PANEL.cost}${g.key}`,
          label: plainText(g.label, keyTitles) ?? g.label,
          reason: ROI_GAP_LABEL[g.kind],
        }
      : { id: null, label: ROI_GAP_LABEL[g.kind], reason: "" },
  );
  return {
    source: roi.source,
    statusLabel: ROI_STATUS_LABEL[roi.status] ?? "Stima",
    computed: c.gaps.length === 0,
    figures: valueFigures(c),
    disclaimer: disclaimerFor(roi.status),
    levers,
    inactiveLevers: LEVERS.filter((l) => !active.has(l)).map((lever) => ({ lever, label: LEVER_LABEL[lever] })),
    costs: roi.costLines.map((line) => costRow(line, keyTitles)),
    missing: {
      total: i.questionTotal + lines.length,
      questions: questions.slice(0, MISSING_QUESTIONS_SHOWN),
      questionTotal: i.questionTotal,
      lines,
      needs: roi.whatNeeded.map((w) => plainText(w, keyTitles)).filter((t): t is string => t !== null),
    },
    how: howView(roi, keyTitles),
    kpiTotal: i.kpis.length,
  };
}

/** «Mancano 12 dati per calcolarlo», «Manca 1 dato per calcolarlo», «3 dati ancora da raccogliere». */
export function missingText(n: number, computed: boolean): string | null {
  if (n <= 0) return null;
  const count = formatNumberIt(n);
  if (computed) return n === 1 ? "1 dato ancora da raccogliere" : `${count} dati ancora da raccogliere`;
  return n === 1 ? "Manca 1 dato per calcolarlo" : `Mancano ${count} dati per calcolarlo`;
}

/** Il pannello aperto da `?apri=` sulla pagina Valore, se esiste. */
export type ValuePanel = { kind: "dati" } | { kind: "leva"; row: LeverRowView } | { kind: "costo"; row: CostRowView };

export function valuePanel(apri: string | null | undefined, view: ValueView): ValuePanel | null {
  if (!apri) return null;
  if (apri === VALUE_PANEL.missing) return view.missing.total > 0 || view.missing.needs.length > 0 ? { kind: "dati" } : null;
  const lever = view.levers.find((l) => l.id === apri);
  if (lever) return { kind: "leva", row: lever };
  const cost = view.costs.find((c) => c.id === apri);
  return cost ? { kind: "costo", row: cost } : null;
}
