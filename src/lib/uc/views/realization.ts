/**
 * Il dossier visto dalla pagina Use case (DESIGN §2.1 ingressi 1 e 2, §3.1,
 * §3.2; `docs/use-case/DESIGN.md` §6.5): capitolo «Realizzazione», card della
 * colonna «In realizzazione» e i testi di partenza di «Avvia la realizzazione».
 *
 * - `dossierCardView` e `realizationDossierView`: dai fatti letti in
 *   `queries/uc-realization.ts` ai dati che i componenti ricevono come props
 *   (stato, un solo numero di avanzamento, «Tocca a te» o la prossima tappa,
 *   le tre cifre del conto, il link solo a chi apre il dossier).
 * - `startDefaults`, `realizationDescription`, `dossierCodeFor`: nome, frase,
 *   descrizione iniziale e codice del dossier nuovo, dallo use case.
 *
 * Il codice dello use case (es. XX-0012) non è un codice interno: si mostra.
 * Il nome di chi ha proposto non entra mai nel dossier.
 *
 * Modulo puro e senza dipendenze di Node.
 */
import { CASE_STATUS_LABEL } from "../case-state.ts";
import type { Json } from "../types.ts";
import type { CaseRole, CaseStatus, SemaforoColor } from "../vocab.ts";
import { formatDayIt, formatEuro, formatNumberIt } from "./format.ts";
import { CASE_STATUS_TONE } from "./labels.ts";
import { caseNextSteps, nextStepFor, resolveStepHref, type NextStepInput } from "./next-step.ts";
import { parseBenefitLines, parseCostLines } from "./roi.ts";
import { computeRoi } from "./roi-edit.ts";

// ── Testi (DESIGN §3.1, §3.2; `docs/use-case/DESIGN.md` §14.3) ────────

export const REALIZATION_TEXT = {
  notStartedTitle: "La realizzazione non è ancora partita.",
  notStartedBody: "Il dossier raccoglie i dati dal cliente e prepara lo sviluppo.",
  start: "Avvia la realizzazione",
  onlyLateralSpace: "La realizzazione la avvia Lateral Space.",
  dossier: "Dossier",
  nextMilestone: "Prossima tappa",
  cost: "Costo di realizzazione",
  benefit: "Beneficio all'anno",
  breakEven: "Pareggio",
  toCompute: "da calcolare",
  open: "Apri il dossier",
  membersOnly: "Il dossier lo vedono i suoi membri e chi gestisce il workspace.",
  closed: "Il dossier è chiuso.",
  unavailable: "Il riepilogo del dossier non è disponibile ora.",
  myTurn: "Tocca a te",
  emptyTitle: "Ancora nulla in realizzazione",
  emptyBody: "Un dossier si avvia dalla scheda di uno use case approvato.",
  readOnly: "Configurazione da completare: manca l'elenco dei domini di Lateral Space. Finché manca, i dossier sono in sola lettura.",
  noTemplates: "Nessuno schema disponibile: chiedi a Lateral Space di pubblicarne uno.",
  creating: "Stiamo preparando il dossier: ci vuole qualche secondo.",
  footnote: "Il dossier nasce in bozza e ne sei il responsabile. Prende il codice e i testi dello use case.",
  noPrefix: "Questo workspace non ha ancora un prefisso per i codici. Impostalo in Impostazioni.",
  alreadyStarted: "Questo use case ha già un dossier.",
} as const;

// ── Codice e titolo dello use case ────────────────────────────────────

export const DOSSIER_CODE = /^[A-Z0-9][A-Z0-9-]{1,39}$/;

/** Codice e titolo da mostrare: quelli dello use case; senza scheda madre (o senza codice) quelli del dossier. */
export function dossierIdentity(i: { caseCode: string; caseTitle: string; useCase: { code: string | null; title: string } | null }): { code: string | null; title: string } {
  const useCaseCode = i.useCase?.code?.trim() || null;
  const code = useCaseCode ?? (i.caseCode.trim() || null);
  const title = i.useCase?.title.trim() || i.caseTitle.trim();
  return { code, title };
}

/** «XX-0012 · Smistamento richieste», oppure il solo titolo. */
export function codeAndTitle(code: string | null, title: string): string {
  return code ? `${code} · ${title}` : title;
}

// ── Cifre del conto ───────────────────────────────────────────────────

export interface RoiTotals {
  implementation: number | null;
  annualBenefit: number | null;
  breakEvenMonths: number | null;
}

