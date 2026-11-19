/**
 * Il prossimo passo come lo disegna `NextStep` (src/components/ui-10/next-step.tsx): il verbo del pulsante, l'icona,
 * il perché del «?», se tocca a chi guarda e dove porta. Due fonti, una forma:
 * - il passo del workspace (D3, `workspaceSteps` di src/lib/use-cases/panoramica.ts), uguale sulla Home e sulla
 *   Panoramica di «Use case»;
 * - il primo passo aperto di «Per partire» (`startChecklist`), che sulla Home di un workspace nuovo prende il suo posto.
 *
 * Modulo puro: import relativi `.ts`.
 */
import type { WorkspaceStep } from "../use-cases/panoramica.ts";
import { HOME_TEXT, turnTo } from "./text.ts";

/** Le icone dei passi: la parola sta sempre accanto (§5.8). */
export type StepIcon = "fornitori" | "decidi" | "chiedi" | "verifica" | "sal" | "racconta" | "appunti" | "processi" | "obiettivi" | "proponi";

export interface StepView {
  /** La regola che l'ha deciso: `fornitori`, `decidere`…, `per-partire-processi`… */
  key: string;
  icon: StepIcon;
  /** Il verbo del pulsante; quando non tocca a chi guarda, le parole dello stato. */
  label: string;
  /** Il testo del «?»: il perché e, se c'è, il passo dopo («Poi: …»). Vuoto: niente «?». */
  why: string;
  /** Tocca a chi guarda: il pulsante pieno. */
  mine: boolean;
  /** «Tocca a …» quando non tocca a chi guarda; null altrimenti. */
  turn: string | null;
  /** Dove porta il pulsante. null: un'azione della pagina (`panel`). */
  href: string | null;
  /** Il pannello della pagina che il pulsante apre al posto di un link (la Home: il SAL). */
  panel: "sal" | null;
}

export interface StepLinks {
  workspaceId: string;
  /** Il nome del cliente, per «Tocca a …» dell'ok sui fornitori. */
  companyName: string;
  /** «Chiudi il SAL»: null sulla Home, dove apre il pannello del SAL; dalla Panoramica la Home con `?apri=sal`. */
  salHref: string | null;
}

/** La radice del workspace: `/dashboard/<ws>`. */
export const workspaceBase = (workspaceId: string) => `/dashboard/${workspaceId}`;

/**
 * Dove porta ogni passo del workspace (D3). «Chiedi» e «Verifica» aprono «Cosa serve» sullo stato che dicono
 * (`stato=`): il pulsante pieno della vista segue lo stato, così la pagina non contraddice il pulsante che l'ha aperta.
 */
export function workspaceStepHref(step: WorkspaceStep, links: StepLinks): string | null {
  const base = workspaceBase(links.workspaceId);
  switch (step.key) {
    case "fornitori":
      return `${base}/settings#sub-responsabili`;
    case "decidere":
      return `${base}/use-cases?vista=da-decidere`;
    case "chiedere":
      return `${base}/use-cases?vista=cosa-serve&trimestre=${encodeURIComponent(step.quarter)}&stato=da-chiedere`;
    case "verificare":
      return `${base}/use-cases?vista=cosa-serve&stato=da-verificare`;
    case "sal":
      return links.salHref;
  }
}

/** Il pezzo del «Poi: …»: il passo che viene dopo, in poche parole. */
export function workspaceStepThen(step: WorkspaceStep): string {
  const t = HOME_TEXT.steps;
  switch (step.key) {
    case "fornitori":
      return t.fornitori.then;
    case "decidere":
      return t.decidere.then(step.count);
    case "chiedere":
      return t.chiedere.then(step.count, step.quarter);
    case "verificare":
      return t.verificare.then(step.count);
    case "sal":
      return t.sal.then;
  }
}

function whyOf(step: WorkspaceStep): string {
  const t = HOME_TEXT.steps;
  switch (step.key) {
    case "fornitori":
      return t.fornitori.why(step.waiting);
    case "decidere":
      return t.decidere.why(step.count, step.oldestDays);
    case "chiedere":
      return t.chiedere.why(step.quarter);
    case "verificare":
      return t.verificare.why(step.count);
    case "sal":
      return step.first || step.lastOn === null || step.days === null ? t.sal.whyFirst : t.sal.why(step.lastOn, step.days);
  }
}

/**
 * Il primo passo di `steps` (D3) da disegnare, con il secondo nel «Poi: …» del «?». null: «Tutto in ordine», senza
 * pulsante. Ai passi che non sono di chi guarda le parole dello stato e «Tocca a …», senza pulsante.
 */
export function workspaceStepView(steps: readonly WorkspaceStep[], links: StepLinks): StepView | null {
  const [step, next] = steps;
  if (!step) return null;
  const t = HOME_TEXT.steps;
  const why = t.withThen(whyOf(step), next ? workspaceStepThen(next) : null);
  const href = workspaceStepHref(step, links);
  const base = { key: step.key, why, href, panel: step.key === "sal" && href === null ? ("sal" as const) : null };
  switch (step.key) {
    case "fornitori":
      return step.mine
        ? { ...base, icon: "fornitori", label: t.fornitori.cta, mine: true, turn: null }
        : { ...base, icon: "fornitori", label: t.fornitori.status, mine: false, turn: turnTo(links.companyName) };
    case "decidere":
      return { ...base, icon: "decidi", label: t.decidere.cta(step.count), mine: true, turn: null };
    case "chiedere":
      return { ...base, icon: "chiedi", label: t.chiedere.cta(step.count), mine: true, turn: null };
    case "verificare":
      return { ...base, icon: "verifica", label: t.verificare.cta(step.count), mine: true, turn: null };
    case "sal":
      return step.mine
        ? { ...base, icon: "sal", label: t.sal.cta, mine: true, turn: null }
        : { ...base, icon: "sal", label: t.sal.status, mine: false, turn: t.sal.turn };
  }
}
