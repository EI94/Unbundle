import { moduleCompletion, type ModuleCompletion } from "./module-completion.ts";
import type { ObjectiveGrade, PrivateTrainingPack } from "./types.ts";

/**
 * I risultati del corso per chi lo tiene: di gruppo, individuali, da scaricare.
 *
 * Funzione pura: chi la chiama ha già verificato l'utente e i suoi permessi e
 * le passa solo righe del corso. Qui si decide che cosa vede ciascuna sezione.
 * - Il gruppo vale da cinque iscritti in su, e i risultati di un'attività
 *   compaiono solo da cinque consegne: è la promessa fatta ai partecipanti.
 * - «Tutti i turni» deve rispettare la stessa promessa turno per turno, perché
 *   togliendo da «tutti» i numeri di un turno resterebbero quelli degli altri.
 *   Un turno con meno di cinque iscritti resta fuori; e le risposte di
 *   un'attività compaiono solo quando ogni turno che ha consegnato ne ha
 *   almeno cinque.
 * - Il gruppo conta la prima consegna di ogni persona: è la risposta data
 *   prima di leggere il riscontro, quella che dice com'è andata l'aula.
 * - La vista individuale mostra l'ultima consegna, come il partecipante.
 */

export const RESULTS_MINIMUM_GROUP = 5;

export type ResultsScope = "all" | ReadonlySet<string> | null;
export type ResultsAttempt = {
  id: string; enrollmentId: string; userId: string; activityId: string; attemptNumber: number;
  status: string; result: ObjectiveGrade | null; submittedAt: Date | null;
};
export type ResultsEnrollment = { id: string; userId: string; cohortId: string; name: string | null; email: string };
export type ResultsSession = { cohortId: string; startsAt: Date; endsAt: Date; status: string };

export type ResultsCohort = { id: string; startsAt: string; endsAt: string; status: string; live: boolean };
export type GroupOption = { id: string; text: string; count: number; correct: boolean };
export type GroupItem = { id: string; prompt: string; critical: boolean; answered: number; correct: number; options: GroupOption[]; feedback: string };
export type GroupActivity = {
  id: string; title: string; required: boolean; formative: boolean; totalItems: number;
  started: number; submitted: number; visible: boolean;
  achieved: number | null; averageCorrect: number | null; items: GroupItem[];
};
export type GroupResults =
  | { suppressed: true; minimum: number }
  | {
    suppressed: false; minimum: number; enrolled: number; started: number; completed: number; achieved: number; required: number; activities: GroupActivity[];
    /** Turni lasciati fuori da «Tutti i turni» perché hanno meno iscritti della soglia. */
    leftOutTurns: number;
  };
export type IndividualCell = {
  activityId: string; attempts: number; state: "not_started" | "draft" | "submitted";
  attemptId: string | null; result: { correct: number; total: number; status: string; essentialErrors: number } | null;
};
export type IndividualRow = { userId: string; name: string; email: string; cohortId: string; completion: ModuleCompletion; cells: IndividualCell[] };
export type ResultsActivity = { id: string; title: string; required: boolean; formative: boolean; totalItems: number };

const M1 = "m1";

function inScope(scope: ResultsScope, cohortId: string) {
  return scope === "all" || (scope instanceof Set && scope.has(cohortId));
}

/** Turno da mostrare: quello chiesto se visibile, altrimenti quello in corso, altrimenti tutti. */
export function pickCohort(cohorts: ResultsCohort[], requested: string | null | undefined): string | null {
  if (requested === "all") return null;
  if (requested && cohorts.some((cohort) => cohort.id === requested)) return requested;
  return cohorts.find((cohort) => cohort.live)?.id ?? null;
}

function submittedFirst(attempts: ResultsAttempt[], activityId: string) {
  return attempts.find((attempt) => attempt.activityId === activityId && attempt.status === "submitted" && attempt.result);
}

