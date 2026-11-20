/**
 * (Rilascio 10, docs/ui-10/PROPOSTA-10.md §3.5, D9 (a)) Soluzione: una pagina di lettura. In breve · Il problema · La
 * soluzione · «Come funziona» · Cosa non fa · Altro (chiuso). «Come funziona» disegna i passi come la board, in sola
 * lettura: card, frecce, «◆ decide una persona», il colore dell'agente sui passi che fa l'agente, lo stato delle
 * domande come puntino; con «Oggi | Con l'AI» e l'esempio dall'inizio alla fine. Un passo si apre nel suo pannello
 * (`?apri=passo-<id>`), con le domande e il resto. In fondo «Regole · N ›» apre il pannello delle regole
 * (`?apri=regole`); per Lateral Space e lo sviluppo anche «Vista di analisi ›» e «Modello dati ›». Il controllo
 * «Descrizione · Mappa · Regole · Dati» non c'è più.
 *
 * Qui i testi e le regole pure della pagina e del pannello delle regole. Modulo puro.
 */
import type { CaseRole } from "../vocab.ts";
import { stepTone, type MapPageView, type MapTone, type ProcessStepView, type SolutionNodeView } from "./map.ts";
import { formatCountIt } from "./format.ts";
import { canOpenPage } from "./page-access.ts";
import { RULES_PANEL, RULES_PANEL_PARAMS, RULE_PARAM } from "./solution-panels.ts";
import type { Audience } from "./status-groups.ts";

export { RULES_PANEL, RULES_PANEL_PARAMS, RULE_PARAM } from "./solution-panels.ts";

type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

/** Il primo valore non vuoto di un parametro. */
function firstParam(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s !== "" ? s : null;
}

export const SOLUTION_TEXT = Object.freeze({
  howTitle: "Come funziona",
  howId: "come-funziona",
  /** L'interruttore del processo: «Oggi | Con l'AI», come le schede della board. */
  views: Object.freeze({ oggi: "Oggi", "con-agente": "Con l'AI" } satisfies Record<Exclude<MapPageView, "esempio">, string>),
  viewsLabel: "Il processo, oggi e con l'AI",
  legendLabel: "Che cosa dicono le card",
  legend: (audience: Audience) =>
    audience === "ls"
      ? "Il puntino dice a che punto sono le domande del passo: verde a posto, giallo da verificare, grigio da fare; tratteggiato, nessuna domanda. Il bordo colorato: il passo lo fa l'agente. ◆: decide una persona."
      : "Il puntino dice a che punto sono le domande del passo: verde a posto, giallo in verifica, grigio da rispondere; tratteggiato, nessuna domanda. Il bordo colorato: il passo lo fa l'agente. ◆: decide una persona.",
  example: "Segui un esempio dall'inizio alla fine",
  exampleTitle: "Un esempio dall'inizio alla fine",
  backToProcess: "Torna al processo",
  decides: "Decide una persona",
  who: "Chi:",
  step: (n: number) => `Passo ${n}`,
  agentStep: "Lo fa l'agente",
  stepPanelWho: "Chi lo fa",
  stepPanelTool: "Con che cosa",
  stepPanelTime: "Quanto tempo",
  friction: "Attrito",
  decidesWhat: "Decide la persona",
  enters: "Entra",
  exits: "Esce",
  questions: "Le domande del passo",
  noQuestions: "Nessuna domanda collegata a questo passo.",
  noDescription: "La descrizione non c'è ancora.",
  more: "Altro",
  oldVersion: (n: number) => `Stai leggendo la versione ${n}, non quella attuale.`,
  backToCurrent: "Torna alla versione attuale",
  changedOn: (day: string) => `Modificata il ${day} ·`,
  versions: "Versioni",
  versionsTitle: "Versioni della descrizione",
  editDone: "Fine modifica",
  editComplete: "Completa la descrizione",
  /** «Regole · 40 ›»; senza regole solo «Regole ›» per chi le vede (vincoli compresi). */
  rules: (n: number) => (n > 0 ? `Regole · ${n}` : "Regole"),
  analysis: "Vista di analisi",
  dataModel: "Modello dati",
  /** L'elenco in fondo: le regole e le due pagine senza scheda. */
  partsLabel: "Le altre parti della soluzione",
  /** Le pagine senza scheda: il ritorno alla Soluzione. */
  backToSolution: "Soluzione",
});

