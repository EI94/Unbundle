/**
 * Righe del conto come le modifica Lateral Space (DESIGN §3.8, Valore), il
 * calcolo di pareggio e valore nel tempo e i totali che il salvataggio scrive
 * in `uc_roi_models`. Modulo puro e leggero: lo usa anche l'editor nel browser.
 *
 * Il comando `updateCaseRoi` tiene sulla riga di beneficio anche i testi del
 * caso (etichetta della leva, dati necessari, esempio illustrativo, riferimenti
 * non risolti) e accetta tipo di costo e leva ancora da indicare (`null`). I
 * modelli salvati prima li avevano in `content.benefit_extras`: la pagina li
 * rilegge da lì quando la riga non li ha, e il primo salvataggio li riporta
 * sulle righe e toglie `benefit_extras`.
 */
import { LEVERS, type Lever } from "../vocab.ts";

export const COST_KINDS = ["una_tantum", "ricorrente", "escluso"] as const;
export type CostKind = (typeof COST_KINDS)[number];

export const LINE_STATUSES = ["da_raccogliere", "stima", "confermato"] as const;
export type LineStatus = (typeof LINE_STATUSES)[number];

export const COST_KIND_LABEL: Readonly<Record<CostKind, string>> = { una_tantum: "Una tantum", ricorrente: "Ricorrente (all'anno)", escluso: "Escluso dal conto" };
export const LINE_STATUS_LABEL: Readonly<Record<LineStatus, string>> = { da_raccogliere: "Da raccogliere", stima: "Stima", confermato: "Confermato" };

/**
 * Nomi delle 8 leve in italiano semplice, gli stessi di `LEVER_META`
 * (`components/uc/common/lever-icons.tsx`), per i testi dei moduli puri.
 */
export const LEVER_LABEL: Readonly<Record<Lever, string>> = {
  tempo: "Tempo",
  output: "Output",
  qualita: "Qualità",
  nuove_capacita: "Nuove capacità",
  decisioni: "Decisioni",
  costi: "Costi",
  ricavi: "Ricavi",
  rischio: "Rischio",
};

/** Valori di `?apri=` della pagina Valore: «Dati che mancano», una leva, una riga di costo. */
export const VALUE_PANEL = { missing: "dati", lever: "leva-", newLever: "nuova-leva-", cost: "costo-" } as const;

/** Riga di beneficio nuova per una leva attiva che non ne ha ancora una (chiave unica). */
export function newBenefitLine(lever: Lever, existing: readonly Pick<BenefitLine, "key">[]): BenefitLine {
  const used = new Set(existing.map((b) => b.key));
  let key: string = lever;
  for (let n = 2; used.has(key); n++) key = `${lever}_${n}`;
  return {
    key,
    lever,
    leverLabel: LEVER_LABEL[lever],
    formula: null,
    inputs: [],
    value: null,
    status: "stima",
    source: null,
    howToEuro: null,
    dataNeeded: [],
    example: null,
    unresolvedRefs: [],
  };
}

/** Nome della leva di una riga di beneficio: quello della leva, poi quello del caso, poi la chiave. */
export function benefitLabel(b: Pick<BenefitLine, "key" | "lever" | "leverLabel">): string {
  return b.lever ? LEVER_LABEL[b.lever] : (b.leverLabel ?? b.key);
}

export interface CostLine {
  key: string;
  label: string;
  kind: CostKind | null;
  tipoTesto: string | null;
  howEstimated: string | null;
  value: number | null;
  status: LineStatus;
  source: string | null;
  /** Autorizzata per iscritto (art. 8.4): sì, no, oppure da chiedere (null). */
  authorized: boolean | null;
  itemKey: string | null;
}

export interface BenefitExtras {
  leverLabel: string | null;
  dataNeeded: string[];
  example: string | null;
  unresolvedRefs: string[];
}

export interface BenefitLine extends BenefitExtras {
  key: string;
  lever: Lever | null;
  formula: string | null;
  inputs: string[];
  value: number | null;
  status: LineStatus;
  source: string | null;
  howToEuro: string | null;
}

/** Leva dal testo («Nuove capacità» → `nuove_capacita`). */
export function leverFromLabel(label: string | null | undefined): Lever | null {
  if (!label) return null;
  const k = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return (LEVERS as readonly string[]).includes(k) ? (k as Lever) : null;
}

/** Tipo di costo dal testo («una tantum …», «ricorrente …», «escluso …»). */
export function costKindFromText(text: string | null | undefined): CostKind | null {
  const t = (text ?? "").trim().toLowerCase();
  if (t.startsWith("una tantum") || t === "una_tantum") return "una_tantum";
  if (t.startsWith("ricorrent")) return "ricorrente";
  if (t.startsWith("esclus")) return "escluso";
  return null;
}

/**
 * Cosa manca al conto, riga per riga: il tipo o il valore di una riga, oppure
 * nessuna riga di un lato. `key` e `label` sono quelli della riga.
 */