type RoiRow = Readonly<Record<string, unknown>>;

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function json(v: unknown): Json | undefined {
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as Json;
    } catch {
      return undefined;
    }
  }
  return v as Json | undefined;
}

/**
 * Totali del conto del dossier (modello più recente dello scenario base): le
 * colonne salvate da «Valore» (`implementation_cost`, `annual_benefit`,
 * `break_even_months`) quando ci sono, altrimenti `computeRoi` sulle righe.
 * Senza modello tutto resta da calcolare.
 */
export function roiTotals(row: RoiRow | null | undefined): RoiTotals {
  if (!row) return { implementation: null, annualBenefit: null, breakEvenMonths: null };
  const content = json(row.content);
  const extras = content && typeof content === "object" && !Array.isArray(content) ? ((content as Record<string, Json>).benefit_extras ?? {}) : {};
  const computed = computeRoi({
    costLines: parseCostLines(json(row.cost_lines) ?? []),
    benefitLines: parseBenefitLines(json(row.benefit_lines) ?? [], extras && typeof extras === "object" && !Array.isArray(extras) ? (extras as Record<string, Json>) : {}),
    horizonYears: num(row.horizon_years),
    discountRate: num(row.discount_rate),
    adoptionRate: num(row.adoption_rate),
  });
  return {
    implementation: num(row.implementation_cost) ?? computed.implementation,
    annualBenefit: num(row.annual_benefit) ?? computed.annualBenefit,
    breakEvenMonths: num(row.break_even_months) ?? computed.breakEvenMonths,
  };
}

/** «4 mesi», «1 mese», «4,5 mesi». */
export function formatBreakEven(months: number | null | undefined): string | null {
  if (typeof months !== "number" || !Number.isFinite(months) || months < 0) return null;
  const text = formatNumberIt(months);
  return text === "1" ? "1 mese" : `${text} mesi`;
}

export interface RealizationFigures {
  /** Null = «da calcolare». */
  cost: string | null;
  benefit: string | null;
  breakEven: string | null;
}

export function realizationFigures(t: RoiTotals): RealizationFigures {
  return { cost: formatEuro(t.implementation), benefit: formatEuro(t.annualBenefit), breakEven: formatBreakEven(t.breakEvenMonths) };
}

// ── Dossier per chi guarda ────────────────────────────────────────────

export interface DossierProgress {
  ok: number;
  required: number;
  /** Indispensabili da verificare: la parte gialla della barra. */
  inReview: number;
}

export interface DossierFacts {
  workspaceId: string;
  caseId: string;
  caseCode: string;
  caseTitle: string;
  status: CaseStatus;
  updatedAt: Date | null;
  useCase: { id: string; code: string | null; title: string } | null;
  /** Membro del dossier (anche con ruoli che ora non valgono) o chi gestisce il workspace. */
  canOpen: boolean;
  /** Ruoli di chi guarda per il prossimo passo (`osservatore` per chi gestisce il workspace). */
  roles: readonly CaseRole[];
  /** Dal motore del prossimo passo (`loadNextStepInput`, o `scopedNextStepStatements` per le card); null se non letto. */
  nextStep: NextStepInput | null;
}

function caseBase(f: Pick<DossierFacts, "workspaceId" | "caseId">): string {
  return `/dashboard/${f.workspaceId.toLowerCase()}/casi-duso/${f.caseId.toLowerCase()}`;
}

function progressOf(input: NextStepInput | null): DossierProgress | null {
  if (!input || input.g1.required <= 0) return null;
  return { ok: input.g1.ok, required: input.g1.required, inReview: input.g1.byGroup.da_verificare ?? 0 };
}

/** Il passo di chi guarda, solo per chi apre il dossier. */
function myStepOf(f: DossierFacts): { label: string; href: string } | null {
  if (!f.canOpen || !f.nextStep) return null;
  const step = nextStepFor(caseNextSteps(f.nextStep, { roles: f.roles }));
  return step ? { label: step.label, href: resolveStepHref(caseBase(f), step.href) } : null;
}

/** «15 nov», oppure il titolo della tappa se non ha una data. */
function milestoneOf(input: NextStepInput | null): string | null {
  const m = input?.nextMilestone;
  if (!m) return null;
  return formatDayIt(m.date, { now: input.now }) ?? (m.title.trim() || null);
}