export function buildLearningResults(input: {
  pack: PrivateTrainingPack;
  sessions: ResultsSession[];
  enrollments: ResultsEnrollment[];
  /** In ordine di creazione. */
  attempts: ResultsAttempt[];
  aggregateScope: ResultsScope;
  reviewScope: ResultsScope;
  requestedCohort?: string | null;
  now: number;
  minimum?: number;
}) {
  const { pack, now } = input;
  const minimum = input.minimum ?? RESULTS_MINIMUM_GROUP;
  const visibleScope = (cohortId: string) => inScope(input.aggregateScope, cohortId) || inScope(input.reviewScope, cohortId);
  const cohorts: ResultsCohort[] = input.sessions
    .filter((session) => visibleScope(session.cohortId))
    .map((session) => ({
      id: session.cohortId,
      startsAt: session.startsAt.toISOString(),
      endsAt: session.endsAt.toISOString(),
      status: session.status,
      live: session.status !== "closed" && now >= session.startsAt.getTime() && now < session.endsAt.getTime(),
    }));
  const selectedCohort = pickCohort(cohorts, input.requestedCohort);
  const activities = pack.activities.filter((activity) => activity.module_id === M1 && activity.purpose !== "retake");
  const activityList: ResultsActivity[] = activities.map((activity) => ({
    id: activity.id, title: activity.title, required: activity.completion_gate,
    formative: activity.purpose === "formative", totalItems: activity.item_ids?.length ?? 0,
  }));

  const attemptsByEnrollment = new Map<string, ResultsAttempt[]>();
  for (const attempt of input.attempts) {
    const list = attemptsByEnrollment.get(attempt.enrollmentId) ?? [];
    list.push(attempt);
    attemptsByEnrollment.set(attempt.enrollmentId, list);
  }
  const people = (scope: ResultsScope) => input.enrollments
    .filter((enrollment) => inScope(scope, enrollment.cohortId) && (!selectedCohort || enrollment.cohortId === selectedCohort))
    .map((enrollment) => ({
      enrollment,
      // Solo i tentativi della stessa persona con questa iscrizione.
      attempts: (attemptsByEnrollment.get(enrollment.id) ?? []).filter((attempt) => attempt.userId === enrollment.userId),
    }));
  const completionOf = (attempts: ResultsAttempt[]) => moduleCompletion(pack, M1, attempts.map((attempt) => ({
    activityId: attempt.activityId, status: attempt.status, result: attempt.result ? { status: attempt.result.status } : null,
  })));

  let group: GroupResults | null = null;
  if (input.aggregateScope) {
    const inScopeMembers = people(input.aggregateScope);
    // Più turni insieme: ognuno deve superare la soglia da solo (vedi in alto).
    const combining = !selectedCohort;
    const turnSize = new Map<string, number>();
    for (const member of inScopeMembers) turnSize.set(member.enrollment.cohortId, (turnSize.get(member.enrollment.cohortId) ?? 0) + 1);
    const members = combining ? inScopeMembers.filter((member) => (turnSize.get(member.enrollment.cohortId) ?? 0) >= minimum) : inScopeMembers;
    const leftOutTurns = combining ? [...turnSize.values()].filter((size) => size < minimum).length : 0;
    if (members.length < minimum) group = { suppressed: true, minimum };
    else {
      const completions = members.map((member) => completionOf(member.attempts));
      group = {
        suppressed: false, minimum, enrolled: members.length, leftOutTurns,
        started: members.filter((member) => member.attempts.length > 0).length,
        completed: completions.filter((completion) => completion.status === "completed").length,
        achieved: completions.filter((completion) => completion.outcome === "consolidated").length,
        required: completions[0]?.required ?? 0,
        activities: activities.map((activity) => {
          const perTurn = new Map<string, number>();
          const firsts = members.flatMap((member) => {
            const first = submittedFirst(member.attempts, activity.id);
            if (!first?.result) return [];
            perTurn.set(member.enrollment.cohortId, (perTurn.get(member.enrollment.cohortId) ?? 0) + 1);
            return [first.result];
          });
          // Con più turni, un turno che ha consegnato meno della soglia tiene
          // nascoste le risposte di tutti, finché non arriva alla soglia.
          const visible = firsts.length >= minimum && (!combining || [...perTurn.values()].every((count) => count >= minimum));
          const itemIds = activity.item_ids ?? [];
          return {
            id: activity.id, title: activity.title, required: activity.completion_gate,
            formative: activity.purpose === "formative", totalItems: itemIds.length,
            started: members.filter((member) => member.attempts.some((attempt) => attempt.activityId === activity.id)).length,
            submitted: firsts.length, visible,
            achieved: visible && activity.completion_gate ? firsts.filter((result) => result.status === "consolidated").length : null,
            averageCorrect: visible ? firsts.reduce((sum, result) => sum + result.correct, 0) / firsts.length : null,
            items: !visible ? [] : itemIds.map((itemId) => {
              const item = pack.items.find((entry) => entry.id === itemId)!;
              const answers = firsts.flatMap((result) => result.items.filter((entry) => entry.itemId === itemId));
              // «Non lo so ancora» va in fondo, qualunque sia l'ordine del pacchetto.
              const ordered = [...item.options.filter((option) => option.id !== "unsure"), ...item.options.filter((option) => option.id === "unsure")];
              return {
                id: item.id, prompt: item.prompt, critical: item.critical, feedback: item.feedback,
                answered: answers.length, correct: answers.filter((answer) => answer.correct).length,
                options: ordered.map((option) => ({
                  id: option.id, text: option.text, correct: item.correct_option_ids.includes(option.id),
                  count: answers.filter((answer) => answer.selectedOptionId === option.id).length,
                })),
              };
            }),
          };
        }),
      };
    }
  }

  let individuals: IndividualRow[] | null = null;
  if (input.reviewScope) {
    individuals = people(input.reviewScope).map(({ enrollment, attempts }) => ({
      userId: enrollment.userId,
      name: enrollment.name || enrollment.email,
      email: enrollment.email,
      cohortId: enrollment.cohortId,
      completion: completionOf(attempts),
      cells: activities.map((activity) => {
        const rows = attempts.filter((attempt) => attempt.activityId === activity.id || attempt.activityId === activity.retake_activity_id);
        const latest = rows.at(-1);
        const submitted = rows.filter((attempt) => attempt.status === "submitted" && attempt.result).at(-1);
        return {
          activityId: activity.id,
          attempts: rows.length,
          state: !latest ? "not_started" : submitted ? "submitted" : "draft",
          attemptId: (submitted ?? latest)?.id ?? null,
          result: submitted?.result ? {
            correct: submitted.result.correct, total: submitted.result.total,
            status: submitted.result.status, essentialErrors: submitted.result.essential_errors.length,
          } : null,
        } satisfies IndividualCell;
      }),
    }));
  }

  return { cohorts, selectedCohort, activities: activityList, group, individuals };
}
