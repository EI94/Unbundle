/**
 * La Home (rilascio 10, ondata 2b; docs/ui-10/PROPOSTA-10.md §3.3, prototipo S1, S1b, S1c) dai dati letti: un oggetto
 * già deciso, che il componente disegna. Qui niente database: `src/lib/db/queries/use-case-home.ts` legge e chiama
 * `reviewerHome` o `contributorHome`.
 *
 * **Revisori** (S1): il prossimo passo del workspace (D3, `workspaceSteps`), il numero grande «Valore all'anno» con
 * «Tutti i numeri ›», poi quattro righe che aprono un pannello: Iniziative, Persone, Obiettivi, SAL. Una riga a zero
 * non c'è. In un workspace nuovo (S1b) «Per partire» prende il posto del numero grande, e la sua prima riga aperta è il
 * prossimo passo.
 *
 * **Contributori** (S1c): «Proponi un use case» pieno, «I tuoi use case (N)» con codice, titolo e fase, la piega «Chi
 * propone, per area» e la card del corso, se ne seguono uno.
 *
 * Art. 15.4: conteggi di use case, aggregati del Programma, mai una persona.
 * Modulo puro: import relativi `.ts`.
 */
import { formatEuro } from "../use-cases/format.ts";
import type { NeedView } from "../use-cases/needs.ts";
import { nextSalFrom, workspaceSteps, type WorkspaceStepInput } from "../use-cases/panoramica.ts";
import type { ContributorUseCase } from "../use-cases/permissions.ts";
import type { Phase } from "../use-cases/types.ts";
import type { HubItem } from "../use-cases/views.ts";
import type { ProgramView } from "../programma/view.ts";
import { workspaceBase, workspaceStepView, type StepView } from "./next-step.ts";
import { startChecklist, type StartChecklist, type StartFacts } from "./start.ts";
import { HOME_TEXT } from "./text.ts";

// ─── Revisori ────────────────────────────────────────────────────────

/** Le quattro righe e il pannello che ognuna apre (`?apri=`). */
export const HOME_ROW_PANELS = Object.freeze({ iniziative: "iniziative", persone: "persone", obiettivi: "obiettivi", sal: "sal" } as const);
export type HomeRowKey = keyof typeof HOME_ROW_PANELS;

export interface HomeRow {
  key: HomeRowKey;
  title: string;
  /** Il fatto grigio della riga. */
  fact: string;
  /** Il pannello che apre. */
  panel: (typeof HOME_ROW_PANELS)[HomeRowKey];
}

export interface BigNumberView {
  value: string;
  label: string;
  /** La riga grigia: «su 20 use case · in uso 38.000 €». */
  note: string;
}

export interface UseCaseCounts {
  /** Tutti, tranne i chiusi. */
  total: number;
  inProgress: number;
  inUse: number;
}

/** Quanti use case, quanti in realizzazione, quanti in uso (le schede dei revisori, senza i chiusi). */
export function countUseCases(items: readonly Pick<HubItem, "phase">[]): UseCaseCounts {
  return {
    total: items.filter((item) => item.phase !== "chiuso").length,
    inProgress: items.filter((item) => item.phase === "in_realizzazione").length,
    inUse: items.filter((item) => item.phase === "realizzato").length,
  };
}

/** I risultati chiave e il loro avanzamento medio (solo quelli con base, valore e traguardo). */
export function keyResultsProgress(objectives: ProgramView["objectives"]): { total: number; averagePct: number | null } {
  const keyResults = objectives.flatMap((objective) => objective.keyResults);
  const measured = keyResults.map((kr) => kr.progress).filter((p): p is number => p !== null);
  return { total: keyResults.length, averagePct: measured.length ? measured.reduce((sum, p) => sum + p, 0) / measured.length : null };
}

/** «412.000 €», «Valore all'anno», «su 20 use case · in uso 38.000 €»; null senza valore stimato (lo zero non si mostra). */
export function homeBigNumber(view: Pick<ProgramView, "results">): BigNumberView | null {
  const r = view.results;
  if (!(r.estimated > 0)) return null;
  return { value: formatEuro(r.estimated), label: HOME_TEXT.value.label, note: HOME_TEXT.value.note(r.estimatedCount, r.inUseCount > 0 ? r.inUse : null) };
}

/** Il Programma ha almeno uno use case (approvato, in realizzazione o in uso). */
function hasProgram(view: Pick<ProgramView, "initiatives">): boolean {
  return view.initiatives.some((row) => row.count > 0);
}