export interface DossierCardView {
  caseId: string;
  useCaseId: string | null;
  code: string | null;
  title: string;
  statusLabel: string;
  statusTone: SemaforoColor;
  progress: DossierProgress | null;
  /** «Tocca a te · Invia le domande» oppure «Prossima tappa · 23 ott». */
  context: { kind: "turno" | "tappa"; text: string } | null;
  /** Il dossier per chi lo apre, altrimenti la scheda dello use case (null senza scheda). */
  href: string | null;
  myTurn: boolean;
  /** Ultima modifica del dossier (ISO), per l'ordine della colonna. */
  updatedAt: string | null;
}

/** La card della colonna «In realizzazione» (DESIGN §3.1). */
export function dossierCardView(f: DossierFacts): DossierCardView {
  const { code, title } = dossierIdentity(f);
  const step = myStepOf(f);
  const milestone = milestoneOf(f.nextStep);
  const ws = `/dashboard/${f.workspaceId.toLowerCase()}`;
  return {
    caseId: f.caseId,
    useCaseId: f.useCase?.id ?? null,
    code,
    title,
    statusLabel: CASE_STATUS_LABEL[f.status],
    statusTone: CASE_STATUS_TONE[f.status],
    progress: progressOf(f.nextStep),
    context: step
      ? { kind: "turno", text: `${REALIZATION_TEXT.myTurn} · ${step.label}` }
      : milestone
        ? { kind: "tappa", text: `${REALIZATION_TEXT.nextMilestone} · ${milestone}` }
        : null,
    href: f.canOpen ? caseBase(f) : f.useCase ? `${ws}/use-cases/${f.useCase.id.toLowerCase()}` : null,
    myTurn: step !== null,
    updatedAt: f.updatedAt ? f.updatedAt.toISOString() : null,
  };
}

/** Ordine della colonna: prima i dossier in cui tocca a chi guarda, poi per ultima modifica. */
export function sortDossierCards<T extends Pick<DossierCardView, "myTurn" | "updatedAt" | "caseId">>(cards: readonly T[]): T[] {
  return [...cards].sort((a, b) => {
    if (a.myTurn !== b.myTurn) return a.myTurn ? -1 : 1;
    const at = a.updatedAt ?? "";
    const bt = b.updatedAt ?? "";
    if (at !== bt) return at < bt ? 1 : -1;
    return a.caseId < b.caseId ? -1 : a.caseId > b.caseId ? 1 : 0;
  });
}

export interface RealizationDossierView {
  caseId: string;
  statusLabel: string;
  statusTone: SemaforoColor;
  /** Chiuso: «Il dossier è chiuso.». */
  closed: boolean;
  progress: DossierProgress | null;
  /** «Tocca a te · <passo>», al posto della tappa, solo per chi apre il dossier. */
  myStep: { label: string; href: string } | null;
  /** «15 nov». */
  nextMilestone: string | null;
  figures: RealizationFigures;
  /** «Apri il dossier»: solo per chi lo può aprire. */
  href: string | null;
}

/** Il riepilogo del capitolo «Realizzazione» dopo l'avvio (DESIGN §2.1 ingresso 1). */
export function realizationDossierView(f: DossierFacts & { roi: RoiTotals }): RealizationDossierView {
  return {
    caseId: f.caseId,
    statusLabel: CASE_STATUS_LABEL[f.status],
    statusTone: CASE_STATUS_TONE[f.status],
    closed: f.status === "chiuso",
    progress: progressOf(f.nextStep),
    myStep: myStepOf(f),
    nextMilestone: milestoneOf(f.nextStep),
    figures: realizationFigures(f.roi),
    href: f.canOpen ? caseBase(f) : null,
  };
}

/**
 * Il capitolo «Realizzazione» per chi guarda:
 * - `nascosta`: contributori e chi partecipa solo ai corsi (D4);
 * - `spenta`: sezione spenta per il workspace o tabelle uc assenti (la pagina
 *   Use case usa allora «Segna come in realizzazione»);
 * - `errore`: la lettura uc non è riuscita, «Il riepilogo del dossier non è
 *   disponibile ora.»;
 * - `best_practice`: nessun dossier, si chiude con «Segna come diffusa»;
 * - `da_avviare`: nessun dossier; `canStart` solo per Lateral Space su uno use
 *   case «Da costruire» approvato;
 * - `avviata`: il riepilogo del dossier.
 */
export type UseCaseRealization =
  | { state: "nascosta" }
  | { state: "spenta" }
  | { state: "errore" }
  | { state: "best_practice" }
  | { state: "da_avviare"; canStart: boolean; startHref: string | null }
  | { state: "avviata"; dossier: RealizationDossierView };

// ── Avvio: testi e codice dallo use case (§3.2) ───────────────────────

