/**
 * La testa della Panoramica (rilascio 10, docs/ui-10/PROPOSTA-10.md §3.4) e il prossimo passo del workspace
 * (decisione D3): il numero grande e la regola unica del passo. Qui solo numeri; i testi in `panoramica-top.tsx` e,
 * per il passo, in `src/lib/home/text.ts`.
 *
 * - **Numero grande** (`overviewNumber`): «Valore all'anno · su N use case», gli euro contati degli approvati e in
 *   realizzazione (`roadmapTotals`, le cifre delle card sommate come le scrivono), con a parte il tetto «da
 *   misurare» (`pendingValueTotal`), che nella Home non c'è ancora. La striscia delle fasi, le altre tre cifre e
 *   «Su tutto il portafoglio» escono dalla pagina: i numeri delle fasi stanno nelle viste e nelle sezioni, il costo
 *   di realizzazione nella Home («Iniziative»), gli use case del trimestre nella sua corsia, ore e pareggio nella
 *   Home («Tutti i numeri») e in «Curva del valore».
 * - **Prossimo passo del workspace** (`workspaceSteps`, D3): una regola sola per la Home e per la
 *   Panoramica, in quest'ordine: fornitori da autorizzare · use case da decidere · informazioni da
 *   chiedere per il trimestre · risposte da verificare · SAL dovuto. Prima ciò che blocca altre
 *   persone; niente: «Tutto in ordine».
 *
 * Art. 15.4: conteggi di use case o di esigenze, mai di persone; nessun conto per «Chi» o per parte.
 *
 * Modulo puro: solo import relativi `.ts`.
 */
import { askGroupOf, needAskCountsOf, type NeedView } from "./needs.ts";
import { quarterOfDate } from "./quarter.ts";
import type { Phase, QuarterCode } from "./types.ts";
import { isToDecide, pendingValueTotal, roadmapGroupKey, roadmapTotals, waitingDays, type HubItem } from "./views.ts";

// ─── Il numero grande ────────────────────────────────────────────────

/** Una cifra del numero grande: gli euro e su quanti use case. */
export interface OverviewAmount {
  amountEur: number;
  count: number;
}

/** Il numero grande della Panoramica (solo revisori), dagli use case della pagina (già filtrati, come le corsie). */
export interface OverviewNumber {
  /** «Valore all'anno»: `roadmapTotals().expectedValue`; null senza use case con una cifra contata. */
  value: OverviewAmount | null;
  /** «fino a X € da misurare»: `pendingValueTotal`; null senza voci da misurare. */
  pending: OverviewAmount | null;
}

/**
 * Il numero grande: gli euro contati all'anno e il tetto da misurare, sugli approvati e in realizzazione. Le cifre
 * sono quelle delle card, ognuna arrotondata all'euro: le corsie e «In realizzazione» le scrivono una a una. null
 * senza nessuna delle due: lo zero non si mostra.
 */
export function overviewNumber(items: readonly HubItem[]): OverviewNumber | null {
  const value = roadmapTotals(items).expectedValue;
  const pending = pendingValueTotal(items);
  if (!value && !pending) return null;
  return {
    value: value ? { amountEur: value.amountEur, count: value.count } : null,
    pending: pending ? { amountEur: pending.amountEur, count: pending.count } : null,
  };
}

// ─── Prossimo passo del workspace (D3) ───────────────────────────────

/** Il SAL è dovuto ogni 28 giorni dall'ultimo: «prossimo dal …» della Home. */
export const SAL_EVERY_DAYS = 28;

/** Le cinque regole del passo, nell'ordine di D3. */
export const WORKSPACE_STEP_KEYS = ["fornitori", "decidere", "chiedere", "verificare", "sal"] as const;
export type WorkspaceStepKey = (typeof WORKSPACE_STEP_KEYS)[number];

/**
 * Un passo del workspace. `mine`: tocca a chi guarda (pulsante pieno); altrimenti la riga «Tocca a …»
 * senza pulsante. Decidere, chiedere e verificare li fa ogni revisore (permissions.ts, D3 del 13/10).
 */
export type WorkspaceStep =
  | { key: "fornitori"; mine: boolean; /** Le informazioni da chiedere che l'ok tiene ferme. */ waiting: number }
  | { key: "decidere"; mine: true; count: number; /** I giorni d'attesa del più vecchio. */ oldestDays: number }
  | { key: "chiedere"; mine: true; count: number; quarter: QuarterCode }
  | { key: "verificare"; mine: true; count: number }
  | { key: "sal"; mine: boolean; /** Nessun SAL chiuso ancora. */ first: boolean; lastOn: string | null; /** Giorni dall'ultimo; null al primo. */ days: number | null };

export interface WorkspaceStepInput {
  /** Le schede dei revisori, senza filtri (`listHubItems`). */
  items: readonly HubItem[];
  /** Le esigenze del workspace (`listWorkspaceNeeds`); null: non lette, niente regole 1, 3 e 4. */
  needs: readonly Pick<NeedView, "id" | "type" | "status" | "archivedAt" | "useCaseIds">[] | null;
  /** `AAAA-MM-GG` a Roma. */
  today: string;
  /**
   * L'ok sui fornitori (sub-responsabili), solo dove «Chiedi al referente» è acceso: senza, le domande al
   * referente non partono. `canAuthorize`: chi guarda lo può dare. null: la funzione è spenta o la lettura
   * non è riuscita, e la regola 1 non vale.
   */
  suppliers: { authorized: boolean; canAuthorize: boolean } | null;
  /** Il SAL del Programma: l'ultimo chiuso e se chi guarda lo può chiudere. null senza Programma. */
  sal: { lastOn: string | null; canClose: boolean } | null;
}

