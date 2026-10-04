import type { PrivateTrainingPack } from "./types.ts";

/**
 * Completamento di un modulo, ricavato da quali attività il corso dichiara
 * obbligatorie (completion_gate) invece che da nomi scritti nel codice.
 *
 * Prima il calcolo cercava le attività "m1-case" e "m1-exit-a"/"m1-exit-b":
 * funzionava solo per il corso con cui il modulo è nato, e con qualunque altro
 * corso nessuno risultava mai completato. La regola resta la stessa: per ogni
 * attività obbligatoria conta l'ultima consegna, anche se avvenuta sul suo
 * recupero; il modulo è completo quando tutte sono consegnate, e l'esito è
 * consolidato solo se lo sono tutte.
 */

type Attempt = { activityId: string; status: string; result?: { status: string } | null };

export type ModuleCompletion = {
  required: number;
  submitted: number;
  status: "not_started" | "in_progress" | "completed";
  outcome: "consolidated" | "needs_practice" | null;
};

export function moduleCompletion(
  pack: PrivateTrainingPack,
  moduleId: string,
  attempts: Attempt[]
): ModuleCompletion {
  const gated = pack.activities.filter(
    (activity) => activity.module_id === moduleId && activity.completion_gate && activity.purpose !== "retake"
  );
  const submittedRows = attempts.filter((attempt) => attempt.status === "submitted");
  const latest = gated.map((activity) =>
    submittedRows
      .filter((row) => row.activityId === activity.id || row.activityId === activity.retake_activity_id)
      .at(-1)
  );
  const submitted = latest.filter(Boolean).length;
  const moduleActivityIds = new Set(
    pack.activities.filter((activity) => activity.module_id === moduleId).map((activity) => activity.id)
  );
  const started = attempts.some((attempt) => moduleActivityIds.has(attempt.activityId));
  const completed = gated.length > 0 && submitted === gated.length;
  return {
    required: gated.length,
    submitted,
    status: completed ? "completed" : started ? "in_progress" : "not_started",
    outcome: completed
      ? latest.every((row) => row?.result?.status === "consolidated")
        ? "consolidated"
        : "needs_practice"
      : null,
  };
}