/** I testi del pannello «Regole» (F-090). «Lo schema di partenza» è una parola di Lateral Space. */
export const RULES_TEXT = Object.freeze({
  title: "Regole",
  count: (n: number) => `${formatCountIt(n)} ${n === 1 ? "regola" : "regole"}`,
  none: (audience: Audience) => (audience === "ls" ? "Lo schema di partenza non ha regole." : "Nessuna regola ancora."),
  noMatch: (q: string) => `Nessuna regola trovata per “${q}”.`,
  noFilterMatch: "Nessuna regola con questi filtri.",
  clear: "Togli i filtri",
  emptyPage: "Questa pagina è vuota.",
  firstPage: "Torna alla prima pagina",
  back: "Tutte le regole",
});

/** Il pannello di un passo: `?apri=passo-<id>` (l'id del nodo della mappa, codificato). */
export const STEP_PANEL_PREFIX = "passo-";

export function stepPanelParam(stepId: string): string {
  return `${STEP_PANEL_PREFIX}${stepId}`;
}

/** L'id del passo aperto, da `?apri=`; null se il pannello non è di un passo. */
export function stepFromPanel(apri: string | null | undefined): string | null {
  return typeof apri === "string" && apri.startsWith(STEP_PANEL_PREFIX) && apri.length > STEP_PANEL_PREFIX.length ? apri.slice(STEP_PANEL_PREFIX.length) : null;
}

/** Un passo della board in sola lettura. */
export interface BoardStep {
  id: string;
  n: number;
  title: string;
  who: string | null;
  /** «◆ decide una persona». */
  decision: boolean;
  /** Il passo lo fa l'agente: il bordo nel colore dell'agente («Con l'AI», senza una decisione di una persona). */
  agent: boolean;
  /** Lo stato delle domande del passo (la messa peggio); null senza domande. */
  tone: MapTone | null;
}

/**
 * I passi da disegnare. «Con l'AI»: il processo con l'agente, oppure i passi della mappa della soluzione nell'ordine
 * del flusso; i passi senza una decisione di una persona li fa l'agente. «Oggi» e l'esempio: i passi come sono; nessuno
 * ha il colore dell'agente (oggi lavorano le persone; l'esempio segue un caso, passo per passo).
 */
export function boardSteps(view: MapPageView, steps: readonly (ProcessStepView | SolutionNodeView)[]): BoardStep[] {
  return steps.map((s, i) => {
    const decision = "humanDecision" in s && Boolean(s.humanDecision);
    return { id: s.id, n: i + 1, title: s.label, who: s.who, decision, agent: view === "con-agente" && !decision, tone: stepTone(s.items) };
  });
}

/** L'indirizzo di una vista di «Come funziona» sulla Soluzione: «Con l'AI» è quella di partenza, senza parametro. */
export function solutionViewHref(base: string, view: MapPageView): string {
  return `${view === "con-agente" ? base : `${base}?vista=${view}`}#${SOLUTION_TEXT.howId}`;
}

/** L'indirizzo del pannello di un passo, nella vista in cui si è (l'ancora riporta a «Come funziona» alla chiusura). */
export function stepPanelHref(base: string, view: MapPageView, stepId: string): string {
  const q = new URLSearchParams();
  if (view !== "con-agente") q.set("vista", view);
  q.set("apri", stepPanelParam(stepId));
  return `${base}?${q.toString()}`;
}

/** Chi apre la vista di analisi (il grafo della soluzione) e il modello dati dalla Soluzione: Lateral Space e lo sviluppo. */
export function solutionLinksFor(roles: readonly CaseRole[]): { analysis: boolean; dataModel: boolean } {
  const ls = roles.some((r) => r === "ls_lead" || r === "ls_analista" || r === "ls_sviluppatore");
  return { analysis: ls && canOpenPage("mappa", roles), dataModel: ls && canOpenPage("modello_dati", roles) };
}

/**
 * L'indirizzo del pannello delle regole con i parametri di adesso cambiati (`null` toglie): la ricerca, i filtri, i
 * vincoli e la pagina restano; gli altri parametri della Soluzione (`vista`, `versione`, `modifica`) cadono.
 */
export function rulesPanelHref(base: string, sp: SearchParams, patch: Readonly<Record<string, string | null>> = {}): string {
  const q = new URLSearchParams({ apri: RULES_PANEL });
  for (const key of [...RULES_PANEL_PARAMS, RULE_PARAM]) {
    const value = firstParam(sp[key]);
    if (value) q.set(key, value);
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) q.delete(key);
    else q.set(key, value);
  }
  return `${base}?${q.toString()}`;
}
