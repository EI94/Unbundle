import type { JoinOutcome } from "./join.ts";

/**
 * (Ondata 0, docs/ui-10/PROPOSTA-10.md §6.3 voce 0.16) Dopo l'iscrizione da un link si arriva sulla lezione con
 * `?joined=1&outcome=…` (`joinCourseByLinkAction`): la pagina lo dice in una riga. Con `kept_other_cohort` la persona
 * resta nel turno di prima, dove ha già delle risposte: la pagina del link glielo dice prima di aprire il corso e le
 * offre «Chiedi di riaprire il turno» (`requestCohortReopenAction`). Genere neutro. Modulo puro.
 */
export const JOIN_ARRIVAL_TEXT: Readonly<Record<JoinOutcome, string>> = Object.freeze({
  enrolled: "Iscrizione fatta: il corso è qui sotto.",
  already_enrolled: "L'iscrizione c'era già: il corso è qui sotto.",
  moved: "Iscrizione spostata su questa lezione.",
  kept_other_cohort: "Resti nel turno di prima, dove hai già delle risposte salvate.",
});

/** Il bivio di `kept_other_cohort`, sulla pagina del link. */
export const KEPT_OTHER_COHORT_TEXT = Object.freeze({
  title: "Resti nel turno di prima",
  body: "Lì hai già delle risposte salvate, quindi non ti spostiamo. Se quel turno è chiuso, chiedi a chi tiene il corso di riaprirlo.",
  open: "Apri il corso",
  reopen: "Chiedi di riaprire il turno",
  failed: "La richiesta non è partita. Riprova tra poco.",
});

const first = (value: unknown) => (Array.isArray(value) ? value[0] : value);

/** Il messaggio d'arrivo per i parametri della lezione, oppure null (nessun arrivo da un link, o un esito sconosciuto). */
export function joinArrival(joined: unknown, outcome: unknown): string | null {
  if (first(joined) !== "1") return null;
  const o = first(outcome);
  return typeof o === "string" && Object.hasOwn(JOIN_ARRIVAL_TEXT, o) ? JOIN_ARRIVAL_TEXT[o as JoinOutcome] : null;
}
