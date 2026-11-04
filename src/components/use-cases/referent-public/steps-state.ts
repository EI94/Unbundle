/**
 * (Rilascio 5, SPEC §7.1, §7.7) I passi della pagina del referente, in funzioni pure: quali passi ci
 * sono, quando un passo è fatto, a quale si arriva (dall'indirizzo `?passo=`, da un ricaricamento, da
 * Indietro e Avanti del browser), il controllo del doppio clic.
 *
 * - Una richiesta al referente ha «Lo use case» (1), «Il tempo» (2) e, con domande, «Le domande» (3); una
 *   richiesta di sole domande non ha passi.
 * - Si arriva al primo passo non fatto; un `passo` prima di quello vale, uno dopo si riporta indietro.
 * - Dopo un cambio di passo il pulsante principale ignora il secondo clic di un doppio clic e ogni clic
 *   che arriva entro 450 ms (`isRepeatActivation`, lo stesso della finestra del rilascio 4).
 *
 * Modulo puro: import relativi `.ts`.
 */
import type { ReferentAskView, ReferentCheckView } from "../../../lib/use-cases/referent/contract.ts";
import { REFERENT_CHECK_TEXT } from "../../../lib/use-cases/referent/labels.ts";
import { parseItalianNumber, referentNumber, REFERENT_NUMBER_MAX } from "../../../lib/use-cases/referent/estimate.ts";
export { isRepeatActivation, STEP_SETTLE_MS } from "../../../lib/use-cases/referent/repeat-guard.ts";

export type CheckStep = 1 | 2 | 3;

const T = REFERENT_CHECK_TEXT;

/** La richiesta al referente con la conferma ancora da inviare: la pagina a passi. */
export function hasSteps(view: ReferentAskView): view is ReferentAskView & { check: ReferentCheckView } {
  return view.kind === "referente" && view.check !== null && view.check.submittedAt === null && view.state === "aperta";
}

/** Le domande ancora da chiudere o da vedere nel passo 3 (quelle aperte). */
function openQuestions(view: ReferentAskView): number {
  return view.questions.filter((q) => q.state === "aperta").length;
}

/** I passi della richiesta: [1, 2] e 3 con domande aperte; [] per una richiesta di sole domande. */
export function stepsOf(view: ReferentAskView): CheckStep[] {
  if (!hasSteps(view)) return [];
  return openQuestions(view) > 0 ? [1, 2, 3] : [1, 2];
}

/** «Lo use case» è fatto: «Sì, è così», oppure «Correggi» con una nota di almeno 2 caratteri. */
export function confirmDone(draft: ReferentCheckView["draft"]): boolean {
  if (draft.confirm === "si") return true;
  return draft.confirm === "correggi" && (draft.note ?? "").trim().length >= 2;
}

/** «Il tempo» è fatto: una scelta sulla stima del team, oppure i due numeri senza stima; mai su una stima cambiata. */
export function estimateDone(check: Pick<ReferentCheckView, "team" | "draft">): boolean {
  const d = check.draft;
  if (d.stale) return false;
  if (check.team) return d.estimate !== null;
  return d.timesPerMonth !== null && d.minutesEach !== null;
}

/** Il primo passo non fatto (o l'ultimo, se sono tutti fatti). */
export function firstOpenStep(view: ReferentAskView): CheckStep {
  if (!hasSteps(view)) return 3;
  if (!confirmDone(view.check.draft)) return 1;
  if (!estimateDone(view.check)) return 2;
  const steps = stepsOf(view);
  return steps[steps.length - 1];
}

/** `?passo=2` → 2; tutto il resto → null. */
export function parseStep(value: string | null | undefined): CheckStep | null {
  return value === "1" ? 1 : value === "2" ? 2 : value === "3" ? 3 : null;
}

/** Il passo da mostrare: quello chiesto, se non è dopo il primo non fatto; altrimenti quello. */
export function resolveStep(view: ReferentAskView, requested: CheckStep | null): CheckStep {
  const allowed = firstOpenStep(view);
  if (requested === null) return allowed;
  const steps = stepsOf(view);
  if (!steps.includes(requested)) return allowed;
  return requested <= allowed ? requested : allowed;
}

/** L'indirizzo di un passo (solo la parte `?passo=`, il percorso resta). */
export function stepSearch(step: CheckStep): string {
  return `?passo=${step}`;
}

/** Il testo del passo per i lettori di schermo: «Lo use case (fatto)», «Il tempo (adesso)». */
export function stepLabel(step: CheckStep, state: "done" | "current" | "later"): { text: string; suffix: string } {
  const text = step === 1 ? T.steps.useCase : step === 2 ? T.steps.time : T.steps.questions;
  return { text, suffix: state === "done" ? T.steps.done : state === "current" ? T.steps.current : "" };
}

/** Lo stato di ogni passo nella barra, rispetto a quello di adesso. */
export function stepStates(view: ReferentAskView, current: CheckStep): { step: CheckStep; state: "done" | "current" | "later" }[] {
  if (!hasSteps(view)) return [];
  const done = (s: CheckStep) => (s === 1 ? confirmDone(view.check.draft) : s === 2 ? estimateDone(view.check) : false);
  return stepsOf(view).map((step) => ({ step, state: step === current ? "current" : done(step) ? "done" : "later" }));
}

// ─── Il passo «Il tempo»: i numeri ───────────────────────────────────

/** Un numero scritto nel campo: vuoto (null), valido, oppure non valido. */
export function numberField(raw: string, which: "timesPerMonth" | "minutesEach"): { ok: true; value: number | null } | { ok: false } {
  return referentNumber(raw, REFERENT_NUMBER_MAX[which]);
}

/** Il numero salvato come lo scrive il campo: «1,5», «20». */
export function numberText(value: number | null): string {
  if (value === null) return "";
  return String(value).replace(".", ",");
}

/** L'etichetta del primo campo con la stima del team: sempre «Volte al mese» (l'unità del modello è al singolare). */
export function perMonthLabel(): string {
  return T.estimate.perMonth;
}

/** Il segnaposto di un campo: il numero del team, scritto come nel campo. */
export function placeholderOf(n: number | null): string {
  return n === null ? "" : numberText(Math.round(n * 10) / 10);
}

export { parseItalianNumber };
