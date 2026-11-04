/**
 * (Rilascio 5, SPEC §7.1, §7.7) I passi della pagina del referente, in funzioni pure: quali passi ci
 * sono, quando un passo è fatto, a quale si arriva (dall'indirizzo `?passo=`, da un ricaricamento, da
 * Indietro e Avanti del browser), il controllo del doppio clic.
 *
 * - Una richiesta al referente ha «Lo use case» (1), «L'impatto» (2: una riga per ogni voce di «Benefici e
 *   costi», o i due numeri del tempo senza modello) e, con domande, «Le domande» (3); una richiesta di sole
 *   domande non ha passi.
 * - Si arriva al primo passo non fatto; un `passo` prima di quello vale, uno dopo si riporta indietro.
 * - Dopo un cambio di passo il pulsante principale ignora il secondo clic di un doppio clic e ogni clic
 *   che arriva entro 450 ms (`isRepeatActivation`, lo stesso della finestra del rilascio 4).
 *
 * Modulo puro: import relativi `.ts`.
 */
import type { ReferentAskView, ReferentCheckView } from "../../../lib/use-cases/referent/contract.ts";
import { REFERENT_CHECK_TEXT } from "../../../lib/use-cases/referent/labels.ts";
import { parseItalianNumber, referentNumber, REFERENT_NUMBER_MAX } from "../../../lib/use-cases/referent/estimate.ts";
import { benefitAnswered } from "../../../lib/use-cases/referent/impact-text.ts";
import { REFERENT_BENEFIT_LIMITS } from "../../../lib/db/use-case-hub-referent-benefits-ddl.ts";
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

/** (Rilascio 5.1) Una riga del passo «L'impatto» è chiusa: una scelta della sua forma, o i due numeri; mai su una cifra cambiata. */
export function benefitDone(row: NonNullable<ReferentCheckView["benefits"]>[number]): boolean {
  return row.draft !== null && !row.draft.stale && benefitAnswered(row.form, row.draft);
}

/** (Rilascio 5.1) Le righe ancora da chiudere, nell'ordine del passo. */
export function missingBenefits(check: Pick<ReferentCheckView, "benefits">): string[] {
  return (check.benefits ?? []).filter((row) => !benefitDone(row)).map((row) => row.key);
}

/**
 * Il passo 2 è fatto: (rilascio 5.1) ogni riga dell'impatto chiusa; senza modello del valore i due numeri
 * del tempo, mai su una stima cambiata.
 */
export function estimateDone(check: Pick<ReferentCheckView, "benefits" | "draft">): boolean {
  if (check.benefits) return check.benefits.length > 0 && missingBenefits(check).length === 0;
  const d = check.draft;
  if (d.stale) return false;
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

/** Il testo del passo per i lettori di schermo: «Lo use case (fatto)», «L'impatto (adesso)». */
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
export function numberField(raw: string, which: "timesPerMonth" | "minutesEach" | "eurYear"): { ok: true; value: number | null } | { ok: false } {
  return referentNumber(raw, which === "eurYear" ? REFERENT_BENEFIT_LIMITS.eurYearMax : REFERENT_NUMBER_MAX[which]);
}

/** Il numero salvato come lo scrive il campo: «1,5», «20». */
export function numberText(value: number | null): string {
  if (value === null) return "";
  return String(value).replace(".", ",");
}

// ─── I rifiuti che riportano a un passo ──────────────────────────────

/**
 * (Rilascio 5) Il passo a cui riporta un «Invia» rifiutato per la conferma o la stima, con il messaggio
 * da dire lì; null per tutti gli altri rifiuti (le domande hanno il loro posto). La nota di «Correggi»
 * con un nome, un'email o un telefono torna con `risposte_da_correggere` e il campo `conferma`: nessuna
 * domanda la mostra, quindi la si mostra al passo 1, sotto «Cosa cambieresti?».
 */
export function stepOfSubmitRefusal(r: { code: string; message: string; issues?: readonly { field?: string; message: string }[] }): { step: CheckStep; message: string } | null {
  if (r.code === "conferma_mancante") return { step: 1, message: r.message };
  if (r.code === "stima_mancante") return { step: 2, message: r.message };
  if (r.code === "risposte_da_correggere") {
    const confirm = r.issues?.find((i) => i.field === "conferma");
    if (confirm) return { step: 1, message: confirm.message };
    // (Rilascio 5.1) Il commento di una riga dell'impatto: si torna al passo 2.
    const benefit = r.issues?.find((i) => i.field?.startsWith("beneficio."));
    if (benefit) return { step: 2, message: benefit.message };
  }
  return null;
}

/**
 * (Rilascio 5) L'avviso da dire subito dopo il salvataggio di una bozza: solo il passo 1 (la nota di
 * «Correggi»), il primo avviso del server. La bozza si salva lo stesso; all'invio un nome e cognome o
 * un'email la fermano.
 */
export function stepOneWarning(body: { step: number }, warnings: readonly { message: string }[] | undefined): string | null {
  return body.step === 1 ? (warnings?.[0]?.message ?? null) : null;
}

/** Il segnaposto di un campo: il numero del team, scritto come nel campo. */
export function placeholderOf(n: number | null): string {
  return n === null ? "" : numberText(Math.round(n * 10) / 10);
}

export { parseItalianNumber };