export interface UseCaseTexts {
  title: string;
  /** `use_cases.description`: il problema. */
  problem: string | null;
  /** `use_cases.flow_description`: come funziona. */
  flow: string | null;
  /** `use_cases.human_in_the_loop`: chi controlla. */
  humanInTheLoop: string | null;
  /** `use_cases.guardrails`: limiti. */
  guardrails: string | null;
  /** `use_cases.data_requirements`: dati. */
  dataRequirements: string | null;
}

const ONE_LINER_MAX = 500;
const TITLE_MAX = 255;
const BLOCK_MAX = 4000;

function clean(text: string | null | undefined): string | null {
  const t = text?.replace(/\r\n?/g, "\n").trim();
  return t ? t : null;
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/** «Nome» dal titolo dello use case (al massimo 255 caratteri) e «In una frase» dal problema, in una riga. */
export function startDefaults(u: Pick<UseCaseTexts, "title" | "problem">): { title: string; oneLiner: string } {
  const title = clip(u.title.replace(/\s+/g, " ").trim(), TITLE_MAX);
  const problem = clean(u.problem);
  if (!problem) return { title, oneLiner: "" };
  const firstLine = problem.split("\n").find((l) => l.trim() !== "")?.trim() ?? "";
  const sentence = /^(.+?[.!?])(?:\s|$)/.exec(firstLine)?.[1] ?? firstLine;
  return { title, oneLiner: clip(sentence.replace(/\s+/g, " "), ONE_LINER_MAX) };
}

/**
 * Descrizione iniziale presa dallo use case, da mettere sopra quella dello
 * schema: «In breve» con problema e come funziona; chi controlla, limiti e dati
 * nel blocco «Dallo use case», che la Descrizione mostra dentro «Altro». Il
 * proponente non c'è mai.
 */
export function realizationDescription(u: UseCaseTexts): Record<string, Json> {
  const out: Record<string, Json> = {};
  const brief = [clean(u.problem), clean(u.flow)].filter((t): t is string => t !== null).join("\n\n");
  if (brief) out.in_breve = clip(brief, BLOCK_MAX);
  const extra: Record<string, Json> = {};
  const who = clean(u.humanInTheLoop);
  const limits = clean(u.guardrails);
  const data = clean(u.dataRequirements);
  if (who) extra.chi_controlla = clip(who, BLOCK_MAX);
  if (limits) extra.limiti = clip(limits, BLOCK_MAX);
  if (data) extra.dati = clip(data, BLOCK_MAX);
  if (Object.keys(extra).length > 0) out.dallo_use_case = extra;
  return out;
}

/**
 * Codice generato dal nome, come prima dello use case con codice: iniziali in
 * maiuscolo più «-UC-01», il primo numero libero nel workspace
 * («Smistamento richieste» → «SR-UC-01»). Con una sola parola, le sue prime
 * lettere.
 */
export function generatedCaseCode(title: string, taken: ReadonlySet<string>): string {
  const words = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  let stem = words.map((w) => w[0]).join("").slice(0, 6);
  if (stem.length < 2) stem = (words[0] ?? "").slice(0, 4);
  if (stem.length < 2) stem = "UC";
  if (!/^[A-Z0-9]/.test(stem)) stem = `U${stem}`;
  for (let n = 1; n <= 999; n++) {
    const code = `${stem}-UC-${String(n).padStart(2, "0")}`;
    if (!taken.has(code)) return code;
  }
  return `${stem}-UC-${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

/** Prefisso dei codici generati da un nome, per leggere quelli già presi. */
export function generatedCodeStem(title: string): string {
  return generatedCaseCode(title, new Set()).replace(/-UC-01$/, "");
}

export type DossierCodeChoice = { ok: true; code: string; source: "use_case" | "generato" } | { ok: false; reason: "codice_mancante" };

/**
 * Il codice del dossier nuovo (PIANO-LAVORI §3.4, C10):
 * - con la colonna `use_cases.code` (0019) è quello dello use case, e uno use
 *   case senza codice non parte;
 * - senza la colonna resta il codice generato dal nome.
 */
export function dossierCodeFor(i: { hasCodeColumn: boolean; useCaseCode: string | null; title: string; taken: ReadonlySet<string> }): DossierCodeChoice {
  if (i.hasCodeColumn) {
    const code = i.useCaseCode?.trim().toUpperCase() ?? "";
    return DOSSIER_CODE.test(code) ? { ok: true, code, source: "use_case" } : { ok: false, reason: "codice_mancante" };
  }
  return { ok: true, code: generatedCaseCode(i.title, i.taken), source: "generato" };
}