export type RoiGap =
  | { kind: "tipo_costo" | "valore_costo" | "valore_beneficio"; key: string; label: string }
  | { kind: "nessun_costo" | "nessun_beneficio" };

export const ROI_GAP_LABEL: Readonly<Record<RoiGap["kind"], string>> = {
  tipo_costo: "Tipo di costo da indicare",
  valore_costo: "Costo da stimare",
  valore_beneficio: "Beneficio da stimare",
  nessun_costo: "Nessuna riga di costo",
  nessun_beneficio: "Nessuna riga di beneficio",
};

/** Valori mancanti o righe senza tipo: il conto resta «da calcolare». */
export interface RoiComputation {
  implementation: number | null;
  annualRun: number | null;
  annualBenefit: number | null;
  breakEvenMonths: number | null;
  value: number | null;
  horizonYears: number;
  discounted: boolean;
  /** Cosa manca, in parole («Costo da stimare: Licenze»): una riga per lacuna. */
  missing: string[];
  /** Le stesse lacune, con la riga a cui si riferiscono. */
  gaps: RoiGap[];
  /** Spiegazione in una frase del risultato o di cosa manca. */
  note: string;
}

const round = (n: number, digits = 0) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/**
 * Pareggio e valore nel tempo (spec ROI): pareggio in mesi = costo di
 * implementazione / (beneficio annuo − costo annuo di esercizio) × 12; valore
 * = somma dei benefici netti annui (scontati al tasso indicato, se c'è) meno il
 * costo di implementazione. Il beneficio conta solo la quota adottata, se
 * indicata. Finché manca un valore il risultato è «da calcolare».
 */
export function computeRoi(i: {
  costLines: readonly Pick<CostLine, "key" | "label" | "kind" | "value">[];
  benefitLines: readonly Pick<BenefitLine, "key" | "leverLabel" | "lever" | "value">[];
  horizonYears?: number | null;
  discountRate?: number | null;
  adoptionRate?: number | null;
}): RoiComputation {
  const horizonYears = i.horizonYears && i.horizonYears > 0 ? Math.floor(i.horizonYears) : 5;
  const gaps: RoiGap[] = [];
  for (const c of i.costLines) {
    if (c.kind === null) gaps.push({ kind: "tipo_costo", key: c.key, label: c.label });
    else if (c.kind !== "escluso" && c.value === null) gaps.push({ kind: "valore_costo", key: c.key, label: c.label });
  }
  for (const b of i.benefitLines) if (b.value === null) gaps.push({ kind: "valore_beneficio", key: b.key, label: benefitLabel(b) });
  if (i.costLines.length === 0) gaps.push({ kind: "nessun_costo" });
  if (i.benefitLines.length === 0) gaps.push({ kind: "nessun_beneficio" });
  const missing = gaps.map((g) => ("label" in g ? `${ROI_GAP_LABEL[g.kind]}: ${g.label}` : ROI_GAP_LABEL[g.kind]));
  const empty: RoiComputation = {
    implementation: null,
    annualRun: null,
    annualBenefit: null,
    breakEvenMonths: null,
    value: null,
    horizonYears,
    discounted: false,
    missing,
    gaps,
    note: "Da calcolare: mancano ancora dei valori.",
  };
  if (gaps.length > 0) return empty;
  const sum = (kind: CostKind) => i.costLines.filter((c) => c.kind === kind).reduce((s, c) => s + (c.value ?? 0), 0);
  const implementation = sum("una_tantum");
  const annualRun = sum("ricorrente");
  const adoption = typeof i.adoptionRate === "number" && i.adoptionRate >= 0 && i.adoptionRate <= 1 ? i.adoptionRate : 1;
  const annualBenefit = i.benefitLines.reduce((s, b) => s + (b.value ?? 0), 0) * adoption;
  const net = annualBenefit - annualRun;
  const rate = typeof i.discountRate === "number" && i.discountRate > 0 && i.discountRate < 1 ? i.discountRate : 0;
  let value = -implementation;
  for (let t = 1; t <= horizonYears; t++) value += net / (1 + rate) ** t;
  const breakEvenMonths = net > 0 ? round((implementation / net) * 12, 1) : null;
  return {
    implementation: round(implementation),
    annualRun: round(annualRun),
    annualBenefit: round(annualBenefit),
    breakEvenMonths,
    value: round(value),
    horizonYears,
    discounted: rate > 0,
    missing: [],
    gaps: [],
    note:
      net <= 0
        ? "Con questi valori il beneficio annuo non copre i costi di esercizio: il caso non rientra."
        : rate > 0
          ? `Valore a ${horizonYears} anni con i benefici netti scontati al ${round(rate * 100, 1)}% all'anno.`
          : `Valore a ${horizonYears} anni senza sconto: il tasso non è ancora indicato.`,
  };
}

// ── Totali salvati (`uc_roi_models`) ──────────────────────────────────

