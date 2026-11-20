import { LEARNING_TEXT } from "./text.ts";

/**
 * (Rilascio 10, ondata 7a «Formazione», docs/ui-10/PROPOSTA-10.md §3.9) La pagina del corso per chi lo segue, in
 * regole pure: quando è la lezione, in che fase è, che cosa dice la card «Adesso» e qual è il suo solo pulsante pieno,
 * la riga di ogni esercizio (l'unico posto con gli esiti), la scaletta con gli orari veri, e quando la pagina si
 * aggiorna da sola. Le date sono sempre nell'ora italiana, ma il fuso non va mai a schermo. Modulo puro: niente
 * accesso ai dati, lo provano i test; i componenti disegnano soltanto.
 */

const ROME = "Europe/Rome";
const dayFormat = new Intl.DateTimeFormat("it-IT", { timeZone: ROME, weekday: "long", day: "numeric", month: "long" });
const shortDayFormat = new Intl.DateTimeFormat("it-IT", { timeZone: ROME, weekday: "short", day: "numeric", month: "short" });
const clockFormat = new Intl.DateTimeFormat("it-IT", { timeZone: ROME, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dateKey = new Intl.DateTimeFormat("sv-SE", { timeZone: ROME });

/** «14:30», nell'ora italiana. */
export function clockLabel(instant: string | number): string {
  return clockFormat.format(new Date(instant));
}

/** «lunedì 24 novembre, 14:30–16:30»: la lezione detta una volta. */
export function lessonWhen(session: { startsAt: string; endsAt: string }): string {
  return `${dayFormat.format(new Date(session.startsAt))}, ${clockLabel(session.startsAt)}–${clockLabel(session.endsAt)}`;
}

/** «lun 24 nov, 14:30»: la data breve delle card e degli esercizi di un altro giorno. */
export function shortWhen(instant: string | number): string {
  const date = new Date(instant);
  return `${shortDayFormat.format(date).replaceAll(".", "")}, ${clockFormat.format(date)}`;
}

function sameDay(a: string | number, b: string | number): boolean {
  return dateKey.format(new Date(a)) === dateKey.format(new Date(b));
}

export type LessonSession = { startsAt: string; endsAt: string; status: string };
/** «none»: nessuna lezione in calendario; «before»: prima; «live»: in lezione; «after»: finita o chiusa. */
export type LessonPhase = "none" | "before" | "live" | "after";

/**
 * In che momento è la lezione, secondo l'orologio: «live» dall'inizio (o da quando chi tiene il corso apre le
 * attività prima) fino alla fine, «after» dalla fine. La fine dell'incontro non chiude gli esercizi, e le risposte
 * sospese da chi tiene il corso (`closed`) si possono riaprire: quello lo dice la disponibilità di ogni esercizio.
 */
export function lessonPhase(session: LessonSession | null, now: number): LessonPhase {
  if (!session) return "none";
  const start = Date.parse(session.startsAt);
  const end = Date.parse(session.endsAt);
  if (now >= end) return "after";
  if (now >= start || session.status === "open") return "live";
  return "before";
}

/** Da quanto prima dell'inizio la pagina si aggiorna da sola: chi arriva presto vede l'apertura anticipata. */
export const LIVE_REFRESH_LEAD_MS = 15 * 60_000;

/** Una pagina aperta al massimo così tanto prima della lezione aspetta da sola l'inizio per aggiornarsi. */
export const LIVE_REFRESH_WATCH_MS = 12 * 60 * 60_000;

/**
 * La pagina del corso si aggiorna da sola in lezione, dal quarto d'ora prima fino alla fine, anche con le risposte
 * sospese (chi tiene il corso le può riaprire); prima e dopo no. Restituisce l'istante da cui aggiornarsi, oppure
 * null quando la pagina non si aggiorna: la lezione è finita, o comincia fra più di 12 ore (chi apre la pagina il
 * giorno della lezione e la lascia aperta la vede aggiornarsi da sola all'ora giusta).
 */
export function liveRefreshFrom(session: LessonSession | null, now: number): number | null {
  if (!session) return null;
  const start = Date.parse(session.startsAt);
  const end = Date.parse(session.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || now >= end) return null;
  const from = start - LIVE_REFRESH_LEAD_MS;
  return from - now > LIVE_REFRESH_WATCH_MS ? null : from;
}

export type CourseResult = { correct: number; total: number; status: string };
export type CourseActivity = {
  id: string;
  title: string;
  purpose: string;
  required: boolean;
  estimatedMinutes: number;
  /** «draft» o «submitted» quando c'è una prova; altrimenti lo stato della disponibilità. */
  status: string;
  attemptId: string | null;
  result: CourseResult | null;
  opensAfterMinutes: number | null;
  availability: { state: string; writeAccess: boolean; opensAt: string | null; reason: string | null };
};
export type CourseHistoryRow = { id: string; activityId: string; activityTitle: string; attemptNumber: number; status: string; result: CourseResult | null };
export type CourseMaterial = {
  id: string;
  title: string;
  description: string | null;
  fileName: string;
  sizeBytes: number;
  href: string;
  access: { downloadable: boolean; reason?: string | null };
};

/** I toni del semaforo (§5.6): lo stato è sempre un puntino più una parola. */
export type CourseTone = "verde" | "blu" | "giallo" | "grigio";

/** Le parole dell'esito, come in tutta la Formazione. */
export function outcomeWord(status: string | null | undefined): string {
  return (
    ({ consolidated: "Obiettivo raggiunto", needs_practice: "Da ripassare", formative_completed: "Fatto", submitted: "Consegnato", pending_review: "Revisione in corso" } as Record<string, string>)[status ?? ""] ??
    LEARNING_TEXT.course.exercises.submitted
  );
}

function outcomeTone(status: string | null | undefined): CourseTone {
  if (status === "consolidated" || status === "formative_completed") return "verde";
  if (status === "needs_practice") return "giallo";
  return "grigio";
}

export type ExerciseRow = {
  id: string;
  title: string;
  /** Lo stato: il puntino e la parola. */
  tone: CourseTone;
  state: string;
  /** Il fatto grigio accanto: «4 di 5 giuste», «circa 10 minuti», «non conta per il risultato». */
  fact: string | null;
  /** Dove porta la riga; null: una riga ferma (non ancora aperto). */
  href: string | null;
};

/** La riga di un esercizio: lo stato in parole, un fatto, dove porta. */
export function exerciseRow(activity: CourseActivity, base: string, now: number): ExerciseRow {
  const T = LEARNING_TEXT.course.exercises;
  const attemptHref = activity.attemptId ? `${base}/attempts/${activity.attemptId}` : null;
  const optional = activity.required ? null : T.notCounted;
  const join = (...parts: Array<string | null>) => parts.filter(Boolean).join(" · ") || null;
  if (activity.status === "submitted") {
    const result = activity.result;
    return {
      id: activity.id,
      title: activity.title,
      tone: outcomeTone(result?.status),
      state: outcomeWord(result?.status ?? "submitted"),
      fact: join(result ? T.score(result.correct, result.total) : null, optional),
      href: attemptHref,
    };
  }
  if (activity.status === "draft") {
    const open = activity.availability.writeAccess;
    return { id: activity.id, title: activity.title, tone: open ? "blu" : "grigio", state: open ? T.inProgress : T.saved, fact: optional, href: attemptHref };
  }
  if (activity.availability.writeAccess) {
    return {
      id: activity.id,
      title: activity.title,
      tone: "blu",
      state: T.todo,
      fact: join(activity.estimatedMinutes ? T.minutes(activity.estimatedMinutes) : null, optional),
      href: `${base}/activities/${activity.id}`,
    };
  }
  const opensAt = activity.availability.state === "scheduled" ? activity.availability.opensAt : null;
  const state = opensAt ? (sameDay(opensAt, now) ? T.opensAt(clockLabel(opensAt)) : T.opensOn(shortWhen(opensAt))) : activity.availability.state === "course_closed" || activity.availability.state === "session_closed" ? T.closed : T.notOpen;
  return { id: activity.id, title: activity.title, tone: "grigio", state, fact: optional, href: null };
}

export type NowAction =
  | { kind: "start" | "resume" | "redo"; label: string; href: string }
  /** Un materiale solo: il pulsante lo scarica. */
  | { kind: "download"; label: string; href: string; fileName: string }
  /** Più materiali: il pulsante apre la piega «Materiali». */
  | { kind: "materials"; label: string; href: string };

export type NowCard = {
  phase: LessonPhase;
  /** La frase della card; dopo la lezione, il solo numero della pagina. */
  line: string;
  /** Una seconda riga breve (l'esito, l'apertura del prossimo esercizio), facoltativa. */
  note: string | null;
  /** Il solo pulsante pieno della pagina; null: niente da fare adesso. */
  action: NowAction | null;
  /** I passi del materiale da scaricare prima della lezione, se chi tiene il corso li ha scritti. */
  steps: string[];
};

/** Le righe della descrizione di un materiale diventano passi, se chi tiene il corso le ha scritte così. */
export function materialSteps(text: string | null): string[] {
  return (text ?? "")
    .split("\n")
    .map((line) => line.replace(/^\s*(\d+[.)]|[-•])\s*/, "").trim())
    .filter(Boolean);
}

/**
 * La card «Adesso» di chi segue il corso (§3.9): prima della lezione «Scarica i materiali», durante «Inizia:
 * {esercizio aperto}», dopo «2 di 3 esercizi fatti» con «Rifai…» quando c'è da ripassare. Il pulsante è il prossimo
 * passo, nell'ordine:
 * 1. un esercizio obbligatorio iniziato e ancora aperto («Continua»), poi uno aperto e non iniziato («Inizia»);
 * 2. in lezione, anche un esercizio facoltativo aperto (il ripasso del momento);
 * 3. un esercizio da ripassare che si può ancora rifare («Rifai»);
 * 4. prima della lezione, o in lezione finché nessun esercizio è aperto, i materiali da scaricare prima;
 * 5. altrimenti nessun pulsante: la frase dice com'è.
 */
export function nowCard(input: {
  session: LessonSession | null;
  now: number;
  activities: readonly CourseActivity[];
  beforeMaterials: readonly CourseMaterial[];
  base: string;
  courseOpen: boolean;
}): NowCard {
  const T = LEARNING_TEXT.course.now;
  const phase = lessonPhase(input.session, input.now);
  const { activities, base } = input;
  const required = activities.filter((activity) => activity.required);
  const doneRequired = required.filter((activity) => activity.status === "submitted").length;

  const open = (list: readonly CourseActivity[]) => list.filter((activity) => activity.availability.writeAccess && activity.status !== "submitted");
  const pick = (list: readonly CourseActivity[]) => list.find((activity) => activity.status === "draft") ?? list[0] ?? null;
  const startOf = (activity: CourseActivity): NowAction =>
    activity.status === "draft" && activity.attemptId
      ? { kind: "resume", label: T.resume(activity.title), href: `${base}/attempts/${activity.attemptId}` }
      : { kind: "start", label: T.start(activity.title), href: `${base}/activities/${activity.id}` };
  const openRequired = open(required);
  const openAny = phase === "live" ? open(activities) : [];
  const next = pick(openRequired) ?? pick(openAny);
  const redo = activities.find((activity) => activity.status === "submitted" && activity.result?.status === "needs_practice" && activity.availability.writeAccess && activity.attemptId);

  const downloadable = input.beforeMaterials.filter((material) => material.access.downloadable);
  const steps = downloadable.length === 1 ? materialSteps(downloadable[0].description) : [];
  const materialsAction: NowAction | null =
    downloadable.length === 1
      ? { kind: "download", label: T.download, href: downloadable[0].href, fileName: downloadable[0].fileName }
      : downloadable.length > 1
        ? { kind: "materials", label: T.download, href: "#materiali" }
        : null;

  if (!input.courseOpen) return { phase, line: T.closed, note: null, action: null, steps: [] };
  if (phase === "none") return { phase, line: T.noLesson, note: null, action: next ? startOf(next) : materialsAction, steps: next ? [] : steps };

  if (phase === "before") {
    return { phase, line: downloadable.length ? T.before : T.beforeNoMaterials, note: null, action: next ? startOf(next) : materialsAction, steps: next ? [] : steps };
  }

  if (phase === "live") {
    if (next) return { phase, line: T.live, note: null, action: startOf(next), steps: [] };
    if (input.session?.status === "closed") return { phase, line: T.live, note: T.suspended, action: null, steps: [] };
    const upcoming = activities
      .filter((activity) => activity.availability.state === "scheduled" && activity.availability.opensAt)
      .map((activity) => activity.availability.opensAt!)
      .sort()[0];
    const nothingOpened = !activities.some((activity) => activity.availability.writeAccess || activity.status === "submitted" || activity.status === "draft");
    const note = upcoming ? T.nextOpens(clockLabel(upcoming)) : activities.some((activity) => activity.status !== "submitted") && nothingOpened ? T.nextOpensLater : null;
    if (redo) return { phase, line: T.live, note, action: { kind: "redo", label: T.redo(redo.title), href: `${base}/attempts/${redo.attemptId}` }, steps: [] };
    if (nothingOpened && materialsAction) return { phase, line: T.live, note, action: materialsAction, steps };
    const allSubmitted = activities.length > 0 && activities.every((activity) => activity.status === "submitted");
    return { phase, line: T.live, note: note ?? (allSubmitted ? T.allDone : activities.length ? T.allOpenDone : null), action: null, steps: [] };
  }

  // Dopo la lezione: il numero, l'esito, e il passo che resta.
  const line = required.length === 0 ? T.allDone : doneRequired === 0 ? T.toDo(required.length) : T.done(doneRequired, required.length);
  const complete = required.length > 0 && doneRequired === required.length;
  const practice = required.some((activity) => activity.status === "submitted" && activity.result?.status === "needs_practice");
  const note = complete ? (practice ? T.practice : T.achieved) : null;
  if (next) return { phase, line, note, action: startOf(next), steps: [] };
  if (redo) return { phase, line, note, action: { kind: "redo", label: T.redo(redo.title), href: `${base}/attempts/${redo.attemptId}` }, steps: [] };
  return { phase, line, note, action: null, steps: [] };
}

export type AgendaBlockView = {
  key: string;
  /** «14:30–15:00» con una lezione; «30 min» per chi tiene il corso senza lezione. */
  time: string;
  title: string;
  detail: string | null;
  current: boolean;
  past: boolean;
};

/** La scaletta con gli orari veri e «Siamo qui» sul blocco in corso. */
export function agendaBlocks(
  agenda: ReadonlyArray<{ from_minute: number; to_minute: number; title: string; detail?: string }>,
  session: LessonSession | null,
  now: number,
): AgendaBlockView[] {
  const start = session ? Date.parse(session.startsAt) : NaN;
  const live = session ? lessonPhase(session, now) === "live" && Number.isFinite(start) && now >= start : false;
  const elapsed = Number.isFinite(start) ? Math.floor((now - start) / 60_000) : null;
  return agenda.map((block) => {
    const time = Number.isFinite(start)
      ? `${clockLabel(start + block.from_minute * 60_000)}–${clockLabel(start + block.to_minute * 60_000)}`
      : LEARNING_TEXT.course.agenda.minutes(block.to_minute - block.from_minute);
    const current = live && elapsed !== null && elapsed >= block.from_minute && elapsed < block.to_minute;
    const past = elapsed !== null && !current && elapsed >= block.to_minute;
    return { key: `${block.from_minute}-${block.title}`, time, title: block.title, detail: block.detail ?? null, current, past };
  });
}

/** «1,2 MB». */
export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} byte`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/**
 * La prossima lezione da dire sulla card di un corso (§3.9): la lezione di chi lo segue, se non è ancora finita;
 * per chi lo tiene, la prima lezione del corso che non è ancora finita. Nessuna: null (lo zero non si mostra).
 */
export function nextLessonOf(input: { ownSession: LessonSession | null; sessions: readonly LessonSession[]; canParticipate: boolean; now: number }): string | null {
  const upcoming = (session: LessonSession) => session.status !== "closed" && Date.parse(session.endsAt) > input.now;
  if (input.canParticipate) return input.ownSession && upcoming(input.ownSession) ? shortWhen(input.ownSession.startsAt) : null;
  const first = [...input.sessions].filter(upcoming).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
  return first ? shortWhen(first.startsAt) : null;
}