/** Giorni da `a` a `b` (`AAAA-MM-GG`), mai negativi. */
function daysFrom(a: string, b: string): number {
  return waitingDays(a, b);
}

/** Il giorno `AAAA-MM-GG` `n` giorni dopo `iso`. */
export function addDays(iso: string, n: number): string {
  const at = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + n);
  return at.toISOString().slice(0, 10);
}

/** Da quando il prossimo SAL è dovuto: l'ultimo più `SAL_EVERY_DAYS`. null senza un SAL chiuso. */
export function nextSalFrom(lastOn: string | null): string | null {
  return lastOn ? addDays(lastOn, SAL_EVERY_DAYS) : null;
}

/** Le fasi del Programma: approvato, in realizzazione, realizzato (`programStageOf`). */
const PROGRAM_PHASES: readonly Phase[] = ["approvato", "in_realizzazione", "realizzato"];

/**
 * Il SAL è dovuto: il primo appena il Programma ha uno use case (approvato, in realizzazione o realizzato),
 * poi dopo `SAL_EVERY_DAYS` giorni dall'ultimo.
 */
export function salDue(lastOn: string | null, today: string, items: readonly Pick<HubItem, "phase">[]): boolean {
  if (lastOn === null) return items.some((item) => PROGRAM_PHASES.includes(item.phase));
  return daysFrom(lastOn, today) >= SAL_EVERY_DAYS;
}

/** I requisiti non archiviati del workspace per gruppo: gli stessi conteggi di «Cosa serve» senza filtri. */
function requirementCounts(needs: NonNullable<WorkspaceStepInput["needs"]>): { toAsk: number; toVerify: number } {
  let toAsk = 0;
  let toVerify = 0;
  const seen = new Set<string>();
  for (const need of needs) {
    if (need.type !== "requisito" || need.archivedAt) continue;
    const id = need.id.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    const group = askGroupOf(need.status);
    if (group === "toAsk") toAsk += 1;
    else if (group === "toVerify") toVerify += 1;
  }
  return { toAsk, toVerify };
}

/**
 * I passi del workspace che valgono adesso, nell'ordine di D3 (il primo è il pulsante della Home e della
 * Panoramica, il secondo il «Poi: …» del suo «?»):
 * 1. **fornitori**: manca l'ok e tiene ferme le domande al referente, cioè c'è almeno un'informazione da
 *    chiedere nel workspace;
 * 2. **decidere**: gli use case che aspettano una decisione (`decideCount`: «Serve info» aspetta chi ha
 *    proposto), con i giorni del più vecchio;
 * 3. **chiedere**: le informazioni da chiedere degli use case approvati per questo trimestre (non quelli già
 *    partiti, scaduti o di altri trimestri: gli stessi del filtro `trimestre` di «Cosa serve»), ognuna una volta;
 * 4. **verificare**: le risposte da verificare, in tutto il workspace (la riga dei conteggi di «Cosa serve»);
 * 5. **sal**: il SAL dovuto (`salDue`).
 * Nessun passo: «Tutto in ordine».
 */
export function workspaceSteps(i: WorkspaceStepInput): WorkspaceStep[] {
  const steps: WorkspaceStep[] = [];
  const open = i.needs ? requirementCounts(i.needs) : null;
  if (i.suppliers && !i.suppliers.authorized && open && open.toAsk > 0) {
    steps.push({ key: "fornitori", mine: i.suppliers.canAuthorize, waiting: open.toAsk });
  }
  const deciding = i.items.filter((item) => isToDecide(item) && item.subState !== "serve_info");
  if (deciding.length > 0) {
    const oldestDays = Math.max(...deciding.map((item) => waitingDays(item.waitingSince, i.today)));
    steps.push({ key: "decidere", mine: true, count: deciding.length, oldestDays });
  }
  if (i.needs) {
    const starting = new Set(
      i.items.filter((item) => item.phase === "approvato" && roadmapGroupKey(item.targetQuarter, i.today) === "questo_trimestre").map((item) => item.id.toLowerCase()),
    );
    const toAsk = starting.size > 0 ? needAskCountsOf(i.needs, starting).toAsk : 0;
    if (toAsk > 0) steps.push({ key: "chiedere", mine: true, count: toAsk, quarter: quarterOfDate(i.today) });
  }
  if (open && open.toVerify > 0) steps.push({ key: "verificare", mine: true, count: open.toVerify });
  if (i.sal && salDue(i.sal.lastOn, i.today, i.items)) {
    steps.push({ key: "sal", mine: i.sal.canClose, first: i.sal.lastOn === null, lastOn: i.sal.lastOn, days: i.sal.lastOn === null ? null : daysFrom(i.sal.lastOn, i.today) });
  }
  return steps;
}

/** Il prossimo passo del workspace (D3): il primo di `workspaceSteps`; null: «Tutto in ordine». */
export function workspaceNextStep(i: WorkspaceStepInput): WorkspaceStep | null {
  return workspaceSteps(i)[0] ?? null;
}