/**
 * Totali del conto come li salva `saveCaseRoi` nelle colonne di
 * `uc_roi_models` (DESIGN §3.8, WP5): la pagina Use case li legge come fonte
 * «dossier» del costo e del beneficio senza ricalcolare il conto. Finché il
 * conto è «da calcolare» sono tutti `null`, così la pagina Use case passa alla
 * fonte successiva. `value5y` è sempre a 5 anni, come dice la colonna, anche
 * quando l'orizzonte del modello è diverso; gli altri non dipendono
 * dall'orizzonte. `breakEvenMonths` è `null` anche a conto calcolato quando il
 * beneficio non copre l'esercizio («non rientra»).
 */
export interface RoiTotals {
  implementationCost: number | null;
  annualRunCost: number | null;
  annualBenefit: number | null;
  breakEvenMonths: number | null;
  value5y: number | null;
}

export const EMPTY_ROI_TOTALS: RoiTotals = Object.freeze({ implementationCost: null, annualRunCost: null, annualBenefit: null, breakEvenMonths: null, value5y: null });

export function roiTotals(i: Parameters<typeof computeRoi>[0]): RoiTotals {
  const c = computeRoi(i);
  if (c.gaps.length > 0) return EMPTY_ROI_TOTALS;
  const five = c.horizonYears === 5 ? c : computeRoi({ ...i, horizonYears: 5 });
  return {
    implementationCost: c.implementation,
    annualRunCost: c.annualRun,
    annualBenefit: c.annualBenefit,
    breakEvenMonths: c.breakEvenMonths,
    value5y: five.value,
  };
}

/** Due totali uguali? (i numeri del database arrivano come testo: si confrontano come numeri) */
export function sameRoiTotals(a: RoiTotals, b: RoiTotals): boolean {
  const keys: (keyof RoiTotals)[] = ["implementationCost", "annualRunCost", "annualBenefit", "breakEvenMonths", "value5y"];
  return keys.every((k) => (a[k] === null ? b[k] === null : b[k] !== null && Math.abs(a[k] - b[k]) < 1e-6));
}

// ── Ingresso del comando (`saveRoiAction`; `updateRoiAction` di ieri) ─

export interface RoiUpdateInput {
  costLines?: Record<string, unknown>[];
  benefitLines?: Record<string, unknown>[];
  content?: Record<string, unknown>;
  /**
   * Il modello come l'ha visto chi salva (`updated_at` letto con la pagina), per
   * `saveCaseRoi`: se nel frattempo un altro salvataggio l'ha cambiato, il
   * comando rifiuta invece di riscrivere le sue righe con quelle vecchie.
   */
  seen?: string | null;
}

/** Riga di costo nel formato del comando. */
export function costLineToInput(c: CostLine): Record<string, unknown> {
  return {
    key: c.key,
    label: c.label,
    kind: c.kind,
    tipo_testo: c.tipoTesto,
    how_estimated: c.howEstimated,
    value: c.value,
    status: c.status,
    source: c.source,
    authorized_art_8_4: c.authorized,
    item_key: c.itemKey,
  };
}

/** Riga di beneficio nel formato del comando, con i testi del caso. */
export function benefitLineToInput(b: BenefitLine): Record<string, unknown> {
  return {
    key: b.key,
    lever: b.lever,
    lever_label: b.leverLabel,
    formula: b.formula,
    inputs: b.inputs,
    value: b.value,
    status: b.status,
    source: b.source,
    how_to_euro: b.howToEuro,
    data_needed: b.dataNeeded,
    example: b.example,
    unresolved_refs: b.unresolvedRefs,
  };
}

/**
 * Problemi che il comando rifiuterebbe, detti prima del salvataggio. Tipo di
 * costo e leva da indicare non lo sono: il ROI resta «da calcolare».
 */
export function roiInputProblems(costLines: readonly CostLine[], benefitLines: readonly BenefitLine[] | null): string[] {
  const out: string[] = [];
  for (const c of costLines) if (c.value !== null && (!Number.isFinite(c.value) || c.value < 0)) out.push(`Il costo di «${c.label}» deve essere un numero positivo.`);
  for (const b of benefitLines ?? []) if (b.value !== null && !Number.isFinite(b.value)) out.push(`Il beneficio di «${b.leverLabel ?? b.key}» deve essere un numero.`);
  return out;
}

/**
 * Ingresso per salvare le righe. Con le righe di beneficio va anche `content`
 * (al primo salvataggio porta i testi del ROI del template), senza il
 * `benefit_extras` dei modelli salvati prima: i testi ora stanno sulle righe.
 */
export function roiUpdateInput(i: {
  costLines: readonly CostLine[];
  benefitLines: readonly BenefitLine[] | null;
  content: Readonly<Record<string, unknown>>;
  seen?: string | null;
}): RoiUpdateInput {
  const input: RoiUpdateInput = { costLines: i.costLines.map(costLineToInput) };
  if (i.seen !== undefined) input.seen = i.seen;
  if (i.benefitLines) {
    input.benefitLines = i.benefitLines.map(benefitLineToInput);
    const content: Record<string, unknown> = { ...i.content };
    delete content.benefit_extras;
    input.content = content;
  }
  return input;
}