/** Le quattro righe, senza quelle a zero (§1, regola 5). Obiettivi resta, a chi può sceglierli, per scegliere i KPI. */
export function homeRows(view: ProgramView, counts: UseCaseCounts): HomeRow[] {
  const t = HOME_TEXT;
  const rows: HomeRow[] = [];
  if (counts.total > 0) rows.push({ key: "iniziative", title: t.rows.initiatives, fact: t.facts.initiatives(counts.total, counts.inProgress, counts.inUse), panel: HOME_ROW_PANELS.iniziative });
  const people = view.people;
  const peopleFact = people.training ? t.facts.trained(people.training.trained, view.company.employees) : people.levels ? t.facts.readiness(people.levels.total) : null;
  if (peopleFact) rows.push({ key: "persone", title: t.rows.people, fact: peopleFact, panel: HOME_ROW_PANELS.persone });
  const krs = keyResultsProgress(view.objectives);
  const goalsFact = krs.total > 0 ? t.facts.keyResults(krs.total, krs.averagePct) : view.kpis.length > 0 ? t.facts.kpis(view.kpis.length) : view.viewer.canEdit ? t.facts.chooseKpis : null;
  if (goalsFact) rows.push({ key: "obiettivi", title: t.rows.goals, fact: goalsFact, panel: HOME_ROW_PANELS.obiettivi });
  const lastOn = view.sal.lastOn;
  const salFact = lastOn ? t.facts.sal(lastOn, nextSalFrom(lastOn) ?? lastOn) : hasProgram(view) ? t.facts.salFirst : null;
  if (salFact) rows.push({ key: "sal", title: t.rows.sal, fact: salFact, panel: HOME_ROW_PANELS.sal });
  return rows;
}

export interface ReviewerHomeInput {
  workspaceId: string;
  companyName: string;
  /** `AAAA-MM-GG` a Roma. */
  today: string;
  isLateralSpace: boolean;
  /** La parola delle unità è «funzione» (`getUnitTerm`). */
  defaultUnitTerm: boolean;
  /** Le schede dei revisori, senza filtri; vuote con l'area «Use case» spenta. */
  items: readonly HubItem[];
  needs: readonly NeedView[] | null;
  suppliers: WorkspaceStepInput["suppliers"];
  /** La pagina del Programma; null con l'area spenta o senza la 0029. */
  program: ProgramView | null;
  /** «Per partire»: i fatti del workspace, letti solo quando nessuno use case è deciso; null altrimenti. */
  start: StartFacts | null;
}

export interface ReviewerHome {
  /** Il pulsante pieno: il passo di «Per partire» in un workspace nuovo, altrimenti il passo del workspace (D3). null: «Tutto in ordine». */
  step: StepView | null;
  start: StartChecklist | null;
  /** Il numero grande: non c'è con «Per partire» né senza valore. */
  bigNumber: BigNumberView | null;
  rows: HomeRow[];
}

/** La Home di un revisore. */
export function reviewerHome(i: ReviewerHomeInput): ReviewerHome {
  const start = i.start ? startChecklist(i.start, { workspaceId: i.workspaceId, isLateralSpace: i.isLateralSpace, defaultUnitTerm: i.defaultUnitTerm }) : null;
  const steps = workspaceSteps({
    items: i.items,
    needs: i.needs,
    today: i.today,
    suppliers: i.suppliers,
    sal: i.program ? { lastOn: i.program.sal.lastOn, canClose: i.program.viewer.canEdit } : null,
  });
  // Sulla Home «Chiudi il SAL» apre il pannello del SAL, con quello che è cambiato e il pulsante.
  const workspaceStep = workspaceStepView(steps, { workspaceId: i.workspaceId, companyName: i.companyName, salHref: null });
  return {
    step: start ? start.next : workspaceStep,
    start,
    bigNumber: start || !i.program ? null : homeBigNumber(i.program),
    rows: i.program ? homeRows(i.program, countUseCases(i.items)) : [],
  };
}

// ─── Contributori ────────────────────────────────────────────────────

export interface ContributorRow {
  id: string;
  code: string | null;
  title: string;
  /** La pillola: «Da valutare · Nuova», «Approvato · T4 2026», «Chiuso · Doppione» (mai il codice di un'altra scheda). */
  phaseLabel: string;
  phase: Phase;
  subState: ContributorUseCase["subState"];
  href: string;
}

/** L'ordine della lista: prima quelli vivi, i chiusi in fondo; dentro una fase l'ordine del server. */
const PHASE_ORDER: readonly Phase[] = ["da_valutare", "approvato", "in_realizzazione", "realizzato", "chiuso"];

/** «I tuoi use case»: solo quelli di chi guarda (`own`), con il link alla loro scheda. */
export function contributorRows(items: readonly ContributorUseCase[], workspaceId: string): ContributorRow[] {
  const base = workspaceBase(workspaceId);
  return items
    .flatMap((item, index) => (item.own ? [{ item, index }] : []))
    .sort((a, b) => PHASE_ORDER.indexOf(a.item.phase) - PHASE_ORDER.indexOf(b.item.phase) || a.index - b.index)
    .map(({ item }) => ({
      id: item.id,
      code: item.own ? item.code : null,
      title: item.title,
      phaseLabel: item.phaseLabel,
      phase: item.phase,
      subState: item.subState,
      href: `${base}/use-cases/${encodeURIComponent(item.id)}`,
    }));
}

/** Le righe della lista in vista: tre, poi «Vedi tutti (N)» (§1, regola 4). */
export const CONTRIBUTOR_ROWS_SHOWN = 3;

export interface CourseRow {
  id: string;
  title: string;
  href: string;
}

/** La card del corso: i corsi che chi guarda segue (`canParticipate`), non quelli che solo gestisce. */
export function courseRows(programs: ReadonlyArray<{ id: string; title: string; canParticipate: boolean }>, workspaceId: string): CourseRow[] {
  const base = workspaceBase(workspaceId);
  return programs.filter((p) => p.canParticipate).map((p) => ({ id: p.id, title: p.title, href: `${base}/learning/${encodeURIComponent(p.id)}` }));
}
