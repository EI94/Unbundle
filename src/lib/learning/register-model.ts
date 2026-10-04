import type { PrivateTrainingPack } from "./types.ts";

/**
 * Regole del registro della formazione IA. Pure, senza database: le stesse
 * per la pagina e per i file esportati, e coperte da test.
 *
 * Il registro documenta la PARTECIPAZIONE alla formazione: chi, quando, a
 * quale contenuto, con quale prova. Non riporta risposte né punteggi. Ai
 * partecipanti è stato promesso che la direzione vede solo dati aggregati
 * delle loro risposte; il registro mantiene quella promessa, e un registro di
 * presenze non ne ha bisogno.
 */

/** Margine prima dell'inizio entro cui un ingresso conta come «alla lezione». */
export const JOIN_EARLY_MINUTES = 60;

export type JoinTiming = "durante_la_lezione" | "prima_della_lezione" | "dopo_la_lezione" | "non_rilevato";

export function joinTiming(joinedAt: Date | string | null, startsAt: Date | string, endsAt: Date | string): JoinTiming {
  if (!joinedAt) return "non_rilevato";
  const joined = new Date(joinedAt).getTime();
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  if (![joined, start, end].every(Number.isFinite)) return "non_rilevato";
  if (joined > end) return "dopo_la_lezione";
  if (joined < start - JOIN_EARLY_MINUTES * 60_000) return "prima_della_lezione";
  return "durante_la_lezione";
}

export const joinTimingLabel: Record<JoinTiming, string> = {
  durante_la_lezione: "Ingresso alla lezione",
  prima_della_lezione: "Iscrizione in anticipo",
  dopo_la_lezione: "Ingresso dopo la lezione",
  non_rilevato: "Assegnato dal formatore",
};

/** Esercitazioni che il corso chiede in un modulo, con la mappa dei recuperi. */
export function requiredActivities(pack: PrivateTrainingPack, moduleId: string) {
  const required = pack.activities
    .filter((activity) => activity.module_id === moduleId && activity.completion_gate && activity.purpose !== "retake")
    .map((activity) => activity.id);
  // Una consegna del recupero conta per l'attività che recupera.
  const parentOf = new Map<string, string>();
  for (const activity of pack.activities) {
    if (activity.retake_activity_id) parentOf.set(activity.retake_activity_id, activity.id);
  }
  return { required, parentOf };
}

export type ParticipationStatus =
  | "esercitazioni_completate"
  | "esercitazioni_in_parte"
  | "nessuna_esercitazione"
  | "partecipazione_non_documentata"
  | "sessione_in_programma"
  | "iscrizione_sospesa"
  | "presenza_manuale";

export const participationLabel: Record<ParticipationStatus, string> = {
  esercitazioni_completate: "Ha consegnato tutte le esercitazioni",
  esercitazioni_in_parte: "Ha consegnato parte delle esercitazioni",
  nessuna_esercitazione: "Accesso durante la lezione, nessuna esercitazione consegnata",
  partecipazione_non_documentata: "Iscritto, partecipazione non documentata",
  sessione_in_programma: "Iscritto a una sessione in programma",
  iscrizione_sospesa: "Iscrizione sospesa dal formatore",
  presenza_manuale: "Presenza registrata dal formatore",
};

/**
 * Partecipazione documentata: un ingresso dal link durante la lezione, almeno
 * un'esercitazione consegnata o una presenza registrata dal formatore. Chi si
 * è solo iscritto non conta: dirlo «formato» sarebbe un'informazione inesatta.
 */
export const DOCUMENTED: ReadonlySet<ParticipationStatus> = new Set([
  "esercitazioni_completate", "esercitazioni_in_parte", "nessuna_esercitazione", "presenza_manuale",
]);

/**
 * Esercitazioni svolte. Conta le consegne, mai il loro esito: «svolta» non
 * vuol dire «superata», e il registro non lo deve far credere.
 */
export function participation(params: {
  pack: PrivateTrainingPack;
  moduleId: string;
  submittedActivityIds: Iterable<string>;
  enrollmentStatus: string;
  /** Quando manca, l'ingresso si considera avvenuto durante una sessione svolta. */
  joinTiming?: JoinTiming;
  sessionHeld?: boolean;
}) {
  const { required, parentOf } = requiredActivities(params.pack, params.moduleId);
  const done = new Set<string>();
  for (const id of params.submittedActivityIds) {
    const counted = parentOf.get(id) ?? id;
    if (required.includes(counted)) done.add(counted);
  }
  const submitted = done.size;
  let status: ParticipationStatus;
  if (params.enrollmentStatus !== "active") status = "iscrizione_sospesa";
  else if (required.length > 0 && submitted === required.length) status = "esercitazioni_completate";
  else if (submitted > 0) status = "esercitazioni_in_parte";
  else if (params.sessionHeld === false) status = "sessione_in_programma";
  else if ((params.joinTiming ?? "durante_la_lezione") === "durante_la_lezione") status = "nessuna_esercitazione";
  else status = "partecipazione_non_documentata";
  return { required: required.length, submitted, status };
}

/** Competenze toccate da un modulo, ricavate dalle domande che contiene. */
export function moduleCompetencies(pack: PrivateTrainingPack, moduleId: string) {
  const ids = new Set(pack.items.filter((item) => item.module_id === moduleId).map((item) => item.competency_id));
  return pack.competencies.filter((competency) => ids.has(competency.id)).map((competency) => competency.label);
}

/** Persone distinte: account della piattaforma per id, presenze manuali per email o nome. */
export function distinctPeople(rows: { userId: string | null; email: string | null; name: string }[]) {
  const keys = new Set(rows.map((row) => row.userId ?? `manuale:${(row.email ?? row.name).trim().toLowerCase()}`));
  return keys.size;
}

// ─── Società dello stesso corso ────────────────────────────────────────

/** Caselle personali: non identificano una società. */
const PERSONAL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "outlook.it", "hotmail.com", "hotmail.it", "live.com", "live.it", "msn.com",
  "yahoo.com", "yahoo.it", "icloud.com", "me.com", "libero.it", "virgilio.it", "tiscali.it", "alice.it", "tim.it",
  "fastwebnet.it", "email.it", "inwind.it", "proton.me", "protonmail.com", "pec.it",
]);

const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

/** Dominio aziendale di un indirizzo, o null se manca o è una casella personale. */
export function companyDomain(email: string | null | undefined) {
  const parts = (email ?? "").trim().toLowerCase().split("@");
  if (parts.length !== 2 || !DOMAIN.test(parts[1])) return null;
  return PERSONAL_DOMAINS.has(parts[1]) ? null : parts[1];
}

export function isValidDomain(domain: string) {
  return DOMAIN.test(domain) && domain.length <= 253;
}

/** Le società presenti fra i partecipanti, dalla più numerosa. */
export function companyDomains(rows: { userId: string | null; email: string | null; name: string }[]) {
  const people = new Map<string, Set<string>>();
  for (const row of rows) {
    const domain = companyDomain(row.email);
    if (!domain) continue;
    const key = row.userId ?? `manuale:${(row.email ?? row.name).trim().toLowerCase()}`;
    people.set(domain, (people.get(domain) ?? new Set()).add(key));
  }
  return [...people].map(([domain, set]) => ({ domain, people: set.size }))
    .sort((a, b) => b.people - a.people || a.domain.localeCompare(b.domain));
}
