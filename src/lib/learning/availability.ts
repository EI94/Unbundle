import { m1ReleaseMinutes } from "./policy.ts";

type ActivityTiming = { module_id: string; type: string; purpose: string };
export type LearningSessionTiming = { startsAt: Date | string; status: string };
export type ActivityAvailability = {
  state: "hidden" | "planned" | "course_closed" | "session_missing" | "session_closed" | "scheduled" | "available";
  readAccess: boolean;
  writeAccess: boolean;
  opensAt: string | null;
  reason: string | null;
};
export function formatLearningDate(value: Date | string): string {
  return new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", dateStyle: "long", timeStyle: "short" }).format(new Date(value));
}

/** Display policy only: callers must authorize the object; the SQL write guard remains authoritative. */
export function activityAvailability({ enabled, programStatus, activity, session, now }: {
  enabled: boolean; programStatus: string; activity: ActivityTiming; session: LearningSessionTiming | null; now: number;
}): ActivityAvailability {
  const blocked = (state: ActivityAvailability["state"], reason: string, opensAt: string | null = null): ActivityAvailability => ({ state, readAccess: state !== "hidden", writeAccess: false, opensAt, reason });
  if (!enabled) return blocked("hidden", "Il percorso non è disponibile per questo account.");
  if (programStatus !== "published") return blocked("course_closed", `${programStatus === "archived" ? "Il corso è archiviato" : "Il corso è chiuso"}. Le risposte salvate restano consultabili, ma non sono modificabili.`);
  const minutes = m1ReleaseMinutes(activity);
  if (minutes === null) return blocked("planned", "Le attività di questo modulo sono in programma e non sono ancora aperte.");
  if (!session) return blocked("session_missing", "Il turno non è configurato. Contatta il responsabile del corso.");
  if (session.status === "closed") return blocked("session_closed", "Il tuo turno è chiuso. Le risposte salvate restano consultabili, ma non sono modificabili.");
  const opens = new Date(session.startsAt).getTime() + minutes * 60_000;
  if (!Number.isFinite(opens) || !Number.isFinite(now) || !["open", "scheduled"].includes(session.status)) return blocked("session_missing", "La disponibilità del turno richiede una verifica del responsabile del corso.");
  if (session.status === "scheduled" && now < opens) return blocked("scheduled", `L’attività sarà disponibile dal ${formatLearningDate(new Date(opens))} (Europe/Rome), oppure quando il formatore aprirà il turno.`, new Date(opens).toISOString());
  return { state: "available", readAccess: true, writeAccess: true, opensAt: new Date(opens).toISOString(), reason: null };
}

export function attemptAccess(status: "draft" | "submitted", availability: ActivityAvailability, retakeAvailability: ActivityAvailability | null) {
  const writeAccess = status === "draft" && availability.writeAccess;
  const canRetake = status === "submitted" && !!retakeAvailability?.writeAccess;
  return {
    writeAccess,
    readOnlyReason: writeAccess ? null : status === "submitted" ? "Questo tentativo è stato consegnato e non può essere modificato." : availability.reason,
    canRetake,
    retakeUnavailableReason: canRetake ? null : status !== "submitted" ? "Consegna prima questo tentativo." : retakeAvailability?.reason ?? "Questa attività non prevede un recupero.",
  };
}

/** Input history is chronological; recovery belongs to its original activity card without changing history. */
export function latestActivityAttempt<T extends { activityId: string }>(activity: { id: string; retake_activity_id?: string }, history: T[]): T | undefined {
  return history.filter(row => row.activityId === activity.id || row.activityId === activity.retake_activity_id).at(-1);
}
